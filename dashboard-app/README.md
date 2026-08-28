# publish-everything — Dashboard App

Wraps the standalone script's logic (`../src`) as a Contentstack Dashboard
Location app: a "Publish All" button and live progress log embedded in the
stack dashboard, backed by a Launch Edge Function.

## Why this isn't just the Node script running as-is

Contentstack Launch's two function types each rule out the obvious designs:

- **Cloud Functions** are real Node.js, but capped at a **30-second**
  execution timeout — nowhere near enough for a full-stack publish run.
- **Edge Functions** have **no duration limit** as long as the client holds
  the connection open, but run a WinterCG runtime with **no Node.js APIs**
  — `@contentstack/management`'s axios transport won't work there.

So this app runs the whole job inside one Edge Function
(`functions/publish-stream.edge.js`), talking to the CMA via plain `fetch()`
instead of the SDK, and streams progress back over that single connection as
newline-delimited JSON while it runs — no job store, no polling, nothing to
go stale between requests. The trade-off: if the dashboard tab closes
mid-run, the stream ends (already-published items are harmless no-ops if you
just re-run it).

The request/response shapes used in `functions/lib/cma.js` and
`functions/lib/pipeline.js` (publish body = `{ "entry": { locales,
environments }, "locale": "..." }`, list responses keyed as
`content_types`/`entries`/`assets`/`locales`) were confirmed directly against
`@contentstack/management`'s bundled source, not just docs — see
`node_modules/@contentstack/management/dist/node/contentstack-management.js`
if you ever need to re-verify after an SDK upgrade.

## Structure

```
dashboard-app/
  functions/
    publish-stream.edge.js   # the one HTTP endpoint, GET /publish-stream
    lib/
      config.js              # reads Launch env vars
      rateLimiter.js         # same throttle/retry logic as the standalone script
      cma.js                 # raw-fetch CMA client
      pipeline.js            # the actual publish logic, as an async generator
  public/
    index.html               # the widget UI (button, progress bars, log)
```

## Auth model

Same as the standalone script: a stack Management Token, stored as a Launch
environment variable, never sent to the browser. This means the app is wired
to **one specific stack** — it's an internal tool, not a multi-tenant
marketplace app. As a safety net, the widget passes the current stack's
`api_key` (read from the App SDK) on every request, and the edge function
refuses to run if it doesn't match the configured token's stack.

## Deploying

1. **Launch project**: create a new Launch project pointing at this
   `dashboard-app/` directory (or the whole repo with this as the root
   directory setting).
   - Framework Preset: **Other**
   - Build Command: leave blank (static — no dependencies to install)
   - Output Directory: `./public`
   - Environment variables (Launch → your environment → Settings):
     `CS_STACK_API_KEY`, `CS_MANAGEMENT_TOKEN`, `CS_ENVIRONMENT`
     (default `production`), `CS_REGION` (e.g. `EU`), `CS_RATE_LIMIT_RPS`
     (default `8`), and optionally `CS_MASTER_LOCALE` — same meanings as in
     `../.env.example`. A new deployment is required after adding/changing
     env vars.

2. **Developer Hub app**: create an app in Developer Hub, add a **Dashboard**
   UI Location, and set its hosting to this Launch project's URL (Hosting
   tab → Custom Hosting, or select the Launch project directly if your org's
   Developer Hub offers that integration). Install the app on the target
   stack.

3. Open the stack dashboard, find the widget, tick/untick **Dry run**, and
   click **Publish All**. Dry run lists counts without publishing anything —
   run it first to sanity-check before a real run.

## Verifying before a real run

This hasn't been run against a live stack yet. Before trusting it for a full
production publish:

1. Run a **dry run** first and confirm the entry/asset/locale counts look
   right.
2. Do one real run against a **non-production** environment first (temporarily
   set `CS_ENVIRONMENT` to a staging environment) to confirm publish calls
   actually succeed end-to-end, before pointing it at `production`.
