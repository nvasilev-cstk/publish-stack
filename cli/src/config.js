require('dotenv').config();

const REGION_HOSTS = {
  NA: 'api.contentstack.io',
  EU: 'eu-api.contentstack.com',
  AU: 'au-api.contentstack.com',
  AZURE_NA: 'azure-na-api.contentstack.com',
  AZURE_EU: 'azure-eu-api.contentstack.com',
  GCP_NA: 'gcp-na-api.contentstack.com',
  GCP_EU: 'gcp-eu-api.contentstack.com',
};

const region = (process.env.CS_REGION || 'NA').toUpperCase();
const host = process.env.CS_HOST || REGION_HOSTS[region];

if (!host) {
  throw new Error(
    `Unknown CS_REGION "${region}". Valid options: ${Object.keys(REGION_HOSTS).join(', ')} (or set CS_HOST directly).`
  );
}

const { CS_STACK_API_KEY, CS_MANAGEMENT_TOKEN } = process.env;
if (!CS_STACK_API_KEY || !CS_MANAGEMENT_TOKEN) {
  throw new Error('CS_STACK_API_KEY and CS_MANAGEMENT_TOKEN are required. See .env.example.');
}

module.exports = {
  STACK_API_KEY: CS_STACK_API_KEY,
  MANAGEMENT_TOKEN: CS_MANAGEMENT_TOKEN,
  HOST: host,
  ENVIRONMENT: process.env.CS_ENVIRONMENT || 'production',
  RATE_LIMIT_RPS: Number(process.env.CS_RATE_LIMIT_RPS || 8),
  MASTER_LOCALE_OVERRIDE: process.env.CS_MASTER_LOCALE || null,
  PAGE_SIZE: 100,
};
