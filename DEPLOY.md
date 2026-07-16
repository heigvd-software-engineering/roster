# Deploying an environment to Cloudflare (from scratch)

Target: a working deployment on a **Cloudflare account**, on the free
`workers.dev` origin — no custom domain needed. One Worker serves both the
API (Hono) and the SPA (static assets binding, SPA fallback,
`run_worker_first: ["/api/*"]`), so there is exactly ONE thing to deploy.

The deployed origin is deterministic — worker name + the account's
`workers.dev` subdomain (shown in the dash under Workers & Pages):

```
https://<worker-name>.<subdomain>.workers.dev
```

Everything below refers to it as `<ORIGIN>`. The existing `demo` environment
is a worked example: worker `labs` on the demo account resolves to
`https://labs.stefan-teofanov.workers.dev` — the values in `wrangler.jsonc`'s
`env.demo` block are exactly what this guide produced for it.

## The one external dependency, up front

**SWITCH edu-ID.** Sign-in is OIDC against `login.eduid.ch` with client
`hes-so_labs_client`. The client registration must list the demo's redirect
URI or every sign-in dies at SWITCH:

```
<ORIGIN>/api/auth/oauth2/callback/switch
```

If you can edit the client registration yourself, add it in phase 4. If it
belongs to HES-SO administration, request it FIRST — everything else can
proceed in parallel, but no one signs in until this lands.

## One GitHub App PER ENVIRONMENT — not optional

A GitHub App accepts up to 10 **Callback URLs** (OAuth linking works from
several origins), but the **Setup URL is single-valued** — and the entire
"connect a class" flow hangs on it: after an org installs/reconfigures the
App, GitHub redirects the browser to that one URL, which is where the class
row is born (`/api/github/setup`). Whichever environment does NOT own the
Setup URL gets its install redirects hijacked to the other one.

So: `heigvdlabs` (Setup URL → `https://localhost:3000`…) stays DEV-only,
and the demo gets its own App (phase 3). Sharing one App was tried and only
works one environment at a time — treat the per-environment App as a hard
requirement.

Corollary: each environment's D1 knows only the classes born through ITS
setup callback. An org visible in `/user/installations` but without a class
row in this environment's DB shows no class — that's the data model
("GitHub proposes, the DB disposes"), not a bug.

## Phase 0 — prerequisites

- Cloudflare account (free plan is enough: Workers free tier + D1 free tier
  comfortably cover a demo).
