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
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand
} from '@aws-sdk/client-scheduler';
import nodemailer from 'nodemailer';
/*
Required environment variables:

AWS_LAMBDA_FUNCTION_NAME   (set automatically by Lambda — do not set manually)
DYNAMODB_TABLE_NAME=user-letters
AWS_REGION=ap-southeast-2
SES_SMTP_HOST
SES_SMTP_USERNAME
SES_SMTP_PASSWORD
SES_FROM_EMAIL
TURNSTILE_SECRET_KEY        // no fallback — see verifyTurnstileToken()

// This same function's own ARN. EventBridge Scheduler invokes this one
// Lambda directly (self-referential), so this must be set to the deployed
// function's ARN — not known until the function exists, so wire it via
// IaC output / a post-deploy step rather than hardcoding.
SEND_MESSAGE_LAMBDA_ARN

// IAM role EventBridge Scheduler assumes in order to invoke SEND_MESSAGE_LAMBDA_ARN.
// Trust policy principal: scheduler.amazonaws.com
// Permissions: lambda:InvokeFunction on SEND_MESSAGE_LAMBDA_ARN
EVENTBRIDGE_SCHEDULE_ROLE_ARN
*/

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 5000; // FIX #7: don't let a hung Cloudflare call eat the whole Lambda budget

/**
 * Verifies a Turnstile token with Cloudflare using the SECRET key.
 * Must only ever run on the server — never expose this key to the client.
 */
