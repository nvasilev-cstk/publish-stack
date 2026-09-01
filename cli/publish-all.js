const readline = require('readline');
const { ENVIRONMENT, RATE_LIMIT_RPS } = require('./src/config');
const { RateLimiter } = require('./src/rateLimiter');
const { getLocales, findMasterLocale } = require('./src/locales');
const { getAllContentTypeUids } = require('./src/contentTypes');
const { getAllEntryUids, publishEntry } = require('./src/entries');
const { getAllAssetUids, publishAsset } = require('./src/assets');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const skipConfirm = args.includes('--yes');

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main() {
  const limiter = new RateLimiter(RATE_LIMIT_RPS);

  console.log(`Target environment: ${ENVIRONMENT}`);
  console.log('Fetching locales...');
  const localeObjects = await getLocales(limiter);
  const masterLocale = findMasterLocale(localeObjects);
  const locales = localeObjects.map((locale) => locale.code);
  console.log(`Master locale: ${masterLocale}. All locales: ${locales.join(', ')}`);

  console.log('Fetching content types...');
  const contentTypeUids = await getAllContentTypeUids(limiter);
  console.log(`Found ${contentTypeUids.length} content types.`);

  const entryTargets = [];
  for (const contentTypeUid of contentTypeUids) {
    const entryUids = await getAllEntryUids(contentTypeUid, masterLocale, limiter);
    console.log(`  ${contentTypeUid}: ${entryUids.length} entries`);
    entryTargets.push(...entryUids.map((uid) => ({ contentTypeUid, uid })));
  }

  console.log('Fetching assets...');
  const assetUids = await getAllAssetUids(limiter);
  console.log(`Found ${assetUids.length} assets.`);

  console.log(
    `\nAbout to publish ${entryTargets.length} entries and ${assetUids.length} assets ` +
      `to "${ENVIRONMENT}" across ${locales.length} locale(s).`
  );

  if (isDryRun) {
    console.log('Dry run — no publish calls made.');
    return;
  }

  if (!skipConfirm) {
    const proceed = await confirm('Proceed? [y/N] ');
    if (!proceed) {
      console.log('Aborted.');
      return;
    }
  }

  let entriesPublished = 0;
  let entriesFailed = 0;
  for (const { contentTypeUid, uid } of entryTargets) {
    try {
      await publishEntry(contentTypeUid, uid, masterLocale, locales, limiter);
      entriesPublished++;
    } catch (err) {
      entriesFailed++;
      console.error(`\nFailed to publish entry ${contentTypeUid}/${uid}: ${err.message || err}`);
    }
    process.stdout.write(`\rEntries published: ${entriesPublished}/${entryTargets.length} (failed: ${entriesFailed})`);
  }
  console.log();

  let assetsPublished = 0;
  let assetsFailed = 0;
  for (const uid of assetUids) {
    try {
      await publishAsset(uid, masterLocale, locales, limiter);
      assetsPublished++;
    } catch (err) {
      assetsFailed++;
      console.error(`\nFailed to publish asset ${uid}: ${err.message || err}`);
    }
    process.stdout.write(`\rAssets published: ${assetsPublished}/${assetUids.length} (failed: ${assetsFailed})`);
  }
  console.log();

  console.log(
    `\nDone. Entries: ${entriesPublished} published, ${entriesFailed} failed. ` +
      `Assets: ${assetsPublished} published, ${assetsFailed} failed.`
  );

  if (entriesFailed > 0 || assetsFailed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
