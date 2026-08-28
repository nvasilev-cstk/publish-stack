import { withRetry } from './rateLimiter.js';

export class CmaError extends Error {
  constructor(status, body) {
    super(`CMA request failed (${status}): ${JSON.stringify(body).slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

// Raw REST client — deliberately not the @contentstack/management SDK,
// since Launch Edge Functions run a WinterCG runtime with no Node.js APIs
// (the SDK's axios transport needs Node's http/https modules). Request/
// response shapes below were confirmed against the SDK's own bundled
// source (dist/node/contentstack-management.js) so they match it exactly:
// publish bodies are `{ [entry|asset]: { locales, environments }, locale }`,
// list responses key their items as content_types/entries/assets/locales.
export function makeCmaClient(config, limiter) {
  async function request(path, { method = 'GET', body, query } = {}) {
    const url = new URL(`https://${config.host}/v3${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    return withRetry(() =>
      limiter.schedule(async () => {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            api_key: config.apiKey,
            authorization: config.managementToken,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = new CmaError(res.status, data);
          const retryAfter = res.headers.get('retry-after');
          if (retryAfter) err.retryAfterSeconds = Number(retryAfter);
          throw err;
        }
        return data;
      })
    );
  }

  return { request };
}
