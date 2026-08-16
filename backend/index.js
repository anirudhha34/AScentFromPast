// index.js
// Single Lambda entry point, two trigger sources:
//   1. API Gateway REST API  -> POST /letters, GET /letters/traveler/random
//   2. EventBridge Scheduler -> fires later to actually send a SELF letter
//
// REST API (not HTTP API) Lambda-proxy events carry a top-level `httpMethod`.
// EventBridge Scheduler invocations never do — they're just the plain
// payload we set as `Input` in scheduleParams() (`{ letterId }`).
// That's the only reliable signal to branch on.

import serverless from 'serverless-http';
import { app, handler as sendLetterHandler } from './server.js';

const expressHandler = serverless(app);

export async function handler(event, context) {
  const isApiGatewayEvent = Boolean(event?.httpMethod);

  if (isApiGatewayEvent) {
    // HTTP API named stages (anything but $default) include the stage name
    // as a prefix in `path` even though routing already matched without it.
    // Strip it so Express sees a clean path regardless of which stage this
    // request came through.
    const stage = event.requestContext?.stage;
    if (stage && stage !== '$default' && event.path?.startsWith(`/${stage}`)) {
      event.path = event.path.slice(stage.length + 1) || '/';
    }
    return expressHandler(event, context);
  }

  return sendLetterHandler(event, context);
}