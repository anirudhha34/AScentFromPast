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

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 5000;

async function verifyTurnstileToken(token, remoteip) {
  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }
  const secret = process.env.TURNSTILE_SECRET_KEY || '';
  if (!secret) {
    console.error('TURNSTILE_SECRET_KEY is not set — refusing to verify.');
    return { success: false, errorCodes: ['missing-secret-key'] };
  }
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.append('remoteip', remoteip);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
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
    return { success: !!data.success, errorCodes: data['error-codes'] || [] };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    console.error('Turnstile verification request failed:', isTimeout ? 'timeout' : err.message);
    return { success: false, errorCodes: [isTimeout ? 'timeout' : 'network-error'] };
  } finally {
    clearTimeout(timeout);
  }
}

const app = express();
const port = process.env.PORT || 4000;
const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const allowedOrigins = (
  process.env.CORS_ORIGIN || 'http://localhost:3000,http://127.0.0.1:5173,http://localhost:5173'
).split(',').map((o) => o.trim()).filter(Boolean);

app.use(express.json({ limit: '32kb' }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use((req, res, next) => {
  req.requestId = req.headers['x-amzn-trace-id'] || randomUUID();
  next();
});

function log(level, msg, meta = {}) {
  const entry = { level, msg, ts: new Date().toISOString(), ...meta };
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

if (isLambda && !dynamoClient) {
  throw new Error(
    'DynamoDB is not configured (DYNAMODB_TABLE_NAME / AWS_REGION missing). Refusing to start in Lambda with the in-memory fallback.'
  );
}

const scheduler = process.env.AWS_REGION ? new SchedulerClient({ region: process.env.AWS_REGION }) : null;

const transporter =
  process.env.SES_SMTP_HOST && process.env.SES_SMTP_USERNAME && process.env.SES_SMTP_PASSWORD
    ? nodemailer.createTransport({
        host: process.env.SES_SMTP_HOST,
        port: Number(process.env.SES_SMTP_PORT || 587),
        secure: false,
        auth: { user: process.env.SES_SMTP_USERNAME, pass: process.env.SES_SMTP_PASSWORD },
      })
    : null;

const RETENTION_DAYS_AFTER_TERMINAL_STATE = Number(process.env.RETENTION_DAYS || 30);
const MAX_RETRY_ATTEMPTS = Number(process.env.MAX_RETRY_ATTEMPTS || 3);
const RETRY_BACKOFF_SECONDS = Number(process.env.RETRY_BACKOFF_SECONDS || 900);
const CLAIM_SCAN_MAX_PAGES = 5;

const selfLetterSchema = z.object({
  type: z.literal('SELF'),
  message: z.string().trim().min(8).max(1200),
  email: z.string().trim().email(),
  scheduledAt: z.string().datetime().refine((v) => new Date(v).getTime() > Date.now() - 60_000),
  turnstileToken: z.string().min(1),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

const travelerLetterSchema = z.object({
  type: z.literal('TRAVELER'),
  message: z.string().trim().min(8).max(1200),
  turnstileToken: z.string().min(1),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

const createLetterSchema = z.discriminatedUnion('type', [selfLetterSchema, travelerLetterSchema]);

function buildLetterRecord(body) {
  const now = new Date().toISOString();
  const letterId = randomUUID();
  if (body.type === 'SELF') {
    return {
      letterId, type: 'SELF', status: 'PENDING', message: body.message, email: body.email,
      scheduledAt: new Date(body.scheduledAt).toISOString(), scheduleName: null,
      idempotencyKey: body.idempotencyKey || null, createdAt: now, updatedAt: now,
      expiresAt: null, retryCount: 0, lastError: null, nextRetryAt: null, sentAt: null,
      cancelledAt: null, failedAt: null,
    };
  }
  return {
    letterId, type: 'TRAVELER', status: 'PUBLIC', message: body.message,
    idempotencyKey: body.idempotencyKey || null, claimed: false, claimedAt: null,
    createdAt: now, updatedAt: now,
  };
}

async function saveLetter(letter, { ifNotExists = false } = {}) {
  if (dynamoClient) {
    await dynamoClient.send(new PutCommand({
      TableName: TABLE_NAME, Item: letter,
      ...(ifNotExists ? { ConditionExpression: 'attribute_not_exists(letterId)' } : {}),
    }));
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

async function patchLetterFields(letterId, fields) {
  const now = new Date().toISOString();
  const mergedFields = { ...fields, updatedAt: now };
  if (dynamoClient) {
    const names = {}; const values = { ':updatedAt': now }; const sets = ['updatedAt = :updatedAt'];
    for (const [key, value] of Object.entries(fields)) {
      names[`#${key}`] = key; values[`:${key}`] = value; sets.push(`#${key} = :${key}`);
    }
    const result = await dynamoClient.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: { letterId }, UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW',
    }));
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
    const result = await dynamoClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { letterId } }));
    return result.Item || null;
  }
  return memoryStore.get(letterId) || null;
}

async function scanUnclaimedTravelerPage(exclusiveStartKey) {
  const result = await dynamoClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: '#type = :traveler AND #status = :public AND (attribute_not_exists(claimed) OR claimed = :false)',
    ExpressionAttributeNames: { '#type': 'type', '#status': 'status' },
    ExpressionAttributeValues: { ':traveler': 'TRAVELER', ':public': 'PUBLIC', ':false': false },
    Limit: 50, ExclusiveStartKey: exclusiveStartKey,
  }));
  return result;
}

