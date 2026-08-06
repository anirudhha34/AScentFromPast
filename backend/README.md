# AScent From The Past backend

This backend follows a serverless letter delivery architecture:

1. `POST /letters` stores a letter in DynamoDB and creates a one-time EventBridge Scheduler.
2. EventBridge invokes a `send-letter` Lambda at the scheduled time.
3. The Lambda reads the letter, sends it via `nodemailer` + Amazon SES, and updates the status to `SENT`.
4. `PUT /letters/:letterId` updates the letter and reschedules it when the date changes.
5. `DELETE /letters/:letterId` cancels the letter and marks it as `CANCELLED`.

## Local run

```bash
cd backend
npm install
npm run dev
```

## Environment variables

Copy `.env.example` to `.env` and fill in the AWS and SES values before connecting to real cloud services.

## Example requests

Create a letter:

```bash
curl -X POST http://localhost:4000/letters \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","message":"Hello from the future","scheduledAt":"2030-01-01T00:00:00.000Z"}'
```

Update a letter:

```bash
curl -X PUT http://localhost:4000/letters/<letterId> \
  -H "Content-Type: application/json" \
  -d '{"scheduledAt":"2031-01-01T00:00:00.000Z"}'
```

Cancel a letter:

```bash
curl -X DELETE http://localhost:4000/letters/<letterId>
```
