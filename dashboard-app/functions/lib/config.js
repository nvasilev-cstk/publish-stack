const REGION_HOSTS = {
  NA: 'api.contentstack.io',
  EU: 'eu-api.contentstack.com',
  AU: 'au-api.contentstack.com',
  AZURE_NA: 'azure-na-api.contentstack.com',
  AZURE_EU: 'azure-eu-api.contentstack.com',
  GCP_NA: 'gcp-na-api.contentstack.com',
  GCP_EU: 'gcp-eu-api.contentstack.com',
};

// Edge Functions read config from context.env (WinterCG runtime, no process.env
// / dotenv) — set these as Launch environment variables on the project.
export function loadConfig(env) {
  const region = (env.CS_REGION || 'NA').toUpperCase();
  const host = env.CS_HOST || REGION_HOSTS[region];
  if (!host) {
    throw new Error(
      `Unknown CS_REGION "${region}". Valid options: ${Object.keys(REGION_HOSTS).join(', ')} (or set CS_HOST directly).`
    );
  }

  const apiKey = env.CS_STACK_API_KEY;
  const managementToken = env.CS_MANAGEMENT_TOKEN;
  if (!apiKey || !managementToken) {
    throw new Error('CS_STACK_API_KEY and CS_MANAGEMENT_TOKEN must be set as Launch environment variables.');
  }

  return {
    apiKey,
    managementToken,
    host,
    environment: env.CS_ENVIRONMENT || 'production',
    rateLimitRps: Number(env.CS_RATE_LIMIT_RPS || 8),
    masterLocaleOverride: env.CS_MASTER_LOCALE || null,
    pageSize: 100,
  };
}
