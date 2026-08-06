const { stack } = require('./client');
const { PAGE_SIZE, ENVIRONMENT } = require('./config');
const { withRetry } = require('./rateLimiter');
const { chunk } = require('./utils');

const MAX_LOCALES_PER_CALL = 50;

async function getAllEntryUids(contentTypeUid, masterLocale, limiter) {
  const uids = [];
  let skip = 0;
  for (;;) {
    const result = await limiter.schedule(() =>
      stack
        .contentType(contentTypeUid)
        .entry()
        .query({ locale: masterLocale, skip, limit: PAGE_SIZE, include_count: true })
        .find()
    );
    uids.push(...result.items.map((entry) => entry.uid));
    skip += PAGE_SIZE;
    if (skip >= result.count) break;
  }
  return uids;
}

// A single call publishes the entry into every locale/environment passed in
// publishDetails (CMA allows up to 50 locales and 10 environments per call),
// so we only need to loop when a stack has more than 50 locales.
async function publishEntry(contentTypeUid, entryUid, masterLocale, locales, limiter) {
  for (const localesBatch of chunk(locales, MAX_LOCALES_PER_CALL)) {
    await withRetry(() =>
      limiter.schedule(() =>
        stack
          .contentType(contentTypeUid)
          .entry(entryUid)
          .publish({
            publishDetails: { locales: localesBatch, environments: [ENVIRONMENT] },
            locale: masterLocale,
          })
      )
    );
  }
}

module.exports = { getAllEntryUids, publishEntry };
