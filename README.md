# publish-everything

Bulk-publishes every entry (across every content type) and every asset in a
Contentstack stack, to a single environment, in every locale the stack has
configured. Talks to the Content Management API directly via the official
`@contentstack/management` Node SDK — no dependency on the Contentstack CLI
being installed or logged in, so it also runs in CI or any isolated
environment.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `CS_STACK_API_KEY` / `CS_MANAGEMENT_TOKEN` — from Settings > Tokens in the stack.
- `CS_ENVIRONMENT` — defaults to `production`. Kept as a setting, not hardcoded.
- `CS_REGION` — `NA | EU | AU | AZURE_NA | AZURE_EU | GCP_NA | GCP_EU`. Set `CS_HOST` instead if your region isn't in that list.
- `CS_RATE_LIMIT_RPS` — defaults to 8, a safety margin under the CMA's 10 req/s org-wide limit.

## Usage

```bash
node publish-all.js --dry-run   # lists what would be published, makes no changes
node publish-all.js             # asks for confirmation, then publishes
node publish-all.js --yes       # skips the confirmation prompt (for CI)
```

## How it works

1. Fetches the stack's master locale and full locale list.
2. Fetches all content type UIDs (paginated).
3. For each content type, fetches all entry UIDs (paginated, master locale).
4. Fetches all asset UIDs (paginated).
5. Publishes each entry/asset to `CS_ENVIRONMENT`, across all locales in a
   single publish call per item (CMA supports up to 50 locales per call —
   the script chunks automatically if a stack has more than that).

Every CMA call — reads and publishes alike — goes through a shared rate
limiter (`src/rateLimiter.js`) that spaces out request *initiation* to stay
under the RPS limit, and retries with backoff (honoring `Retry-After`) if a
429 slips through anyway.

## Porting to a Dashboard App

The publish logic (`src/*.js`) has no CLI or process-level dependencies —
it's plain functions taking a `stack` client and a rate limiter. To turn
this into a Dashboard App later, swap `src/client.js`'s management-token
auth for the App SDK's OAuth-based client and reuse everything else as-is.
