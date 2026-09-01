# publish-everything — Dashboard App

A Contentstack Dashboard Location app: a "Publish All" button and live
progress log embedded in the stack dashboard, backed by a Launch Cloud
Function. This is the repo root because Launch deploys from whatever's at
the git repo root — it doesn't offer a way to pick a subdirectory as the
deploy target (moving this here, out of a `dashboard-app/` subfolder, is
what fixed the first deploy attempt).

The standalone Node CLI version of this (same idea, run from a terminal or
CI instead of embedded in the CMS) lives in [`cli/`](cli/README.md).

## Why this is chunked instead of one continuous run

The first version of this used a Launch **Edge Function** streaming a
single long-lived connection, since Edge Functions have no duration limit.
That failed to deploy with:

> Only alphanumeric characters, hyphens, underscores and `[param]` should be
> used in the naming of function and its parent directory.

Turns out `[proxy].edge.js` (the pattern shown in Launch's own docs) isn't a
general "give your edge function any name" convention — it's a single
reserved filename for request-rewriting middleware. There's no way to stand
up an arbitrary custom Edge Function endpoint on Launch, so the "one
streaming connection for the whole run" design doesn't work at all, not
just its filename.

**Cloud Functions** are the real option: proper Node.js (so this uses the
same `@contentstack/management` SDK as the CLI, not a raw-fetch
reimplementation), normal alphanumeric filenames — but capped at a **30s**
execution timeout. So the job is a resumable state machine
(`functions/lib/pipelineStep.js`): each call to `functions/publish-step.js`
does ~20s of work (discovering locales/content types/entries/assets, or
publishing a batch of them) and returns a `state` blob describing exactly
where it left off. The widget ([`public/index.html`](public/index.html))
holds that `state` in a JS variable and POSTs it right back, looping until
the response says `done`. No server-side job storage needed — the trade-off
is the same one job+polling would have had: if the dashboard tab closes
mid-run, the loop stops (already-published items are harmless no-ops if you
just click the button again — the request-level idempotency of Contentstack
publish is what makes "just resume from an empty state" acceptable here,
rather than needing to persist and resume the exact cursor).

## Structure

```
package.json          # declares @contentstack/management as a dependency;
                       # "build": "true" as a no-op in case Launch insists
                       # on running a build script regardless
functions/
  publish-step.js         # the one HTTP endpoint, POST /publish-step
  lib/
    config.js             # reads Launch env vars (process.env)
    stackClient.js         # @contentstack/management client, same as the CLI
    rateLimiter.js         # same throttle/retry logic as the CLI version
    pipelineStep.js         # the resumable state machine
public/
  index.html               # the widget UI (button, progress bars, log,
                            # the client-side step loop)
cli/                        # standalone Node CLI (see cli/README.md)
```

## Auth model

Same as the CLI: a stack Management Token, stored as a Launch environment
variable, never sent to the browser. This means the app is wired to **one
specific stack** — it's an internal tool, not a multi-tenant marketplace
app. As a safety net, the widget passes the current stack's `api_key` (read
from the App SDK) on every request, and the function refuses to run if it
doesn't match the configured token's stack.

## Deploying

1. **Launch project**: create a new Launch project pointing at this repo.
   - Framework Preset: **Other**
   - Build Command: leave blank, or `npm run build` (there's a no-op
     `build` script in `package.json` either way)
   - Output Directory: `./public`
   - Environment variables (Launch → your environment → Settings):
     `CS_STACK_API_KEY`, `CS_MANAGEMENT_TOKEN`, `CS_ENVIRONMENT`
     (default `production`), `CS_REGION` (e.g. `EU`), `CS_RATE_LIMIT_RPS`
     (default `8`), and optionally `CS_MASTER_LOCALE` — same meanings as in
     `cli/.env.example`. A new deployment is required after adding/changing
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
