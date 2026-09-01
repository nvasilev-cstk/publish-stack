import { loadConfig } from './lib/config.js';
import { RateLimiter } from './lib/rateLimiter.js';
import { makeCmaClient } from './lib/cma.js';
import { runPublishPipeline } from './lib/pipeline.js';

// Streams newline-delimited JSON progress events for the whole publish run
// over a single long-lived connection. Launch Edge Functions have no
// duration limit as long as the client keeps the connection open, which is
// what a job-queue-plus-polling model can't rely on here: Cloud Functions
// cap out at 30s, and neither function type keeps in-memory state reliably
// across separate invocations.
export default async function handler(request, context) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === 'true';
  const requestedStackApiKey = url.searchParams.get('stackApiKey');

  let config;
  try {
    config = loadConfig(context.env);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Safety net: this app is wired to one stack via its Management Token. If
  // it's ever installed on a different stack, refuse rather than silently
  // bulk-publishing the wrong one.
  if (requestedStackApiKey && requestedStackApiKey !== config.apiKey) {
    return new Response(
      JSON.stringify({
        error: `This app is configured for a different stack (expected a key ending in ...${config.apiKey.slice(-6)}).`,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();
  const limiter = new RateLimiter(config.rateLimitRps);
  const client = makeCmaClient(config, limiter);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runPublishPipeline(client, config, { dryRun })) {
          send(event);
        }
      } catch (err) {
        send({ type: 'fatal', message: err?.message || String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  });
}
