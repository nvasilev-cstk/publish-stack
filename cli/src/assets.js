const { stack } = require('./client');
const { PAGE_SIZE, ENVIRONMENT } = require('./config');
const { withRetry } = require('./rateLimiter');
const { chunk } = require('./utils');

const MAX_LOCALES_PER_CALL = 50;

async function getAllAssetUids(limiter) {
  const uids = [];
  let skip = 0;
  for (;;) {
    const result = await limiter.schedule(() =>
      stack.asset().query({ skip, limit: PAGE_SIZE, include_count: true }).find()
    );
    uids.push(...result.items.map((asset) => asset.uid));
    skip += PAGE_SIZE;
    if (skip >= result.count) break;
  }
  return uids;
}

async function publishAsset(assetUid, masterLocale, locales, limiter) {
  for (const localesBatch of chunk(locales, MAX_LOCALES_PER_CALL)) {
    await withRetry(() =>
      limiter.schedule(() =>
        stack.asset(assetUid).publish({
          publishDetails: { locales: localesBatch, environments: [ENVIRONMENT] },
          locale: masterLocale,
        })
      )
    );
  }
}

module.exports = { getAllAssetUids, publishAsset };