async function verifyTurnstileToken(token, remoteip) {
  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  // SECURITY FIX: the previous version hardcoded a real-looking secret key as
  // a fallback (`process.env.TURNSTILE_SECRET_KEY || '0x4AAA...'`). That put a
  // live secret in source control / chat history. There is no safe fallback
  // for a secret — fail closed instead, same as the DynamoDB check below.
  // If a key was ever hardcoded and shipped, rotate it in the Cloudflare
  // Turnstile dashboard regardless of what this code now does.
  const secret = process.env.TURNSTILE_SECRET_KEY || '';

  if (!secret) {
    console.error('TURNSTILE_SECRET_KEY is not set — refusing to verify.');
    return { success: false, errorCodes: ['missing-secret-key'] };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.append('remoteip', remoteip);

  // FIX #7: hard timeout via AbortController
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);//how will it timeout

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      return { success: false, errorCodes: [`http-${res.status}`] };
    }

    const data = await res.json();
    return {
      success: !!data.success,
      errorCodes: data['error-codes'] || [],
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    console.error('Turnstile verification request failed:', isTimeout ? 'timeout' : err.message);
    return { success: false, errorCodes: [isTimeout ? 'timeout' : 'network-error'] };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// WHY THE SDK V3 IMPORTS
// ---------------------------------------------------------------------------
// `aws-sdk` (v2) pulls in every AWS service (~70MB unpacked). The
// `@aws-sdk/client-*` v3 packages are modular — smaller package, faster
// cold starts, more headroom inside the Lambda free tier.
// ---------------------------------------------------------------------------

const app = express();
const port = process.env.PORT || 4000;
const isLambda = Boolean(
  process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT
);
const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  'http://localhost:3000,http://127.0.0.1:5173,http://localhost:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(express.json({ limit: '32kb' }));
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Attach a per-request correlation id so related log lines can be grepped together.
app.use((req, res, next) => {
  req.requestId = req.headers['x-amzn-trace-id'] || randomUUID();
  next();
});

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

// FIX (polish): in Lambda there is no shared memory across containers/cold starts,
// so silently falling back to memoryStore there means letters randomly vanish and
// claims randomly 404. Fail loudly instead — this is a config problem, not a runtime one.
if (isLambda && !dynamoClient) {
  throw new Error(
    'DynamoDB is not configured (DYNAMODB_TABLE_NAME / AWS_REGION missing). ' +
      'Refusing to start in Lambda with the in-memory fallback.'
  );
}

const scheduler = process.env.AWS_REGION
  ? new SchedulerClient({ region: process.env.AWS_REGION })
  : null;

const transporter =
  process.env.SES_SMTP_HOST &&
  process.env.SES_SMTP_USERNAME &&
  process.env.SES_SMTP_PASSWORD
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

const RETENTION_DAYS_AFTER_TERMINAL_STATE = Number(process.env.RETENTION_DAYS || 30);
const MAX_RETRY_ATTEMPTS = Number(process.env.MAX_RETRY_ATTEMPTS || 3);
const RETRY_BACKOFF_SECONDS = Number(process.env.RETRY_BACKOFF_SECONDS || 900);
const CLAIM_SCAN_MAX_PAGES = 5; // FIX #4: paginate the scan instead of only ever looking at 50 items

// ---------------------------------------------------------------------------
// Validation — matches frontend payloads
// ---------------------------------------------------------------------------
// SELF:
//   { type, message, email, scheduledAt, turnstileToken, idempotencyKey? }
// TRAVELER:
//   { type, message, turnstileToken, idempotencyKey? }
// ---------------------------------------------------------------------------

const selfLetterSchema = z.object({
  type: z.literal('SELF'),
  message: z
    .string()
    .trim()
    .min(8, { message: 'message is too short.' })
    .max(1200, { message: 'message must be 1200 characters or fewer.' }),
  email: z.string().trim().email({ message: 'email must be a valid address.' }),
  scheduledAt: z
    .string()
    .datetime({ message: 'scheduledAt must be a valid ISO-8601 timestamp.' })
    .refine((value) => new Date(value).getTime() > Date.now() - 60_000, {
      message: 'scheduledAt must be in the future.',
    }),
  turnstileToken: z.string().min(1, { message: 'turnstileToken is required.' }),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

const travelerLetterSchema = z.object({
  type: z.literal('TRAVELER'),
  message: z
    .string()
    .trim()
    .min(8, { message: 'message is too short.' })
    .max(1200, { message: 'message must be 1200 characters or fewer.' }),
  turnstileToken: z.string().min(1, { message: 'turnstileToken is required.' }),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

const createLetterSchema = z.discriminatedUnion('type', [
  selfLetterSchema,
  travelerLetterSchema,
]);

function buildLetterRecord(body) {
  const now = new Date().toISOString();
  const letterId = randomUUID();

  if (body.type === 'SELF') {
    return {
      letterId,
      type: 'SELF',
      status: 'PENDING',
      message: body.message,
      email: body.email,
      scheduledAt: new Date(body.scheduledAt).toISOString(),
      scheduleName: null,
      idempotencyKey: body.idempotencyKey || null,
      createdAt: now,
      updatedAt: now,
      // delivery / retry fields //maybe not needed
      expiresAt: null,
      retryCount: 0,
      lastError: null,
      nextRetryAt: null,
      sentAt: null,
      cancelledAt: null,
      failedAt: null,
    };
  }

  // TRAVELER — public, claimable by the bottle
  return {
    letterId,
    type: 'TRAVELER',
    status: 'PUBLIC',
    message: body.message,
    idempotencyKey: body.idempotencyKey || null,
    claimed: false,
    claimedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * FIX (polish): optionally guard the initial insert with a condition so a
 * randomUUID() collision (or accidental double-call) can't silently clobber
 * an existing item.
 */
async function saveLetter(letter, { ifNotExists = false } = {}) {
  if (dynamoClient) {
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: letter,
        ...(ifNotExists
          ? { ConditionExpression: 'attribute_not_exists(letterId)' }
          : {}),
      })
    );
    return { mode: 'dynamodb' };
  }

  if (ifNotExists && memoryStore.has(letter.letterId)) {
    const err = new Error('letterId already exists');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  memoryStore.set(letter.letterId, letter);
  return { mode: 'memory' };
}

/**
 * FIX (polish): cheap partial update instead of re-Put-ing the whole item —
 * avoids clobbering any concurrent write and costs less.
 */
async function patchLetterFields(letterId, fields) {
  const now = new Date().toISOString();
  const mergedFields = { ...fields, updatedAt: now };

  if (dynamoClient) {
    const names = {};
    const values = { ':updatedAt': now };
    const sets = ['updatedAt = :updatedAt'];
    for (const [key, value] of Object.entries(fields)) {
      const nameKey = `#${key}`;
      const valueKey = `:${key}`;
      names[nameKey] = key;
      values[valueKey] = value;
      sets.push(`${nameKey} = ${valueKey}`);
    }
    const result = await dynamoClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { letterId },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })
    );
    return result.Attributes;
  }

  const current = memoryStore.get(letterId);
  if (!current) return null;
  const updated = { ...current, ...mergedFields };
  memoryStore.set(letterId, updated);
  return updated;
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

async function scanUnclaimedTravelerPage(exclusiveStartKey) {
  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression:
        '#type = :traveler AND #status = :public AND (attribute_not_exists(claimed) OR claimed = :false)',
      ExpressionAttributeNames: {
        '#type': 'type',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':traveler': 'TRAVELER',
        ':public': 'PUBLIC',
        ':false': false,
      },
      Limit: 50,
      ExclusiveStartKey: exclusiveStartKey,
    })
  );
  return result;
}

