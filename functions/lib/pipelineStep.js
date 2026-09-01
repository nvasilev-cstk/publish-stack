import { withRetry } from './rateLimiter.js';

const MAX_LOCALES_PER_CALL = 50;
const STEP_TIME_BUDGET_MS = 20000; // leaves a margin under Cloud Functions' 30s cap

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

function findMasterLocale(localeItems, override) {
  if (override) return override;
  const candidates = localeItems.filter((locale) => !locale.fallback_locale);
  if (candidates.length === 1) return candidates[0].code;
  throw new Error(
    candidates.length === 0
      ? 'Could not detect a master locale (every locale has a fallback_locale set). Set CS_MASTER_LOCALE.'
      : `Found multiple locales with no fallback_locale (${candidates.map((l) => l.code).join(', ')}). Set CS_MASTER_LOCALE.`
  );
}

function initialState(dryRun) {
  return {
    phase: 'locales',
    dryRun: Boolean(dryRun),
    localeItems: [],
    localeSkip: 0,
    locales: [],
    masterLocale: null,
    contentTypeUids: [],
    ctSkip: 0,
    entryCtIndex: 0,
    entrySkip: 0,
    entryTargets: [],
    assetUids: [],
    assetSkip: 0,
    publishEntryIndex: 0,
    entriesPublished: 0,
    entriesFailed: 0,
    publishAssetIndex: 0,
    assetsPublished: 0,
    assetsFailed: 0,
  };
}

// Performs exactly one bounded unit of work (one page fetch, or one item
// publish) and mutates `state` to reflect it, pushing any human-readable
// progress lines onto `log`. Returns false only if there's truly nothing
// left to do (shouldn't happen while phase !== 'done').
async function runUnit(stack, limiter, config, state, log) {
  switch (state.phase) {
    case 'locales': {
      const result = await limiter.schedule(() =>
        stack.locale().query({ skip: state.localeSkip, limit: config.pageSize, include_count: true }).find()
      );
      state.localeItems.push(...result.items);
      state.localeSkip += config.pageSize;
      if (state.localeSkip >= result.count) {
        state.locales = state.localeItems.map((l) => l.code);
        state.masterLocale = findMasterLocale(state.localeItems, config.masterLocaleOverride);
        log.push(`Master locale: ${state.masterLocale}. All locales: ${state.locales.join(', ')}`);
        state.phase = 'content-types';
      }
      return true;
    }

    case 'content-types': {
      const result = await limiter.schedule(() =>
        stack.contentType().query({ skip: state.ctSkip, limit: config.pageSize, include_count: true }).find()
      );
      state.contentTypeUids.push(...result.items.map((ct) => ct.uid));
      state.ctSkip += config.pageSize;
      if (state.ctSkip >= result.count) {
        log.push(`Found ${state.contentTypeUids.length} content types.`);
        state.phase = 'entries';
      }
      return true;
    }

    case 'entries': {
      if (state.entryCtIndex >= state.contentTypeUids.length) {
        log.push('Fetching assets...');
        state.phase = 'assets';
        return true;
      }
      const ctUid = state.contentTypeUids[state.entryCtIndex];
      const result = await limiter.schedule(() =>
        stack
          .contentType(ctUid)
          .entry()
          .query({ locale: state.masterLocale, skip: state.entrySkip, limit: config.pageSize, include_count: true })
          .find()
      );
      result.items.forEach((entry) => state.entryTargets.push({ contentTypeUid: ctUid, uid: entry.uid }));
      state.entrySkip += config.pageSize;
      if (state.entrySkip >= result.count) {
        log.push(`  ${ctUid}: ${result.count} entries`);
        state.entryCtIndex += 1;
        state.entrySkip = 0;
      }
      return true;
    }

    case 'assets': {
      const result = await limiter.schedule(() =>
        stack.asset().query({ skip: state.assetSkip, limit: config.pageSize, include_count: true }).find()
      );
      state.assetUids.push(...result.items.map((a) => a.uid));
      state.assetSkip += config.pageSize;
      if (state.assetSkip >= result.count) {
        log.push(`Found ${state.assetUids.length} assets.`);
        log.push(
          `About to publish ${state.entryTargets.length} entries and ${state.assetUids.length} assets ` +
            `to "${config.environment}" across ${state.locales.length} locale(s).`
        );
        state.phase = state.dryRun ? 'done' : 'publish-entries';
      }
      return true;
    }

    case 'publish-entries': {
      if (state.publishEntryIndex >= state.entryTargets.length) {
        state.phase = 'publish-assets';
        return true;
      }
      const { contentTypeUid, uid } = state.entryTargets[state.publishEntryIndex];
      try {
        for (const localesBatch of chunk(state.locales, MAX_LOCALES_PER_CALL)) {
          await withRetry(() =>
            limiter.schedule(() =>
              stack
                .contentType(contentTypeUid)
                .entry(uid)
                .publish({
                  publishDetails: { locales: localesBatch, environments: [config.environment] },
                  locale: state.masterLocale,
                })
            )
          );
        }
        state.entriesPublished += 1;
      } catch (err) {
        state.entriesFailed += 1;
        log.push(`Failed to publish entry ${contentTypeUid}/${uid}: ${err.message || err}`);
      }
      state.publishEntryIndex += 1;
      return true;
    }

    case 'publish-assets': {
      if (state.publishAssetIndex >= state.assetUids.length) {
        state.phase = 'done';
        return true;
      }
      const assetUid = state.assetUids[state.publishAssetIndex];
      try {
        for (const localesBatch of chunk(state.locales, MAX_LOCALES_PER_CALL)) {
          await withRetry(() =>
            limiter.schedule(() =>
              stack.asset(assetUid).publish({
                publishDetails: { locales: localesBatch, environments: [config.environment] },
                locale: state.masterLocale,
              })
            )
          );
        }
        state.assetsPublished += 1;
      } catch (err) {
        state.assetsFailed += 1;
        log.push(`Failed to publish asset ${assetUid}: ${err.message || err}`);
      }
      state.publishAssetIndex += 1;
      return true;
    }

    default:
      return false;
  }
}

function computeProgress(state) {
  return {
    phase: state.phase,
    entries: { done: state.publishEntryIndex, total: state.entryTargets.length, failed: state.entriesFailed },
    assets: { done: state.publishAssetIndex, total: state.assetUids.length, failed: state.assetsFailed },
  };
}

// Runs bounded units of work until the time budget runs out or the whole
// job reaches 'done', returning the (mutated) state for the caller to send
// back on the next call.
export async function runStep(stack, limiter, config, incomingState, dryRun, timeBudgetMs = STEP_TIME_BUDGET_MS) {
  const state = incomingState && incomingState.phase ? incomingState : initialState(dryRun);
  const deadline = Date.now() + timeBudgetMs;
  const log = [];

  if (state.phase === 'locales' && state.localeItems.length === 0 && state.localeSkip === 0) {
    log.push(`Target environment: ${config.environment}`, 'Fetching locales...');
  }

  while (state.phase !== 'done' && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const advanced = await runUnit(stack, limiter, config, state, log);
    if (!advanced) break;
  }

  const done = state.phase === 'done';
  return {
    state,
    log,
    progress: computeProgress(state),
    done,
    summary: done
      ? {
          dryRun: state.dryRun,
          entries: state.entryTargets.length,
          assets: state.assetUids.length,
          entriesPublished: state.entriesPublished,
          entriesFailed: state.entriesFailed,
          assetsPublished: state.assetsPublished,
          assetsFailed: state.assetsFailed,
        }
      : undefined,
  };
}
