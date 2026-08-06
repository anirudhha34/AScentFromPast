import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import nodemailer from 'nodemailer';

// ---------------------------------------------------------------------------
// WHY THE SDK V3 IMPORTS
// ---------------------------------------------------------------------------
// `aws-sdk` (v2) pulls in every AWS service (~70MB unpacked). That inflates
// your Lambda deployment package, which slows cold starts and burns extra
// init time. The `@aws-sdk/client-*` v3 packages are modular — you only ship
// the clients you actually use. Smaller package -> faster cold start ->
// less GB-seconds consumed per invocation -> more headroom inside the
// Lambda free tier (1M requests + 400,000 GB-seconds / month, always free).
// ---------------------------------------------------------------------------

const app = express();
const port = process.env.PORT || 4000;
const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(express.json());
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Simple structured logger. Keeping this cheap and boring on purpose:
// CloudWatch Logs bills per GB ingested, so we avoid dumping full letter
// bodies or verbose objects into logs — just IDs, statuses, and durations.
function log(level, msg, meta = {}) {
  const entry = { level, msg, ts: new Date().toISOString(), ...meta };
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
}

const memoryStore = new Map();

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;
const dynamoClient =
  process.env.AWS_REGION && TABLE_NAME
    ? DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }), {
        marshallOptions: { removeUndefinedValues: true },
      })
    : null;

const scheduler = process.env.AWS_REGION
  ? new SchedulerClient({ region: process.env.AWS_REGION })
  : null;

const transporter =
  process.env.SES_SMTP_HOST && process.env.SES_SMTP_USERNAME && process.env.SES_SMTP_PASSWORD
    ? nodemailer.createTransport({
        host: process.env.SES_SMTP_HOST,
        port: Number(process.env.SES_SMTP_PORT || 587),
        secure: false,
        auth: {
          user: process.env.SES_SMTP_USERNAME,
          pass: process.env.SES_SMTP_PASSWORD,
        },
      })
    : null;

// Days to keep SENT/CANCELLED letters around before they become eligible for
// automatic deletion. DynamoDB TTL deletes expired items for free (it does
// NOT consume write capacity), which keeps you under the 25GB always-free
// storage cap without you writing any cleanup job/Lambda for it.
const RETENTION_DAYS_AFTER_TERMINAL_STATE = Number(process.env.RETENTION_DAYS || 30);
const MAX_RETRY_ATTEMPTS = Number(process.env.MAX_RETRY_ATTEMPTS || 3);
const RETRY_BACKOFF_SECONDS = Number(process.env.RETRY_BACKOFF_SECONDS || 900);

const createLetterSchema = z.object({
  email: z.string().trim().email({ message: 'email must be a valid address.' }),
  message: z
    .string()
    .trim()
    .min(1, { message: 'message is required.' })
    .max(1200, { message: 'message must be 1200 characters or fewer.' }),
  scheduledAt: z
    .string()
    .datetime({ message: 'scheduledAt must be a valid ISO-8601 timestamp.' })
    .refine((value) => new Date(value).getTime() > Date.now(), {
      message: 'scheduledAt must be in the future.',
    }),
});

const updateLetterSchema = z
  .object({
    scheduledAt: z
      .string()
      .datetime({ message: 'scheduledAt must be a valid ISO-8601 timestamp.' })
      .refine((value) => new Date(value).getTime() > Date.now(), {
        message: 'scheduledAt must be in the future.',
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required.',
  });

function buildLetterRecord(body) {
  const now = new Date();
  const scheduledAtValue = body.scheduledAt ? new Date(body.scheduledAt).toISOString() : null;

  return {
    letterId: randomUUID(),
    email: body.email,
    message: body.message,
    scheduledAt: scheduledAtValue,
    status: 'PENDING',
    createdAt: now.toISOString(),
    lastUpdatedAt: now.toISOString(),
    scheduleName: null,
    // epoch seconds — only meaningful once status is terminal (see setTerminalStatus)
    expiresAt: null,
    retryCount: 0,
    lastError: null,
    nextRetryAt: null,
    sentAt: null,
    cancelledAt: null,
    failedAt: null,
  };
}

async function saveLetter(letter) {
  if (dynamoClient) {
    await dynamoClient.send(new PutCommand({ TableName: TABLE_NAME, Item: letter }));
    return { mode: 'dynamodb' };
  }

  memoryStore.set(letter.letterId, letter);
  return { mode: 'memory' };
}

async function getLetter(letterId) {
  if (dynamoClient) {
    const result = await dynamoClient.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { letterId } })
    );
    return result.Item || null;
  }

  return memoryStore.get(letterId) || null;
}