async function conditionalClaim(letterId) {
  const now = new Date().toISOString();
  const updated = await dynamoClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { letterId },
      UpdateExpression:
        'SET claimed = :true, claimedAt = :now, #status = :claimed, updatedAt = :now',
      ConditionExpression: 'attribute_not_exists(claimed) OR claimed = :false',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':true': true,
        ':false': false,
        ':now': now,
        ':claimed': 'CLAIMED',
      },
      ReturnValues: 'ALL_NEW',
    })
  );
  return updated.Attributes;
}

/**
 * Atomically claim one unclaimed PUBLIC TRAVELER letter.
 * Returns the letter or null if none available.
 *
 * FIX #3: retries against remaining candidates instead of giving up as soon
 * as it loses one race.
 * FIX #4: paginates the scan (up to CLAIM_SCAN_MAX_PAGES pages) instead of
 * only ever looking at the first 50 items in the table.
 */
async function claimRandomTravelerLetter() {
  if (dynamoClient) {
    let exclusiveStartKey;
    let pagesScanned = 0;

    do {
      const result = await scanUnclaimedTravelerPage(exclusiveStartKey);// just pick any not need unlamed //maybe not needed
      const pool = [...(result.Items || [])];
      pagesScanned += 1;

      while (pool.length) {
        const idx = Math.floor(Math.random() * pool.length);
        const pick = pool.splice(idx, 1)[0];
        try {
          return await conditionalClaim(pick.letterId);
        } catch (error) {
          if (error.name !== 'ConditionalCheckFailedException') throw error;
          // someone else claimed it first — try the next candidate
        }
      }

      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey && pagesScanned < CLAIM_SCAN_MAX_PAGES);

    return null;
  }

  // in-memory fallback
  const candidates = [...memoryStore.values()].filter(
    (l) => l.type === 'TRAVELER' && l.status === 'PUBLIC' && !l.claimed
  );
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const now = new Date().toISOString();
  const updated = {
    ...pick,
    claimed: true,
    claimedAt: now,
    status: 'CLAIMED',
    updatedAt: now,
  };
  memoryStore.set(pick.letterId, updated);
  return updated;
}

