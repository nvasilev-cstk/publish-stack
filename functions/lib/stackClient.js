import contentstack from '@contentstack/management';

// Cloud Functions run real Node.js, unlike Edge Functions, so — unlike the
// earlier edge-function attempt — this can use the same SDK as ../../cli.
export function makeStack(config) {
  const client = contentstack.client({ host: config.host });
  return client.stack({ api_key: config.apiKey, management_token: config.managementToken });
}