// ---------------------------------------------------------------------------
// updateLetterStatus: previously this did a GET, mutated the object in Node,
// then did a full PUT — that's 2 DynamoDB requests (1 RRU + 1 WRU) for what
// is really a single-field change, plus a read-modify-write race window if
// two invocations ever overlapped.
//
// A single UpdateCommand with a ConditionExpression does it in ONE request
// and makes the send idempotent: if EventBridge/Lambda ever retries the same
// event (which both can do on transient failures), the condition fails on
// the second attempt instead of sending the email twice. That's a
// correctness fix AND a cost fix — it avoids a duplicate SES send and a
// duplicate DynamoDB write.
// ---------------------------------------------------------------------------
async function setTerminalStatus(letterId, status) {
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + RETENTION_DAYS_AFTER_TERMINAL_STATE * 86400;

  if (dynamoClient) {
    try {
      const result = await dynamoClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { letterId },
          UpdateExpression: 'SET #status = :status, lastUpdatedAt = :now, expiresAt = :expiresAt',
          ConditionExpression: '#status = :pending',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': status,
            ':now': now.toISOString(),
            ':expiresAt': expiresAt,
            ':pending': 'PENDING',
          },
          ReturnValues: 'ALL_NEW',
        })
      );
      return { updated: true, letter: result.Attributes };
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        log('info', 'skip_duplicate_status_update', { letterId, status });
        return { updated: false, letter: await getLetter(letterId) };
      }
      throw error;
    }
  }

  // in-memory fallback (dev mode)
  const current = memoryStore.get(letterId);
  if (!current || current.status !== 'PENDING') {
    return { updated: false, letter: current || null };
  }
  const updated = { ...current, status, lastUpdatedAt: now.toISOString(), expiresAt };
  memoryStore.set(letterId, updated);
  return { updated: true, letter: updated };
}

async function deleteSchedule(scheduleName) {
  if (!scheduler || !scheduleName) {
    return { mode: 'mock' };
  }

  try {
    await scheduler.send(new DeleteScheduleCommand({ Name: scheduleName }));
    return { mode: 'eventbridge' };
  } catch (error) {
    if (error.name !== 'ResourceNotFoundException') {
      log('error', 'delete_schedule_failed', { scheduleName, error: error.message });
    }
    return { mode: 'mock' };
  }
}

function scheduleParams(letter) {
  const scheduleName = `letter-${letter.letterId}`.slice(0, 64);
  return {
    Name: scheduleName,
    ScheduleExpression: `at(${new Date(letter.scheduledAt).toISOString()})`,
    State: 'ENABLED',
    Target: {
      Arn: process.env.SEND_MESSAGE_LAMBDA_ARN,
      RoleArn: process.env.EVENTBRIDGE_SCHEDULE_ROLE_ARN,
      Input: JSON.stringify({ letterId: letter.letterId }),
      // Cap retries so a broken downstream target doesn't quietly burn
      // through Lambda invocations retrying forever.
      RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 },
    },
    FlexibleTimeWindow: { Mode: 'OFF' },
    Description: `Send letter ${letter.letterId}`,
    // Once the one-time schedule fires successfully, EventBridge deletes it
    // automatically. Without this you'd accumulate one COMPLETED schedule
    // per sent letter forever, and you'd need your own cleanup logic (more
    // Lambda invocations, more code) to remove them.
    ActionAfterCompletion: 'DELETE',
  };
}

