# Deploying roster to Cloudflare (from scratch)

Target: a working deployment on a **Cloudflare account**, on the custom domain
**`roster.y-software.ch`**. One Worker (`roster-app`) serves both the API
(Hono) and the SPA (static assets binding, SPA fallback,
`run_worker_first: ["/api/*"]`), so there is exactly ONE thing to deploy.

There is **one environment**: the top-level config in `apps/api/wrangler.jsonc`.
No `--env` flag anywhere — `wrangler dev` runs that config locally, and
`wrangler deploy` ships it. Everything below refers to the deployed origin as
`<ORIGIN>` = `https://roster.y-software.ch`.

## The one external dependency, up front

**SWITCH edu-ID.** Sign-in is OIDC against `login.eduid.ch` with client
`hes-so_roster_client`. The client registration must list the redirect URI or
every sign-in dies at SWITCH:

```
<ORIGIN>/api/auth/oauth2/callback/switch
```

If you can edit the client registration yourself, add it in phase 4. If it
belongs to HES-SO administration, request it FIRST — everything else can
proceed in parallel, but no one signs in until this lands. (For local dev the
same client also needs `https://localhost:3000/api/auth/oauth2/callback/switch`.)

## The GitHub App

One GitHub App backs the deployment. It accepts up to 10 **Callback URLs**
(OAuth linking works from several origins, so production and `localhost:3000`
can share one App for *linking*), but the **Setup URL is single-valued** — and
the "connect a class" flow hangs on it: after an org installs/reconfigures the
App, GitHub redirects the browser to that one URL, where the class row is born
(`/api/github/setup`). Point it at production (`<ORIGIN>/api/github/setup`).

To exercise the install/connect flow locally, either temporarily repoint the
Setup URL at `https://localhost:3000/api/github/setup`, or create a separate
dev App and put its slug + OAuth pair in `apps/api/.dev.vars`. Everyday local
work (sign-in, GitHub linking) does not need this.

Corollary: the D1 knows only the classes born through its setup callback. An
org visible in `/user/installations` but without a class row shows no class —
that's the data model ("GitHub proposes, the DB disposes"), not a bug.

## Phase 0 — prerequisites

- Cloudflare account (free plan is enough: Workers + D1 free tiers cover this).
- The **`y-software.ch` zone on that account** — the Worker's custom domain is
  provisioned from `wrangler.jsonc`'s `routes` on deploy, which requires the
  zone to be active on the deploying account.
- `wrangler login` (opens the browser; grants the CLI your account).
- A GitHub account for the App.

```bash
cd apps/api
pnpm exec wrangler login
pnpm exec wrangler whoami   # confirm the account owns the y-software.ch zone
```

## Phase 1 — database + first deploy (claims the domain)

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

The app will load but sign-in is dead until phases 2–5. That's expected.

## Phase 2 — public config in wrangler.jsonc, secrets outside it

Non-secret config is committed in the top-level `vars`; secrets never are.
Wrangler does **not** interpolate env vars into `wrangler.jsonc` (`${VAR}`
ships as a literal string), so the config file is the only place these live:

```jsonc
"vars": {
  "BETTER_AUTH_URL": "https://roster.y-software.ch",
  "EDUID_ISSUER": "https://login.eduid.ch",
  "GITHUB_APP_SLUG": "<the App slug, from phase 3>"
}
```

Local dev overrides `BETTER_AUTH_URL` and `GITHUB_APP_SLUG` in
`apps/api/.dev.vars` (git-ignored) — a value there wins over `vars` during
`wrangler dev`. That file also holds the phase-5 **secrets**. Copy
`apps/api/.dev.vars.example` to start.

## Phase 3 — the GitHub App

**Follow `GITHUB_APP_SETUP.md`** — the canonical creation guide (field-by-field
form values, permissions, private-key conversion) — with these values:

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
generated **client secret**, and the converted **private key** — they feed
`wrangler.jsonc` (`GITHUB_APP_SLUG`) and the four `GITHUB_*` secrets in
phase 5, then redeploy (phase 6).

## Phase 4 — SWITCH edu-ID redirect URI

Add `<ORIGIN>/api/auth/oauth2/callback/switch` to the `hes-so_roster_client`
registration (and `https://localhost:3000/api/auth/oauth2/callback/switch` for
local dev).

