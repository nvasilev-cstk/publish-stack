const { stack } = require('./client');
const { MASTER_LOCALE_OVERRIDE } = require('./config');

// "Get a single stack" (stack.fetch()) requires a user login authtoken and
// rejects management tokens outright, so master_locale can't be read from
// there. Locales themselves are a management-token-accessible endpoint, and
// the master locale is the only one with no fallback_locale, so derive it
// from that list instead.
async function getLocales(limiter) {
  const result = await limiter.schedule(() => stack.locale().query().find());
  return result.items;
}

function findMasterLocale(locales) {
  if (MASTER_LOCALE_OVERRIDE) return MASTER_LOCALE_OVERRIDE;

  const candidates = locales.filter((locale) => !locale.fallback_locale);
  if (candidates.length === 1) return candidates[0].code;

  throw new Error(
    candidates.length === 0
      ? 'Could not detect a master locale (every locale has a fallback_locale set). Set CS_MASTER_LOCALE explicitly.'
      : `Found multiple locales with no fallback_locale (${candidates.map((l) => l.code).join(', ')}). Set CS_MASTER_LOCALE explicitly.`
  );
}

module.exports = { getLocales, findMasterLocale };