async function conditionalClaim(letterId) {
  const now = new Date().toISOString();
  const updated = await dynamoClient.send(new UpdateCommand({
    TableName: TABLE_NAME, Key: { letterId },
    UpdateExpression: 'SET claimed = :true, claimedAt = :now, #status = :claimed, updatedAt = :now',
    ConditionExpression: 'attribute_not_exists(claimed) OR claimed = :false',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':true': true, ':false': false, ':now': now, ':claimed': 'CLAIMED' },
    ReturnValues: 'ALL_NEW',
  }));
  return updated.Attributes;
}

async function claimRandomTravelerLetter() {
  if (dynamoClient) {
    let exclusiveStartKey; let pagesScanned = 0;
    do {
      const result = await scanUnclaimedTravelerPage(exclusiveStartKey);
      const pool = [...(result.Items || [])];
      pagesScanned += 1;
      while (pool.length) {
        const idx = Math.floor(Math.random() * pool.length);
        const pick = pool.splice(idx, 1)[0];
        try {
          return await conditionalClaim(pick.letterId);
        } catch (error) {
          if (error.name !== 'ConditionalCheckFailedException') throw error;
        }
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey && pagesScanned < CLAIM_SCAN_MAX_PAGES);
    return null;
  }
  const candidates = [...memoryStore.values()].filter((l) => l.type === 'TRAVELER' && l.status === 'PUBLIC' && !l.claimed);
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const now = new Date().toISOString();
  const updated = { ...pick, claimed: true, claimedAt: now, status: 'CLAIMED', updatedAt: now };
  memoryStore.set(pick.letterId, updated);
  return updated;
}

async function setTerminalStatus(letterId, status, fromStatus = 'PENDING') {
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + RETENTION_DAYS_AFTER_TERMINAL_STATE * 86400;
  if (dynamoClient) {
    try {
      const result = await dynamoClient.send(new UpdateCommand({
        TableName: TABLE_NAME, Key: { letterId },
        UpdateExpression: 'SET #status = :status, updatedAt = :now, expiresAt = :expiresAt',
        ConditionExpression: '#status = :from',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status, ':now': now.toISOString(), ':expiresAt': expiresAt, ':from': fromStatus },
        ReturnValues: 'ALL_NEW',
      }));
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
  const updated = { ...current, status, updatedAt: now.toISOString(), expiresAt };
  memoryStore.set(letterId, updated);
  return { updated: true, letter: updated };
}

function toSchedulerTimestamp(iso) {
  return new Date(iso).toISOString().slice(0, 19);
}

function scheduleParams(letter) {
  const scheduleName = `letter-${letter.letterId}`.slice(0, 64);
  return {
    Name: scheduleName,
    ScheduleExpression: `at(${toSchedulerTimestamp(letter.scheduledAt)})`,
    ScheduleExpressionTimezone: 'UTC',
    State: 'ENABLED',
    Target: {
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
  // FIX: previously silently returned a mock schedule name when EventBridge
  // wasn't configured — the letter would be saved and the API would respond
  // 201 success, but no schedule would ever exist, so the letter would just
  // sit as PENDING forever with no way to know why. Fail loudly instead.
  if (
    !scheduler ||
    !process.env.EVENTBRIDGE_SCHEDULE_ROLE_ARN ||
    !process.env.SEND_MESSAGE_LAMBDA_ARN ||
    !letter.scheduledAt
  ) {
    throw new Error(
      'EventBridge Scheduler is not configured (EVENTBRIDGE_SCHEDULE_ROLE_ARN / SEND_MESSAGE_LAMBDA_ARN missing).'
    );
  }
  const params = scheduleParams(letter);
  await scheduler.send(new CreateScheduleCommand(params));
  return { mode: 'eventbridge', scheduleName: params.Name };
}

function escapeHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderLetterHtml(letter) {
  const createdDate = new Date(letter.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const deliveredDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const safeMessage = escapeHtml(letter.message || '');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">

<style>
body {
  margin: 0;
  padding: 0;
  background: #14110d;
  font-family: Georgia, "Times New Roman", serif;
  color: #2f2417;
}

.wrapper {
  width: 100%;
  padding: 50px 16px;
  box-sizing: border-box;
}

.paper {
  max-width: 700px;
  margin: 0 auto;
  background: #f4e1b9;
  border-radius: 6px;
  padding: 55px 60px;
  box-sizing: border-box;
  box-shadow:
    0 18px 50px rgba(0, 0, 0, 0.45),
    inset 0 0 70px rgba(115, 79, 35, 0.08);
}

/* Heading */

.heading {
  text-align: center;
  font-size: 42px;
  line-height: 1.2;
  font-weight: normal;
  color: #43311c;
  margin-bottom: 14px;
}

.sub {
  text-align: center;
  color: #765c3d;
  font-size: 16px;
  line-height: 1.7;
  font-style: italic;
  margin-bottom: 38px;
}

/* Decorative divider */

.divider {
  text-align: center;
  color: #98764d;
  margin: 32px 0;
  letter-spacing: 5px;
  font-size: 14px;
}

/* Actual letter */

.letter {
  font-size: 21px;
  line-height: 1.95;
  color: #332312;
  white-space: pre-wrap;
  text-align: left;
  padding: 10px 4px;
}

/* Closing */

.footer {
  margin-top: 45px;
  text-align: center;
  color: #806849;
  font-size: 17px;
  font-style: italic;
  line-height: 1.6;
}

.small {
  text-align: center;
  color: #927c5b;
  margin-top: 24px;
  font-size: 13px;
  line-height: 1.7;
}

/* Small final signature */

.signature {
  margin-top: 32px;
  padding-top: 22px;
  border-top: 1px solid rgba(93, 67, 37, 0.18);
  text-align: center;
  color: #8a704f;
  font-size: 12px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

/* Mobile */

@media screen and (max-width: 600px) {

  .wrapper {
    padding: 20px 10px;
  }

  .paper {
    padding: 38px 24px;
  }

  .heading {
    font-size: 32px;
  }

  .sub {
    font-size: 14px;
    margin-bottom: 30px;
  }

  .divider {
    margin: 25px 0;
    letter-spacing: 3px;
  }

  .letter {
    font-size: 18px;
    line-height: 1.8;
  }

  .footer {
    margin-top: 35px;
    font-size: 15px;
  }

  .small {
    font-size: 12px;
  }
}
</style>

</head>

<body>

<div class="wrapper">

  <div class="paper">

    <div class="heading">
      Dear Future Me,
    </div>

    <div class="sub">
      This letter has travelled through time.<br>
      It waited patiently for this exact moment.
    </div>


    <div class="divider">
      ──────── ◇ ────────
    </div>


    <div class="letter">${safeMessage}</div>


    <div class="divider">
      ──────── ◇ ────────
    </div>


    <div class="footer">
      Time remembers what we forget.
    </div>


    <div class="small">
      Written on ${createdDate}<br>
      Delivered on ${deliveredDate}
    </div>


    <div class="signature">
      Entrusted to time
    </div>

  </div>

</div>

</body>
</html>`;
}

async function sendLetterViaSes(letter) {
  // FIX: previously silently returned a mock "success" when SES wasn't
  // configured — a letter's status could be marked SENT without any email
  // ever going out. Fail loudly instead, so it flows into the existing
  // scheduleRetry() path like any other send failure, and shows up in logs.
  if (!transporter || !process.env.SES_FROM_EMAIL) {
    throw new Error(
      'SES is not configured (SES_SMTP_HOST/USERNAME/PASSWORD or SES_FROM_EMAIL missing).'
    );
  }
  const html = renderLetterHtml(letter);
  await transporter.sendMail({
    from: process.env.SES_FROM_EMAIL, to: letter.email,
    subject: 'Yourself from the Past: A Letter for You', html, text: letter.message,
  });
  return { mode: 'nodemailer' };
}

async function scheduleRetry(letter, error) {
  const attempt = (letter.retryCount || 0) + 1;
  const now = new Date();
  if (attempt > MAX_RETRY_ATTEMPTS) {
    const failedLetter = { ...letter, status: 'FAILED', retryCount: attempt - 1, lastError: error.message, failedAt: now.toISOString(), nextRetryAt: null, updatedAt: now.toISOString() };
    await saveLetter(failedLetter);
    return { scheduled: false, letter: failedLetter };
  }
  const backoffMs = Math.min(RETRY_BACKOFF_SECONDS * 1000 * 2 ** (attempt - 1), 24 * 60 * 60 * 1000);
  const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
  const retryLetter = { ...letter, status: 'PENDING', retryCount: attempt, lastError: error.message, nextRetryAt, failedAt: now.toISOString(), updatedAt: now.toISOString() };

  let scheduleResult;
  try {
    scheduleResult = await createOneTimeSchedule({ ...retryLetter, scheduledAt: nextRetryAt });
    retryLetter.scheduleName = scheduleResult.scheduleName;
  } catch (scheduleError) {
    // FIX: createOneTimeSchedule now throws instead of returning a mock
    // result. If re-scheduling the retry itself fails (e.g. EventBridge is
    // down or misconfigured), don't let that exception crash the handler —
    // fall through to FAILED so it's visible instead of silently vanishing.
    log('error', 'retry_schedule_failed', { letterId: letter.letterId, error: scheduleError.message });
    const failedLetter = { ...retryLetter, status: 'FAILED', lastError: scheduleError.message, nextRetryAt: null };
    await saveLetter(failedLetter);
    return { scheduled: false, letter: failedLetter };
  }

  await saveLetter(retryLetter);
  return { scheduled: true, letter: retryLetter, scheduleResult };
}

app.post('/letters', async (req, res) => {
  const startedAt = Date.now();
  try {
    const remoteip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket?.remoteAddress;
    const captcha = await verifyTurnstileToken(req.body?.turnstileToken, remoteip);
    if (!captcha.success) {
      log('error', 'turnstile_verification_failed', { requestId: req.requestId, errorCodes: captcha.errorCodes });
      return res.status(403).json({ success: false, error: 'captcha_failed', errorCodes: captcha.errorCodes });
    }
    const parsed = createLetterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'validation_failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;
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
    let scheduleResult = null;
    if (letter.type === 'SELF') {
      try {
        scheduleResult = await createOneTimeSchedule(letter);
        const patched = await patchLetterFields(letter.letterId, { scheduleName: scheduleResult.scheduleName });
        letter.scheduleName = patched?.scheduleName ?? scheduleResult.scheduleName;
        letter.updatedAt = patched?.updatedAt ?? letter.updatedAt;
      } catch (scheduleError) {
        // FIX: the letter was already saved as PENDING above. If scheduling
        // throws, don't leave it silently stuck as PENDING forever with no
        // schedule and no explanation — mark it FAILED so it's visible and
        // won't be mistaken for a letter that's just waiting its turn.
        log('error', 'letter_schedule_failed', {
          requestId: req.requestId,
          letterId: letter.letterId,
          error: scheduleError.message,
        });
        await setTerminalStatus(letter.letterId, 'FAILED', 'PENDING');
        return res.status(500).json({
          success: false,
          error: 'schedule_failed',
          message: 'Your letter was not scheduled. Please try again.',
        });
      }
    }
    log('info', 'letter_created', { requestId: req.requestId, letterId: letter.letterId, type: letter.type, scheduleMode: scheduleResult?.mode || null, durationMs: Date.now() - startedAt });
    return res.status(201).json({
      success: true,
      letter: {
        letterId: letter.letterId, type: letter.type, status: letter.status, createdAt: letter.createdAt,
        ...(letter.type === 'SELF' ? { scheduledAt: letter.scheduledAt, scheduleName: letter.scheduleName } : {}),
      },
      schedule: scheduleResult,
    });
  } catch (error) {
    log('error', 'letter_create_failed', { requestId: req.requestId, error: error.message });
    return res.status(500).json({ success: false, error: 'server_error', message: 'Failed to create letter.' });
  }
});

app.get('/letters/traveler/random', async (req, res) => {
  try {
    const letter = await claimRandomTravelerLetter();
    if (!letter) {
      return res.status(404).json({ success: false, error: 'none_available', message: 'No traveler letters remain by the fire.' });
    }
    return res.json({ success: true, letter: { letterId: letter.letterId, message: letter.message, createdAt: letter.createdAt } });
  } catch (error) {
    log('error', 'letter_claim_failed', { requestId: req.requestId, error: error.message });
    return res.status(500).json({ success: false, error: 'server_error', message: 'Failed to fetch a traveler letter.' });
  }
});

if (!isLambda) {
  app.listen(port, () => { log('info', 'server_started', { port }); });
}

export { app };

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
    return { success: true, letterId, status: letter.status, message: 'Letter already handled.' };
  }
  try {
    const sendResult = await sendLetterViaSes(letter);
    const { updated, letter: finalLetter } = await setTerminalStatus(letterId, 'SENT');
    const now = new Date();
    const persistedLetter = { ...(finalLetter || letter), status: 'SENT', sentAt: now.toISOString(), lastError: null, nextRetryAt: null, failedAt: null, updatedAt: now.toISOString() };
    await saveLetter(persistedLetter);
    log('info', 'handler_completed', { requestId, letterId, sentNow: updated, sendMode: sendResult.mode, durationMs: Date.now() - startedAt });
    return { success: true, letterId, status: persistedLetter.status, sendResult };
  } catch (error) {
    const retryResult = await scheduleRetry(letter, error);
    log('error', 'handler_send_failed', { requestId, letterId, error: error.message, retryScheduled: retryResult.scheduled });
    return { success: false, letterId, status: retryResult.letter?.status || 'PENDING', retry: retryResult, message: 'Letter delivery failed; retry scheduled.' };
  }
}