# Deploying roster to Cloudflare (from scratch)

Target: a deployment on a **Cloudflare account**, on the custom domain
**`roster.y-software.ch`**. One Worker (`roster-app`) serves both the API
(Hono) and the SPA (static assets binding, SPA fallback,
`run_worker_first: ["/api/*"]`), so there is exactly ONE thing to deploy.

There is **one environment**: the top-level config in
`apps/api/wrangler.jsonc`. No `--env` flag anywhere. `wrangler dev` runs that
config locally, `wrangler deploy` ships it. Below, `<ORIGIN>` =
`https://roster.y-software.ch`.

## The one external dependency, up front

**SWITCH edu-ID.** Sign-in is OIDC against `login.eduid.ch` with client
`hes-so_roster_client`. The client registration must list this redirect URI or
every sign-in dies at SWITCH:

```
<ORIGIN>/api/auth/oauth2/callback/switch
```

If you can edit the client registration yourself, add it in phase 4. If it
belongs to HES-SO administration, request it FIRST: everything else proceeds in
parallel, but no one signs in until this lands. The same client also needs
`https://localhost:3000/api/auth/oauth2/callback/switch` for local dev.

## The GitHub App

One GitHub App backs the deployment. It accepts up to 10 **Callback URLs**, so
production and `localhost:3000` share one App for *linking*. The **Setup URL is
single-valued**, and the "connect a class" flow hangs on it: after an org
installs or reconfigures the App, GitHub sends the browser there and the class
row is born (`/api/github/setup`). Point it at production
(`<ORIGIN>/api/github/setup`).

To exercise the install/connect flow locally, either temporarily repoint the
Setup URL at `https://localhost:3000/api/github/setup`, or create a separate
dev App and put its slug + OAuth pair in `apps/api/.dev.vars`. Everyday local
work (sign-in, GitHub linking) does not need this.

The D1 knows only the classes born through that setup callback: an org visible
in `/user/installations` without a class row shows no class. That's the data
model ("GitHub proposes, the DB disposes"), not a bug.

## Phase 0: prerequisites

- Cloudflare account (free plan is enough: Workers + D1 free tiers cover this).
- The **`y-software.ch` zone on that account**: deploy provisions the Worker's
  custom domain from `wrangler.jsonc`'s `routes`, which requires the zone
  active on the deploying account.
- `wrangler login` (opens the browser; grants the CLI your account).
- A GitHub account for the App.

```bash
cd apps/api
pnpm exec wrangler login
pnpm exec wrangler whoami   # confirm the account owns the y-software.ch zone
```

## Phase 1: database + first deploy (claims the domain)

Create the remote D1 and point the config at it:

```bash
pnpm exec wrangler d1 create roster-db
# → copy the printed database_id into `d1_databases[0].database_id` in
#   apps/api/wrangler.jsonc (it ships an all-zeros placeholder).
```

Apply all migrations in `packages/db/migrations` to the REMOTE db:

```bash
pnpm exec wrangler d1 migrations apply roster-db --remote
```

Build the SPA, then deploy (the Worker embeds `apps/www/build/client` and
provisions the `roster.y-software.ch` custom domain):

```bash
pnpm --filter @roster/www build
pnpm --filter @roster/api run deploy
# → binds roster.y-software.ch to the Worker; DNS is managed for you since the
#   zone is on this account.
```

The app loads, but sign-in stays dead until phases 2–5. That's expected.

## Phase 2: public config in wrangler.jsonc, secrets outside it

Non-secret config is committed in the top-level `vars`; secrets never are.
Wrangler does **not** interpolate env vars into `wrangler.jsonc` (`${VAR}`
ships as a literal string), so the config file is the only place these live:

```jsonc
"vars": {
  "BETTER_AUTH_URL": "https://roster.y-software.ch",
  "EDUID_ISSUER": "https://login.eduid.ch",
  "GITHUB_APP_SLUG": "<the App slug, from phase 3>",
  // Comma-separated edu-ID emails. EMPTY = nobody can create classes
  // (fail closed). See "Super admins" below.
  "SUPER_ADMIN_EMAILS": "<admin1@…>,<admin2@…>"
}
```

### Super admins: bootstrap and exact scope

Class creation is a **granted capability**: signing in is not enough. The
bootstrap chain, from nothing to the first class:

1. Put the admins' **edu-ID emails** in `SUPER_ADMIN_EMAILS` (comma-
   separated; matched case-insensitively against the account's PRIMARY
   edu-ID email, the one the account menu shows, often a personal address,
   NOT necessarily the institutional one). Deploy.

   > **Use institutional addresses.** This var tops the privilege chain and
   > matches on a STRING: whoever can receive mail at a listed address can
   > register an edu-ID under it and become a super admin. A personal
   > mailbox (hotmail, gmail) puts that outside the school's control, and no
   > second check stands behind it.