- `wrangler login` (opens the browser; grants the CLI your account).
- Your personal GitHub account (the demo's GitHub App will live there).

```powershell
cd apps/api
pnpm exec wrangler login
pnpm exec wrangler whoami   # note the account; the workers.dev subdomain is in the dash (Workers & Pages → your subdomain)
```

## Environments — read this before running anything

`apps/api/wrangler.jsonc` declares three environments side by side. Every
`wrangler` command below takes `--env <name>`:

| Env | Worker | What |
|---|---|---|
| `dev` | `labs-dev` | local only — `wrangler dev` reads it; never deployed |
| `demo` | `labs` | the demo on the personal account |
| `prod` | `labs-heigvd` | HEIG-VD's environment — placeholders until provisioned |

Two rules follow from how Wrangler environments work, and both bite silently:

- **`vars` and `d1_databases` are not inherited.** Each env block restates them
  in full. Omit one and wrangler only *warns*, then deploys a Worker with no
  database — which fails at runtime, not at deploy. There are deliberately no
  top-level `vars`/`d1_databases` to inherit from.
- **`name` is pinned per env.** By default a Worker deploys as
  `<name>-<env>` (`labs-demo`), which would move the origin and break
  `BETTER_AUTH_URL`, both GitHub App URLs, and the SWITCH redirect URI at once.
  Each block sets `name` explicitly so the origin is whatever the table says.

`--env` is not optional even for D1: `migrations_dir` lives on the binding, so
without it wrangler looks for `apps/api/migrations` and errors.

The rest of this guide provisions **one environment**. Substitute its name for
`<ENV>` throughout — the demo used `demo`; HEIG-VD's will use `prod`.

## Phase 1 — database + first deploy (claims the URL)

Create the remote D1 and point the config at it:

```powershell
pnpm exec wrangler d1 create labs
# → copy the printed database_id into this environment's `d1_databases` block
#   in wrangler.jsonc (env.<ENV>). The `dev` and `prod` blocks ship an
#   all-zeros placeholder id — dev ignores it (miniflare uses a local sqlite),
#   prod is meant to fail loudly until it is filled in.
```

Apply all migrations (13 files in `packages/db/migrations`) to the REMOTE db:

```powershell
pnpm exec wrangler d1 migrations apply labs --remote --env <ENV>
```

Build the SPA, then deploy (the Worker embeds `apps/www/build/client`):

```powershell
pnpm --filter @labs/www build
pnpm --filter @labs/api run deploy:<ENV>
# → prints the Worker's origin — this is <ORIGIN>
```

> **There is no bare `deploy` script.** An environment-less deploy would ship a
> Worker with no `vars` and no D1 (neither is inherited), so `deploy` exists
> only to fail with a message pointing at `deploy:demo` / `deploy:prod`. Note
> this also sidesteps the old `pnpm deploy` trap: `deploy` is a pnpm built-in,
> so `pnpm --filter @labs/api deploy` was intercepted by pnpm itself and died
> with `ERR_PNPM_INVALID_DEPLOY_TARGET`. `deploy:demo` is not a built-in and
> needs no `run` — it is kept in the commands here only for consistency.

The app will load but sign-in is dead until phases 2–5. That's expected.

## Phase 2 — public config in wrangler.jsonc, secrets outside it

Non-secret config is committed, per environment; secrets never are. Wrangler
does **not** interpolate env vars into `wrangler.jsonc` (`${VAR}` ships as a
literal string), and an `.env` file does not override a declared `var` on
deploy — so the config file is the only place these values can live.

In this environment's block in `wrangler.jsonc`:

```jsonc
"env": {
  "<ENV>": {
    "name": "<worker name — pins the origin; see the table above>",
    "vars": {
      "BETTER_AUTH_URL": "<ORIGIN>",
      "EDUID_ISSUER": "https://login.eduid.ch",
      "GITHUB_APP_SLUG": "<this environment's App slug, from phase 3>"
    },
    "d1_databases": [ /* … the id from phase 1, in full … */ ]
  }
}
```

Restate all three `vars` — a var present only at the top level would not be
inherited. Local dev needs no override file for these: the `dev` env already
carries `https://localhost:3000` and the `heigvdlabs` App. `apps/api/.dev.vars`
(git-ignored) holds only the **secrets** from phase 5, and `wrangler dev --env
dev` loads it as long as no `.dev.vars.dev` exists — if that file is ever
created, it *replaces* `.dev.vars` rather than merging with it.

## Phase 3 — the demo's own GitHub App

One App per environment (see the notice above). **Follow
`GITHUB_APP_SETUP.md`** — the canonical creation guide (field-by-field form
values, permissions, private-key conversion) — substituting the demo's
values:

| Placeholder in the guide | Demo value |
|---|---|
| App name | e.g. `heigvdlabs-demo` (its derived **slug** goes in `GITHUB_APP_SLUG`) |
| Callback URL | `<ORIGIN>/api/auth/callback/github` |
| Setup URL | `<ORIGIN>/api/github/setup` |

Note the guide's own gotchas — they all apply verbatim: "Request user
authorization during installation" stays **unchecked**, the Setup URL must
not be left blank, the App must be **public** (Advanced → Make public) to be
installable on orgs, and the private key must be converted to **PKCS#8**.

Collect on the new App's General page: **App ID**, **slug**, **Client ID**,
a generated **client secret**, and the converted **private key** — they feed
`wrangler.jsonc` (`GITHUB_APP_SLUG`) and the four `GITHUB_*` secrets in
phase 5, then redeploy (phase 6).

**If the environment previously ran under another App:** class rows point at
installation ids of the App that created them — unreachable after the swap.
For a fresh demo just delete the old class rows; otherwise install the new
App on each org and let the `installation` reconciler repair the pointer.

## Phase 4 — SWITCH edu-ID redirect URI

Add `<ORIGIN>/api/auth/oauth2/callback/switch` to the `hes-so_labs_client`
registration (or the demo's own client if a separate one is provisioned —
then its id/secret go in the phase-5 secrets instead).

## Phase 5 — secrets

Seven secrets, all via `wrangler secret put` (each opens a paste prompt;
run from `apps/api`). Secrets are **scoped per environment** — `--env` is what
decides which Worker they land on, and they are never inherited:

```powershell
pnpm exec wrangler secret put BETTER_AUTH_SECRET     --env <ENV>   # FRESH random: node -e "console.log(crypto.randomBytes(32).toString('hex'))"
pnpm exec wrangler secret put EDUID_CLIENT_ID        --env <ENV>
pnpm exec wrangler secret put EDUID_CLIENT_SECRET    --env <ENV>
pnpm exec wrangler secret put GITHUB_CLIENT_ID       --env <ENV>   # this environment's App OAuth client id
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET   --env <ENV>
pnpm exec wrangler secret put GITHUB_APP_ID          --env <ENV>   # this environment's App numeric id
pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY --env <ENV>   # the single-line PKCS#8 from phase 3
```

Never reuse the dev `BETTER_AUTH_SECRET` — it's in `.dev.vars` on every dev
machine.

**⚠ BOM warning (see 3.5):** don't pipe secret values from PowerShell 5.1 —
it prepends a UTF-8 BOM and the provider will reject the credential as
unknown. Paste interactively or pipe with Git Bash `printf '%s'`.

## Phase 6 — final deploy + smoke test

```powershell
pnpm --filter @labs/www build
pnpm --filter @labs/api run deploy:<ENV>
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

```powershell
pnpm --filter @labs/www build
pnpm --filter @labs/api run deploy:demo    # or deploy:prod
```

Migrations added later: `wrangler d1 migrations apply labs --remote --env demo`
before the deploy. Secrets and D1 survive deploys — only code and `vars` ship.

The build is the same artifact for every environment (`apps/www/build/client`);
only the Worker's config differs. So a deploy always ships whatever is in that
directory — rebuild from an up-to-date tree before deploying, and verify the
served `index.html` references the `assets/manifest-*.js` hash you just built.

## Not in scope (fine for a demo, revisit for real use)

- Custom domain (`labs.heig-vd.ch`-style) — a one-click Workers custom
  domain later; requires updating BETTER_AUTH_URL, both GitHub App URLs,
  and the SWITCH redirect URI.
- CI deploys (GitHub Actions with a Cloudflare API token).
- D1 backups / time travel beyond the built-in 30 days.
- Rate-limit headroom: the demo shares the GitHub App installation quota
  (5000/hr/org) — a class of 30 doesn't approach it.