async function createOneTimeSchedule(letter) {
  if (
    !scheduler ||
    !process.env.EVENTBRIDGE_SCHEDULE_ROLE_ARN ||
    !process.env.SEND_MESSAGE_LAMBDA_ARN ||
    !letter.scheduledAt
  ) {
    return {
      mode: 'mock',
      scheduleName: `mock-${letter.letterId}`,
      note: 'EventBridge Scheduler configuration is not set. The letter is saved locally and can be scheduled once AWS env vars are provided.',
    };
  }

  const params = scheduleParams(letter);
  await scheduler.send(new CreateScheduleCommand(params));
  return { mode: 'eventbridge', scheduleName: params.Name };
}

// ---------------------------------------------------------------------------
// Rescheduling used to be delete-then-create (2 control-plane calls). The
// Scheduler API has a native UpdateSchedule call that replaces a schedule's
// definition in place — 1 call instead of 2, and no window where the
// schedule briefly doesn't exist.
// ---------------------------------------------------------------------------
async function rescheduleOneTime(letter) {
  if (
    !scheduler ||
    !process.env.EVENTBRIDGE_SCHEDULE_ROLE_ARN ||
    !process.env.SEND_MESSAGE_LAMBDA_ARN ||
    !letter.scheduledAt
  ) {
    return createOneTimeSchedule(letter);
  }

  const params = scheduleParams(letter);

  if (!letter.scheduleName) {
    await scheduler.send(new CreateScheduleCommand(params));
    return { mode: 'eventbridge', scheduleName: params.Name };
  }

  try {
    await scheduler.send(new UpdateScheduleCommand({ ...params, Name: letter.scheduleName }));
    return { mode: 'eventbridge', scheduleName: letter.scheduleName };
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      await scheduler.send(new CreateScheduleCommand(params));
      return { mode: 'eventbridge', scheduleName: params.Name };
    }
    throw error;
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLetterHtml(letter) {
  const createdDate = new Date(letter.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const deliveredDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const safeMessage = escapeHtml(letter.message || '');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{margin:0;background:#14110d;font-family:Georgia,serif;color:#2f2417;}
.wrapper{width:100%;padding:60px 0;}
.paper{max-width:700px;margin:auto;background:#f4e1b9;border-radius:6px;padding:60px;box-shadow:0 0 60px rgba(0,0,0,.45);background-image:repeating-linear-gradient(transparent,transparent 31px,rgba(70,45,20,.06) 32px);}
.heading{text-align:center;font-size:42px;color:#43311c;margin-bottom:10px;}
.sub{text-align:center;color:#6d5336;font-style:italic;margin-bottom:45px;line-height:1.8;}
.divider{text-align:center;color:#8b6b43;margin:35px 0;letter-spacing:6px;}
.letter{font-size:22px;line-height:2;white-space:pre-wrap;color:#332312;}
.footer{margin-top:60px;text-align:center;color:#7c6547;font-size:15px;font-style:italic;}
.small{text-align:center;color:#927c5b;margin-top:20px;font-size:13px;}
</style>
</head>
<body>
<div class="wrapper">
<div class="paper">
<div class="heading">Dear Future Me,</div>
<div class="sub">This letter has travelled through time.<br>It waited patiently for this exact moment.</div>
<div class="divider">──────── ◇ ────────</div>
<div class="letter">${safeMessage}</div>
<div class="divider">──────── ◇ ────────</div>
<div class="footer">Time remembers what we forget.</div>
<div class="small">Written on ${createdDate}<br>Delivered on ${deliveredDate}</div>
</div>
</div>
</body>
</html>`;
}

async function sendLetterViaSes(letter) {
  if (!transporter || !process.env.SES_FROM_EMAIL) {
    return { mode: 'mock', note: 'Nodemailer/SES is not configured yet.' };
  }

  const html = renderLetterHtml(letter);

  await transporter.sendMail({
    from: process.env.SES_FROM_EMAIL,
    to: letter.email,
    subject: 'Yourself from the Past: A Letter for You',
    html,
    text: letter.message,
  });

  return { mode: 'nodemailer' };
}

async function scheduleRetry(letter, error) {
  const attempt = (letter.retryCount || 0) + 1;
  const now = new Date();

  if (attempt > MAX_RETRY_ATTEMPTS) {
    const failedLetter = {
      ...letter,
      status: 'FAILED',
      retryCount: attempt - 1,
      lastError: error.message,
      failedAt: now.toISOString(),
      nextRetryAt: null,
      lastUpdatedAt: now.toISOString(),
    };

    await saveLetter(failedLetter);
    return { scheduled: false, letter: failedLetter };
  }

  const backoffMs = Math.min(RETRY_BACKOFF_SECONDS * 1000 * 2 ** (attempt - 1), 24 * 60 * 60 * 1000);
  const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
  const retryLetter = {
    ...letter,
    status: 'PENDING',
    retryCount: attempt,
    lastError: error.message,
    nextRetryAt,
    failedAt: now.toISOString(),
    lastUpdatedAt: now.toISOString(),
  };

  const scheduleResult = await createOneTimeSchedule({ ...retryLetter, scheduledAt: nextRetryAt });
  if (scheduleResult.scheduleName) {
    retryLetter.scheduleName = scheduleResult.scheduleName;
  }

  await saveLetter(retryLetter);
  return { scheduled: true, letter: retryLetter, scheduleResult };
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Letter service is running.' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Letter service is running.' });
});

app.post('/letters', async (req, res) => {
  const startedAt = Date.now();
  try {
    const parsed = createLetterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        details: parsed.error.flatten(),
      });
    }

    const { email, message, scheduledAt } = parsed.data;

    const letter = buildLetterRecord({ email, message, scheduledAt });
    await saveLetter(letter);

    const scheduleResult = await createOneTimeSchedule(letter);
    if (scheduleResult.scheduleName && scheduleResult.scheduleName !== letter.scheduleName) {
      letter.scheduleName = scheduleResult.scheduleName;
      await saveLetter(letter);
    }

    log('info', 'letter_created', {
      letterId: letter.letterId,
      scheduleMode: scheduleResult.mode,
      durationMs: Date.now() - startedAt,
    });

    res.status(201).json({ success: true, letter, schedule: scheduleResult });
  } catch (error) {
    log('error', 'letter_create_failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to create letter.' });
  }
});

app.get('/letters/:letterId', async (req, res) => {
  try {
    const letter = await getLetter(req.params.letterId);
    if (!letter) {
      return res.status(404).json({ success: false, message: 'Letter not found.' });
    }

    res.json({ success: true, letter });
  } catch (error) {
    log('error', 'letter_fetch_failed', { letterId: req.params.letterId, error: error.message });
    res.status(500).json({ success: false, message: 'Failed to fetch letter.' });
  }
});

app.put('/letters/:letterId', async (req, res) => {
  try {
    const parsed = updateLetterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        details: parsed.error.flatten(),
      });
    }

    const current = await getLetter(req.params.letterId);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Letter not found.' });
    }

    if (current.status !== 'PENDING') {
      return res.status(409).json({ success: false, message: 'Only pending letters can be updated.' });
    }

    const nextScheduledAt = parsed.data.scheduledAt || current.scheduledAt;
    const nextLetter = {
      ...current,
      letterId: current.letterId,
      scheduledAt: nextScheduledAt ? new Date(nextScheduledAt).toISOString() : null,
      status: 'PENDING',
      lastUpdatedAt: new Date().toISOString(),
      nextRetryAt: null,
      lastError: null,
      retryCount: current.retryCount || 0,
    };

    const scheduleTimeChanged = parsed.data.scheduledAt && parsed.data.scheduledAt !== current.scheduledAt;
    if (scheduleTimeChanged || !nextLetter.scheduleName) {
      const scheduleResult = await rescheduleOneTime(nextLetter);
      nextLetter.scheduleName = scheduleResult.scheduleName || null;
    }

    await saveLetter(nextLetter);

    log('info', 'letter_updated', { letterId: nextLetter.letterId });
    res.json({ success: true, letter: nextLetter });
  } catch (error) {
    log('error', 'letter_update_failed', { letterId: req.params.letterId, error: error.message });
    res.status(500).json({ success: false, message: 'Failed to update letter.' });
  }
});

app.delete('/letters/:letterId', async (req, res) => {
  try {
    const current = await getLetter(req.params.letterId);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Letter not found.' });
    }

    if (current.status === 'SENT') {
      return res.status(409).json({ success: false, message: 'Sent letters cannot be cancelled.' });
    }

    await deleteSchedule(current.scheduleName);
    const result = await setTerminalStatus(current.letterId, 'CANCELLED');

    if (result.updated) {
      const cancelledLetter = {
        ...(result.letter || current),
        status: 'CANCELLED',
        cancelledAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        nextRetryAt: null,
      };
      await saveLetter(cancelledLetter);
    }

    log('info', 'letter_cancelled', { letterId: current.letterId });
    res.json({ success: true, letter: result.letter || current });
  } catch (error) {
    log('error', 'letter_cancel_failed', { letterId: req.params.letterId, error: error.message });
    res.status(500).json({ success: false, message: 'Failed to cancel letter.' });
  }
});

if (!isLambda) {
  app.listen(port, () => {
    log('info', 'server_started', { port });
  });
}

export { app };

// ---------------------------------------------------------------------------
// handler: invoked by the target Lambda that EventBridge Scheduler triggers
// at delivery time. This is the ONLY Lambda invocation that should happen
// per letter (one CreateSchedule -> one eventual invoke, thanks to
// ActionAfterCompletion: 'DELETE' above, instead of a recurring cron-style
// rule that would poll/invoke repeatedly). Idempotency is enforced by the
// ConditionExpression in setTerminalStatus, so a retried event is a no-op
// on the DB/email side instead of a duplicate send.
// ---------------------------------------------------------------------------
export async function handler(event) {
  const startedAt = Date.now();
  let letterId = event?.letterId || event?.detail?.letterId;

  if (!letterId && event?.body) {
    try {
      const parsed = JSON.parse(event.body);
      letterId = parsed.letterId;
    } catch (error) {
      letterId = event.body;
    }
  }

  if (!letterId) {
    log('error', 'handler_missing_letter_id');
    return { success: false, message: 'letterId is required.' };
  }

  const letter = await getLetter(letterId);
  if (!letter) {
    log('error', 'handler_letter_not_found', { letterId });
    return { success: false, message: 'Letter not found.' };
  }

  if (letter.status === 'SENT' || letter.status === 'CANCELLED' || letter.status === 'FAILED') {
    log('info', 'handler_already_handled', { letterId, status: letter.status });
    return { success: true, letterId, status: letter.status, message: 'Letter already handled.' };
  }

  try {
    const sendResult = await sendLetterViaSes(letter);
    const { updated, letter: finalLetter } = await setTerminalStatus(letterId, 'SENT');
    const now = new Date();
    const persistedLetter = {
      ...(finalLetter || letter),
      status: 'SENT',
      sentAt: now.toISOString(),
      lastError: null,
      nextRetryAt: null,
      failedAt: null,
      lastUpdatedAt: now.toISOString(),
    };
    await saveLetter(persistedLetter);

    log('info', 'handler_completed', {
      letterId,
      sentNow: updated,
      sendMode: sendResult.mode,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true,
      letterId,
      status: persistedLetter?.status || 'SENT',
      sendResult,
    };
  } catch (error) {
    const retryResult = await scheduleRetry(letter, error);
    log('error', 'handler_send_failed', {
      letterId,
      error: error.message,
      retryScheduled: retryResult.scheduled,
    });
    return {
      success: false,
      letterId,
      status: retryResult.letter?.status || 'PENDING',
      retry: retryResult,
      message: 'Letter delivery failed; retry scheduled.',
    };
  }
}