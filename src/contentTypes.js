const { stack } = require('./client');
const { PAGE_SIZE } = require('./config');

async function getAllContentTypeUids(limiter) {
  const uids = [];
  let skip = 0;
  for (;;) {
    const result = await limiter.schedule(() =>
      stack.contentType().query({ skip, limit: PAGE_SIZE, include_count: true }).find()
    );
    uids.push(...result.items.map((contentType) => contentType.uid));
    skip += PAGE_SIZE;
    if (skip >= result.count) break;
  }
  return uids;
}

module.exports = { getAllContentTypeUids };
