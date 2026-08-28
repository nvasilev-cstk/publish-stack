const MAX_LOCALES_PER_CALL = 50;

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

async function paginate(client, path, envelopeKey, extraQuery, pageSize) {
  const items = [];
  let skip = 0;
  for (;;) {
    const result = await client.request(path, {
      query: { ...extraQuery, skip, limit: pageSize, include_count: true },
    });
    items.push(...(result[envelopeKey] || []));
    skip += pageSize;
    if (skip >= (result.count ?? items.length)) break;
  }
  return items;
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

// Async generator: yields progress events as the run proceeds, so the caller
// (the edge function) can stream them to the widget without buffering the
// whole run in memory.
export async function* runPublishPipeline(client, config, { dryRun = false } = {}) {
  yield { type: 'log', message: `Target environment: ${config.environment}` };

  yield { type: 'log', message: 'Fetching locales...' };
  const localeItems = await paginate(client, '/locales', 'locales', {}, config.pageSize);
  const locales = localeItems.map((l) => l.code);
  const masterLocale = findMasterLocale(localeItems, config.masterLocaleOverride);
  yield { type: 'log', message: `Master locale: ${masterLocale}. All locales: ${locales.join(', ')}` };

  yield { type: 'log', message: 'Fetching content types...' };
  const contentTypes = await paginate(client, '/content_types', 'content_types', {}, config.pageSize);
  yield { type: 'log', message: `Found ${contentTypes.length} content types.` };

  const entryTargets = [];
  for (const contentType of contentTypes) {
    const entries = await paginate(
      client,
      `/content_types/${contentType.uid}/entries`,
      'entries',
      { locale: masterLocale },
      config.pageSize
    );
    yield { type: 'log', message: `  ${contentType.uid}: ${entries.length} entries` };
    entryTargets.push(...entries.map((entry) => ({ contentTypeUid: contentType.uid, uid: entry.uid })));
  }

  yield { type: 'log', message: 'Fetching assets...' };
  const assets = await paginate(client, '/assets', 'assets', {}, config.pageSize);
  yield { type: 'log', message: `Found ${assets.length} assets.` };

  yield {
    type: 'summary',
    entries: entryTargets.length,
    assets: assets.length,
    locales: locales.length,
    environment: config.environment,
  };

  if (dryRun) {
    yield { type: 'done', dryRun: true };
    return;
  }

  let entriesPublished = 0;
  let entriesFailed = 0;
  for (const { contentTypeUid, uid } of entryTargets) {
    try {
      for (const localesBatch of chunk(locales, MAX_LOCALES_PER_CALL)) {
        await client.request(`/content_types/${contentTypeUid}/entries/${uid}/publish`, {
          method: 'POST',
          body: { entry: { locales: localesBatch, environments: [config.environment] }, locale: masterLocale },
        });
      }
      entriesPublished++;
    } catch (err) {
      entriesFailed++;
      yield { type: 'log', level: 'error', message: `Failed to publish entry ${contentTypeUid}/${uid}: ${err.message}` };
    }
    yield {
      type: 'progress',
      kind: 'entries',
      done: entriesPublished + entriesFailed,
      total: entryTargets.length,
      failed: entriesFailed,
    };
  }

  let assetsPublished = 0;
  let assetsFailed = 0;
  for (const asset of assets) {
    try {
      for (const localesBatch of chunk(locales, MAX_LOCALES_PER_CALL)) {
        await client.request(`/assets/${asset.uid}/publish`, {
          method: 'POST',
          body: { asset: { locales: localesBatch, environments: [config.environment] }, locale: masterLocale },
        });
      }
      assetsPublished++;
    } catch (err) {
      assetsFailed++;
      yield { type: 'log', level: 'error', message: `Failed to publish asset ${asset.uid}: ${err.message}` };
    }
    yield {
      type: 'progress',
      kind: 'assets',
      done: assetsPublished + assetsFailed,
      total: assets.length,
      failed: assetsFailed,
    };
  }

  yield { type: 'done', entriesPublished, entriesFailed, assetsPublished, assetsFailed };
}