2. The admin signs in once (their user row must exist), opens the account
   menu → **Super admin** → `/admin`.
3. There they flip **"Can create classes"** for whoever should create
   classes, *including themselves*: that toggle is the one condition the
   setup callback checks.

Exact scope of the role, as of 2026-07-27. A super admin can:

- open `/admin` (everyone else: menu item absent, page bounces, API 403);
- see all signed-in users (name, primary email, admin badge, grant state)
  and grant or revoke **"Can create classes"** per user.

And deliberately can NOT:

- make anyone a super admin. The role lives ONLY in this config var, is
  never stored in the database, and no UI grants it;
- see or touch anyone's classes, labs, groups, or repos. Class-scoped
  teacher rights come from GitHub org ownership, exactly as before;
- change anything retroactively: revoking stops FUTURE class creation
  only; existing classes, and the repair path of an already-connected
  org (reinstall/reconfigure), keep working for their owners.

Empty or unset `SUPER_ADMIN_EMAILS` fails **closed**: no admin zone for anyone,
and with no grants ever made, no class creation at all.

Local dev overrides `BETTER_AUTH_URL` and `GITHUB_APP_SLUG` in
`apps/api/.dev.vars` (git-ignored); a value there wins over `vars` during
`wrangler dev`. That file also holds the phase-5 **secrets**. Copy
`apps/api/.dev.vars.example` to start.

## Phase 3: the GitHub App

**Follow `GITHUB_APP_SETUP.md`**, the creation guide (field-by-field form
values, permissions, private-key conversion), with these values:

| Placeholder in the guide | Value |
|---|---|
| App name | e.g. `heigvdroster` (its derived **slug** goes in `GITHUB_APP_SLUG`) |
| Callback URL | `<ORIGIN>/api/auth/callback/github` (add `https://localhost:3000/...` too for local linking) |
| Setup URL | `<ORIGIN>/api/github/setup` |

Its gotchas all apply verbatim: "Request user authorization during
installation" stays **unchecked**, the Setup URL must not be blank, the App
must be **public** (Advanced → Make public) to be installable on orgs, and the
private key must be converted to **PKCS#8**.

Collect on the App's General page: **App ID**, **slug**, **Client ID**, a
generated **client secret**, and the converted **private key**. They feed
`wrangler.jsonc` (`GITHUB_APP_SLUG`) and the four `GITHUB_*` secrets in
phase 5, then redeploy (phase 6).

## Phase 4: SWITCH edu-ID redirect URI

Add `<ORIGIN>/api/auth/oauth2/callback/switch` to the `hes-so_roster_client`
registration (and `https://localhost:3000/api/auth/oauth2/callback/switch` for
local dev).

## Phase 5: secrets

