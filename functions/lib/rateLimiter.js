const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Spaces out call *initiation* at a fixed rate (CMA's 10 req/s limit is
// enforced per request received, not per request completed), while letting
// slow calls run concurrently instead of blocking the queue behind them.
export class RateLimiter {
  constructor(requestsPerSecond) {
    this.minInterval = 1000 / requestsPerSecond;
    this.nextSlot = Date.now();
    this.gate = Promise.resolve();
  }

  _reserveSlot() {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minInterval;
    const delay = slot - now;
    return delay > 0 ? sleep(delay) : Promise.resolve();
  }

  schedule(fn) {
    this.gate = this.gate.then(() => this._reserveSlot());
    return this.gate.then(fn);
  }
}

export async function withRetry(fn, { retries = 5, baseDelayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err?.status !== 429 || attempt >= retries) throw err;
      const delay = err.retryAfterSeconds ? err.retryAfterSeconds * 1000 : baseDelayMs * 2 ** attempt;
      await sleep(delay);
    }
  }
}
