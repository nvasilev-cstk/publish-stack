// Cloud Functions run real Node.js, unlike Edge Functions, so — unlike the
// earlier edge-function attempt — this can use the same SDK as ../../cli.
//
// Loaded lazily (inside the function, not as a static top-level import) so
// that if the SDK fails to load or interop correctly on Launch's bundler,
// it surfaces as a normal caught rejection with a real error message,
// instead of crashing at module-load time — before our handler's own
// try/catch ever gets a chance to run — as an opaque 502.
export async function makeStack(config) {
  const mod = await import('@contentstack/management');
  // @contentstack/management is CommonJS. Local Node puts module.exports
  // under `.default`; Launch's bundler apparently doesn't (`.default` came
  // back undefined there), so accept whichever namespace shape actually has
  // `.client` on it instead of assuming one.
  const contentstack = mod.default && typeof mod.default.client === 'function' ? mod.default : mod;
  if (typeof contentstack.client !== 'function') {
    throw new Error(
      'Could not resolve @contentstack/management\'s client() export from either the default or ' +
        `named module shape. Module keys: ${Object.keys(mod).join(', ')}`
    );
  }
  const client = contentstack.client({ host: config.host });
  return client.stack({ api_key: config.apiKey, management_token: config.managementToken });
}