Seven secrets, all via `wrangler secret put` (each opens a paste prompt; run
from `apps/api`). No `--env`: they land on the one Worker.

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET       # FRESH random: node -e "console.log(crypto.randomBytes(32).toString('hex'))"
pnpm exec wrangler secret put EDUID_CLIENT_ID
pnpm exec wrangler secret put EDUID_CLIENT_SECRET
pnpm exec wrangler secret put GITHUB_CLIENT_ID         # the App's OAuth client id
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm exec wrangler secret put GITHUB_APP_ID            # the App's numeric id
pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY   # the single-line PKCS#8 from phase 3
```

Never reuse the local-dev `BETTER_AUTH_SECRET`: it sits in `.dev.vars` on every
dev machine.

**⚠ BOM warning:** don't pipe secret values from PowerShell 5.1. It prepends a
UTF-8 BOM and the provider rejects the credential as unknown. Paste
interactively or pipe with Git Bash `printf '%s'`.

## Phase 6: final deploy + smoke test

```bash
pnpm --filter @roster/www build
pnpm --filter @roster/api run deploy
```

Walk, in order:

1. `<ORIGIN>/api/health` answers.
2. `<ORIGIN>` loads the SPA; sign in with SWITCH edu-ID → proves the OIDC
   redirect URI (phase 4).
3. Onboarding links GitHub → proves the App's OAuth pair (callback URL).
4. "Connect a class" installs the App on a test org → proves the Setup URL
   and the App JWT (private key format).
5. Confirm page → "Set up & continue" → proves org Administration
   permission (base permission PATCH).
6. Create a lab, accept it from a student test account via the join link →
   proves Members + Repository permissions end to end.

## Redeploys

Build first, then deploy (two commands; PowerShell 5.1 has no `&&`):

```bash
pnpm --filter @roster/www build
pnpm --filter @roster/api run deploy
```

Migrations added later: `wrangler d1 migrations apply roster-db --remote`
before the deploy. Secrets and D1 survive deploys; only code and `vars` ship.

Adding or removing a super admin is a `vars` edit (`SUPER_ADMIN_EMAILS` in
`wrangler.jsonc`) plus a redeploy: no migration, nothing stored in the DB.

A deploy always ships whatever is in `apps/www/build/client`. Rebuild from an
up-to-date tree before deploying, and verify the served `index.html` references
the `assets/manifest-*.js` hash you just built.

## Operating the deployment

Everything below runs from `apps/api` (`pnpm exec wrangler …`). No `--env`.

**Live logs, the first thing to check when it misbehaves:**

```bash
pnpm exec wrangler tail --format pretty
```

Streams every request and every `console.error` as it happens. The API's error
handler logs the real upstream failure (e.g.
`github unavailable: GET /user/installations → 503`), which the SPA shows only
as a generic banner.

**Versions and rollback:**

```bash
pnpm exec wrangler deployments list          # what's live, and its history
pnpm exec wrangler versions list             # every uploaded version
pnpm exec wrangler versions view <VERSION_ID>   # a version's compat date/flags, bindings, secret NAMES
pnpm exec wrangler rollback <VERSION_ID>        # make an old version live again
```

Every deploy prints its version id at the end (`Current Version ID: …`).
Rollback re-activates that exact version (code, vars, and its secrets), so a
bad deploy is undone in seconds without a rebuild.

**Secrets:**

```bash
pnpm exec wrangler secret list               # names only; values are write-only
pnpm exec wrangler secret put <KEY>          # set/replace one (paste prompt)
pnpm exec wrangler secret delete <KEY>
```

**Database:**

```bash
pnpm exec wrangler d1 migrations list roster-db --remote    # applied vs pending
pnpm exec wrangler d1 execute roster-db --remote --json --command "SELECT …"
```

`d1 execute` is the remote-debugging escape hatch (row counts, drift checks).
SQLite gotcha: a double-quoted name matching no column silently becomes a
string literal instead of erroring, and the auth tables are snake_case
(`provider_id`, `access_token`), so a typo'd camelCase query "works" and
returns garbage.

**When the app blames GitHub, check GitHub first.** The SPA's "GitHub is
unreachable right now" banner plus 503s on everything GitHub-backed is the
app's *designed* response to a GitHub outage, and `wrangler tail` shows
`github unavailable: … → 5xx` from GitHub itself. Check
<https://www.githubstatus.com> before suspecting a deploy or the secrets.
`/api/health` only proves the Worker runs; it says nothing about the GitHub leg.

## What the deploy hardens on its own

Three things ship with the Worker and need no setup. Each stays invisible until
it refuses something.

- **Rate limits.** Two `ratelimits` bindings in `wrangler.jsonc`:
  `AUTH_LIMITER` (60/min per IP, on `/api/auth/*` and `/api/join/*`) and
  `SETUP_LIMITER` (10/min, on the unauthenticated `/api/github/setup`, which
  spends several GitHub calls per request). Each route module declares its own
  limiter (`src/routes/auth.ts`, `join.ts`, `setup.ts`); no central list
  exists. Over the limit: `429 {"error":"rate_limited"}`. `namespace_id` is
  just a counter name, provisioned nowhere, and the binding is optional in
  code, so `wrangler dev` runs without it. Better Auth's own limiter is off on
  purpose (`src/lib/auth/config.ts`): its counters live in per-isolate memory,
  no ceiling at all on Workers.
- **Response headers.** The SPA's come from `apps/www/build/client/_headers`,
  GENERATED at build time by `apps/www/scripts/security-headers.mjs` (the CSP
  hashes the built page's inline scripts, so hand-writing it fails). The
  Worker sets the API's (`src/lib/http/security-headers.ts`). Both sit on one
  origin, and neither covers the other.
- **Same-origin writes.** `POST`/`PUT`/`PATCH`/`DELETE` under `/api` get
  `403 {"error":"cross_origin"}` when the browser reports a different origin.
  A future deploy serving the SPA from a SECOND origin will trip that check
  (`src/lib/http/same-origin.ts`, keyed on `BETTER_AUTH_URL`).

## Not in scope (revisit for real use)

- CI deploys (GitHub Actions with a Cloudflare API token).
- D1 backups / time travel beyond the built-in 30 days.
- GitHub API headroom: shares the GitHub App installation quota
  (5000/hr/org); a class of 30 doesn't approach it.
- OAuth tokens (`account.access_token` / `refresh_token`) are stored in D1
  in the clear. Better Auth can encrypt them (`account.encryptOAuthTokens`),
  which needs a decision about the rows already there.
