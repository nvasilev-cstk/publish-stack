import { loadConfig } from './lib/config.js';
import { makeStack } from './lib/stackClient.js';
import { RateLimiter } from './lib/rateLimiter.js';
import { runStep } from './lib/pipelineStep.js';

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
    response.status(400).json({ error: err.message });
    return;
  }

  const body = request.body || {};
  const { state, dryRun, stackApiKey } = body;

  if (stackApiKey && stackApiKey !== config.apiKey) {
    response.status(400).json({
      error: `This app is configured for a different stack (expected a key ending in ...${config.apiKey.slice(-6)}).`,
    });
    return;
  }

  const stack = makeStack(config);
  const limiter = new RateLimiter(config.rateLimitRps);

  try {
    const result = await runStep(stack, limiter, config, state, dryRun);
    response.status(200).json(result);
  } catch (err) {
    response.status(500).json({ error: err.message || String(err) });
  }
}