async function setTerminalStatus(letterId, status, fromStatus = 'PENDING') {
  const now = new Date();
  const expiresAt =
    Math.floor(now.getTime() / 1000) + RETENTION_DAYS_AFTER_TERMINAL_STATE * 86400;

  if (dynamoClient) {
    try {
      const result = await dynamoClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { letterId },
          UpdateExpression:
            'SET #status = :status, updatedAt = :now, expiresAt = :expiresAt',
          ConditionExpression: '#status = :from',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': status,
            ':now': now.toISOString(),
            ':expiresAt': expiresAt,
            ':from': fromStatus,
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

  const current = memoryStore.get(letterId);
  if (!current || current.status !== fromStatus) {
    return { updated: false, letter: current || null };
  }
  const updated = {
    ...current,
    status,
    updatedAt: now.toISOString(),
    expiresAt,
  };
  memoryStore.set(letterId, updated);
  return { updated: true, letter: updated };
}

// FIX #1: EventBridge Scheduler's at() expression does not accept milliseconds
// or a trailing "Z" — it wants literal local-format `at(yyyy-mm-ddThh:mm:ss)`,
// interpreted in the schedule's configured timezone (UTC here). toISOString()
// produces "...T10:30:00.000Z", which CreateScheduleCommand rejects with
// ValidationException. Strip milliseconds and the Z suffix.
function toSchedulerTimestamp(iso) {
  return new Date(iso).toISOString().slice(0, 19); // "2026-08-08T10:30:00"
}

function scheduleParams(letter) {
  const scheduleName = `letter-${letter.letterId}`.slice(0, 64);
  return {
    Name: scheduleName,
    ScheduleExpression: `at(${toSchedulerTimestamp(letter.scheduledAt)})`,
    ScheduleExpressionTimezone: 'UTC',
    State: 'ENABLED',
    Target: {
      // Self-invocation: this points at THIS SAME Lambda function's ARN.
      // EventBridge Scheduler calls it directly (bypassing API Gateway
      // entirely) with Input as the event body — that's what index.js's
      // `isApiGatewayEvent` check is for, to route it to the send logic
      // below instead of the Express app.
      Arn: process.env.SEND_MESSAGE_LAMBDA_ARN,
      RoleArn: process.env.EVENTBRIDGE_SCHEDULE_ROLE_ARN,
      Input: JSON.stringify({ letterId: letter.letterId }),
      RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 },
    },
    FlexibleTimeWindow: { Mode: 'OFF' },
    Description: `Send letter ${letter.letterId}`,
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
      note: 'EventBridge Scheduler not configured. Letter saved; schedule once AWS env vars are set.',
    };
  }

  const params = scheduleParams(letter);
  await scheduler.send(new CreateScheduleCommand(params));
  return { mode: 'eventbridge', scheduleName: params.Name };
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
      updatedAt: now.toISOString(),
    };

    await saveLetter(failedLetter);
    return { scheduled: false, letter: failedLetter };
  }

  const backoffMs = Math.min(
    RETRY_BACKOFF_SECONDS * 1000 * 2 ** (attempt - 1),
    24 * 60 * 60 * 1000
  );
  const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
  const retryLetter = {
    ...letter,
    status: 'PENDING',
    retryCount: attempt,
    lastError: error.message,
    nextRetryAt,
    failedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const scheduleResult = await createOneTimeSchedule({
    ...retryLetter,
    scheduledAt: nextRetryAt,
  });
  if (scheduleResult.scheduleName) {
    retryLetter.scheduleName = scheduleResult.scheduleName;
  }

  await saveLetter(retryLetter);
  return { scheduled: true, letter: retryLetter, scheduleResult };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
/**
 * POST /letters
 * Single endpoint for both SELF and TRAVELER letters.
 * Body must include `type` and `turnstileToken`.
 */
app.post('/letters', async (req, res) => {
  const startedAt = Date.now();

  try {
    // 1. Turnstile first — reject bots before any validation work
    const remoteip =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.socket?.remoteAddress;//maybe not needed

    const captcha = await verifyTurnstileToken(req.body?.turnstileToken, remoteip);
    if (!captcha.success) {
      log('error', 'turnstile_verification_failed', {
        requestId: req.requestId,
        errorCodes: captcha.errorCodes,
      });
      return res.status(403).json({
        success: false,
        error: 'captcha_failed',
        errorCodes: captcha.errorCodes,
      });
    }

    // 2. Validate payload by type
    const parsed = createLetterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'validation_failed',
        details: parsed.error.flatten(),
      });
    }

    const data = parsed.data;

    // 3. Build + persist (never store turnstileToken)
    const letter = buildLetterRecord(data);

    try {
      await saveLetter(letter, { ifNotExists: true });
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        letter.letterId = randomUUID();
        await saveLetter(letter, { ifNotExists: true });
      } else {
        throw error;
      }
    }

    // 4. SELF only — schedule delivery
    let scheduleResult = null;
    if (letter.type === 'SELF') {
      scheduleResult = await createOneTimeSchedule(letter);
      if (scheduleResult.scheduleName) {
        const patched = await patchLetterFields(letter.letterId, {//what
          scheduleName: scheduleResult.scheduleName,
        });
        letter.scheduleName = patched?.scheduleName ?? scheduleResult.scheduleName;
        letter.updatedAt = patched?.updatedAt ?? letter.updatedAt;
      }
    }

    log('info', 'letter_created', {
      requestId: req.requestId,
      letterId: letter.letterId,
      type: letter.type,
      scheduleMode: scheduleResult?.mode || null,
      durationMs: Date.now() - startedAt,
    });

    return res.status(201).json({
      success: true,
      letter: {
        letterId: letter.letterId,
        type: letter.type,
        status: letter.status,
        createdAt: letter.createdAt,
        ...(letter.type === 'SELF'
          ? { scheduledAt: letter.scheduledAt, scheduleName: letter.scheduleName }
          : {}),
      },
      schedule: scheduleResult,
    });
  } catch (error) {
    log('error', 'letter_create_failed', { requestId: req.requestId, error: error.message });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to create letter.',
    });
  }
});