## Phase 5 — secrets

Seven secrets, all via `wrangler secret put` (each opens a paste prompt; run
from `apps/api`). No `--env` — they land on the one Worker:

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET       # FRESH random: node -e "console.log(crypto.randomBytes(32).toString('hex'))"
pnpm exec wrangler secret put EDUID_CLIENT_ID
pnpm exec wrangler secret put EDUID_CLIENT_SECRET
pnpm exec wrangler secret put GITHUB_CLIENT_ID         # the App's OAuth client id
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm exec wrangler secret put GITHUB_APP_ID            # the App's numeric id
pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY   # the single-line PKCS#8 from phase 3
```

Never reuse the local-dev `BETTER_AUTH_SECRET` — it's in `.dev.vars` on every
dev machine.

**⚠ BOM warning:** don't pipe secret values from PowerShell 5.1 — it prepends a
UTF-8 BOM and the provider will reject the credential as unknown. Paste
interactively or pipe with Git Bash `printf '%s'`.

## Phase 6 — final deploy + smoke test

```bash
pnpm --filter @roster/www build
pnpm --filter @roster/api run deploy
```

Walk, in order (each step proves a different integration):

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

Any later change — build first, then deploy (two commands; PowerShell 5.1
has no `&&`):

```bash
pnpm --filter @roster/www build
pnpm --filter @roster/api run deploy
```

Migrations added later: `wrangler d1 migrations apply roster-db --remote`
before the deploy. Secrets and D1 survive deploys — only code and `vars` ship.

A deploy always ships whatever is in `apps/www/build/client` — rebuild from an
up-to-date tree before deploying, and verify the served `index.html` references
the `assets/manifest-*.js` hash you just built.

## Operating the deployment

Everything below runs from `apps/api` (`pnpm exec wrangler …`). No `--env`.

**Live logs — the first tool to reach for when it misbehaves:**

```bash
pnpm exec wrangler tail --format pretty
```

Streams every request and every `console.error` as it happens. The API's error
handler logs the real upstream failure (e.g.
`github unavailable: GET /user/installations → 503`), which the SPA only shows
as a generic banner — the tail is where the actual cause lives.

**Versions and rollback:**

```bash
pnpm exec wrangler deployments list          # what's live, and its history
pnpm exec wrangler versions list             # every uploaded version
pnpm exec wrangler versions view <VERSION_ID>   # a version's compat date/flags, bindings, secret NAMES
pnpm exec wrangler rollback <VERSION_ID>        # make an old version live again
```

Every deploy's version id is printed at the end (`Current Version ID: …`).
Rollback re-activates that exact version — code, vars, and its secrets — so a
bad deploy is undone in seconds without a rebuild.

**Secrets:**

```bash
pnpm exec wrangler secret list               # names only — values are write-only
pnpm exec wrangler secret put <KEY>          # set/replace one (paste prompt)
pnpm exec wrangler secret delete <KEY>
```

**Database:**

```bash
pnpm exec wrangler d1 migrations list roster-db --remote    # applied vs pending
pnpm exec wrangler d1 execute roster-db --remote --json --command "SELECT …"
```

`d1 execute` is the remote-debugging escape hatch (row counts, drift checks).
SQLite gotcha: a double-quoted name that matches no column silently becomes a
string literal instead of erroring — the auth tables are snake_case
(`provider_id`, `access_token`), so a typo'd camelCase query "works" and
returns garbage.

**When the app blames GitHub, check GitHub first.** The SPA's "GitHub is
unreachable right now" banner plus 503s on everything GitHub-backed is the
app's *designed* response to a GitHub outage — `wrangler tail` will show
`github unavailable: … → 5xx` from GitHub itself. Before suspecting a deploy or
the secrets, check <https://www.githubstatus.com>. `/api/health` only proves
the Worker runs; it says nothing about the GitHub leg.

## Not in scope (revisit for real use)

- CI deploys (GitHub Actions with a Cloudflare API token).
- D1 backups / time travel beyond the built-in 30 days.
- Rate-limit headroom: shares the GitHub App installation quota
  (5000/hr/org) — a class of 30 doesn't approach it.
