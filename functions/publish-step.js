import { loadConfig } from './lib/config.js';
import { makeStack } from './lib/stackClient.js';
import { RateLimiter } from './lib/rateLimiter.js';
import { runStep, initialState } from './lib/pipelineStep.js';
import { describeError } from './lib/errors.js';

// One bounded (~20s) unit of the publish job per call. The widget drives a
// loop: it holds the returned `state` in memory and POSTs it right back on
// the next call until `done` is true. No server-side job storage, which
// matters because Cloud Functions don't keep state between invocations —
// see ../README.md for why this is chunked instead of a single streamed run.
export default async function handler(request, response) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('publish-step: config error', describeError(err));
    response.status(400).json({ error: err.message });
    return;
  }

  const body = request.body || {};
  const { dryRun, stackApiKey } = body;
  const incomingState = body.state;
  // Constructed here (not inside runStep) so this handler can report
  // state.phase even if something throws before runStep gets to run it.
  const state = incomingState && incomingState.phase ? incomingState : initialState(dryRun);

  if (stackApiKey && stackApiKey !== config.apiKey) {
    const message = `This app is configured for a different stack (expected a key ending in ...${config.apiKey.slice(-6)}).`;
    console.error('publish-step: stack key mismatch', { requestedStackApiKey: stackApiKey, expected: config.apiKey });
    response.status(400).json({ error: message });
    return;
  }

  // Everything below (including client construction) is inside the guard —
  // an uncaught synchronous throw here would otherwise surface to the
  // browser as an opaque 502 instead of a readable JSON error. Errors from
  // inside the pipeline itself (a locale/entries/assets call failing) don't
  // reach here — runStep catches those and returns them as a normal 200
  // with an `error` field, since they're informative results, not crashes.
  try {
    const stack = await makeStack(config);
    const limiter = new RateLimiter(config.rateLimitRps);
    const result = await runStep(stack, limiter, config, state, dryRun);
    if (result.error) {
      console.error('publish-step: pipeline error', result.error);
    }
    response.status(200).json(result);
  } catch (err) {
    const details = describeError(err, state.phase);
    console.error('publish-step: unexpected error', details);
    response.status(500).json({ error: details.message, details });
  }
}