/**
 * GET /letters/traveler/random
 * Picks one unclaimed TRAVELER letter and marks it CLAIMED
 * so each letter is only delivered once.
 */
app.get('/letters/traveler/random', async (req, res) => {
  try {
    const letter = await claimRandomTravelerLetter();//maybe not needed
    if (!letter) {
      return res.status(404).json({
        success: false,
        error: 'none_available',
        message: 'No traveler letters remain by the fire.',
      });
    }

    return res.json({
      success: true,
      letter: {
        letterId: letter.letterId,
        message: letter.message,
        createdAt: letter.createdAt,
      },
    });
  } catch (error) {
    log('error', 'letter_claim_failed', { requestId: req.requestId, error: error.message });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Failed to fetch a traveler letter.',
    });
  }
});

if (!isLambda) {
  app.listen(port, () => {
    log('info', 'server_started', { port });
  });
}

export { app };

// ---------------------------------------------------------------------------
// handler: EventBridge Scheduler target at delivery time (SELF letters only)
// Invoked directly by EventBridge Scheduler (see scheduleParams() Target.Arn
// above) — never through API Gateway. index.js routes to this based on the
// absence of a top-level `httpMethod` on the event.
// ---------------------------------------------------------------------------
export async function handler(event) {
  const startedAt = Date.now();
  const requestId = event?.requestContext?.requestId || randomUUID();
  let letterId = event?.letterId || event?.detail?.letterId;

  if (!letterId && event?.body) {
    try {
      const parsed = JSON.parse(event.body);
      letterId = parsed.letterId;
    } catch {
      letterId = event.body;
    }
  }

  if (!letterId) {
    log('error', 'handler_missing_letter_id', { requestId });
    return { success: false, message: 'letterId is required.' };
  }

  const letter = await getLetter(letterId);
  if (!letter) {
    log('error', 'handler_letter_not_found', { requestId, letterId });
    return { success: false, message: 'Letter not found.' };
  }

  if (letter.type !== 'SELF') {
    log('info', 'handler_skip_non_self', { requestId, letterId, type: letter.type });
    return { success: true, letterId, message: 'Not a SELF letter — nothing to send.' };
  }

  if (letter.status === 'SENT' || letter.status === 'CANCELLED' || letter.status === 'FAILED') {
    log('info', 'handler_already_handled', { requestId, letterId, status: letter.status });
    return {
      success: true,
      letterId,
      status: letter.status,
      message: 'Letter already handled.',
    };
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
      updatedAt: now.toISOString(),
    };
    await saveLetter(persistedLetter);

    log('info', 'handler_completed', {
      requestId,
      letterId,
      sentNow: updated,
      sendMode: sendResult.mode,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true,
      letterId,
      status: persistedLetter.status,
      sendResult,
    };
  } catch (error) {
    const retryResult = await scheduleRetry(letter, error);
    log('error', 'handler_send_failed', {
      requestId,
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