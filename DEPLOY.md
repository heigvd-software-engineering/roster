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

## Phase 0: prerequisites

- Cloudflare account (free plan is enough: Workers + D1 free tiers cover this).
- The **`y-software.ch` zone on that account**: deploy provisions the Worker's
  custom domain from `wrangler.jsonc`'s `routes`, which requires the zone
  active on the deploying account.
- `wrangler login` (opens the browser; grants the CLI your account).
- A GitHub account for the App, and a GitHub **organization you own** to test
  the connect-a-class flow against.

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

Local dev overrides `BETTER_AUTH_URL` and `GITHUB_APP_SLUG` in
`apps/api/.dev.vars` (git-ignored); a value there wins over `vars` during
`wrangler dev`. That file also holds the phase-5 **secrets**. Copy
`apps/api/.dev.vars.example` to start.

### Super admins: the bootstrap

Class creation is a **granted capability**: signing in is not enough. The
chain, from nothing to the first class:

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

Empty or unset `SUPER_ADMIN_EMAILS` fails **closed**: no admin zone for anyone,
and with no grants ever made, no class creation at all. What the role does and
does not reach is in [`docs/identity.md`](docs/identity.md); adding or removing
an admin later is a `vars` edit plus a redeploy, never a migration.

## Phase 3: the GitHub App

One GitHub App backs the deployment, in two modes:

| Mode | Token | Used for | In roster |
|---|---|---|---|
| **User-to-server** (OAuth) | short-lived **user** token (~8 h, refreshable) | identify a person, read what *they* can access | Linking a student/teacher's GitHub identity to their edu-ID account (onboarding). |
| **Server-to-server** (installation) | short-lived **installation** token | act on an org the App is *installed* on, with least privilege | Connecting a class: reading org members, setting the org base permission, creating repos and teams. |

An OAuth App only does the first. The installation model keeps **org write
powers out of user tokens**, and each org owner consents by installing the App.
The flow each mode drives is in
[`docs/classes-and-assignments.md`](docs/classes-and-assignments.md).

### ⚠ The single-valued Setup URL and local dev

The App accepts up to 10 **Callback URLs**, so OAuth *linking* works from both
production and `https://localhost:3000` on one App. But the **Setup URL is
single-valued**, and the connect-a-class flow hangs on it: after an org installs
or reconfigures the App, GitHub redirects the browser to that ONE URL, which
creates the class row (`/api/github/setup`). Point it at production
(`<ORIGIN>/api/github/setup`).

To exercise the install/connect flow **locally**, either temporarily repoint the
Setup URL at `https://localhost:3000/api/github/setup`, or create a separate dev
App and put its slug and OAuth pair in `apps/api/.dev.vars`. Everyday local work
(sign-in, GitHub linking) needs neither.

The D1 knows only the classes born through that setup callback: an org visible
in `/user/installations` without a class row shows no class. That's the data
model ("GitHub proposes, the DB disposes"), not a bug.

> **⚠ "Owner" means GitHub org Owner, literally.** On the install picker, an org
> where you're a plain Member shows **Request** (or "Cancel request") instead of
> **Install**. Clicking it files an approval request with the org's owners and
> bounces you back WITHOUT installing, so no class is created and no confirm page
> appears. Check your role under `github.com/orgs/<org>/people`; only Install
> completes the connect flow.

### Create the App

Go to **https://github.com/settings/apps** → **New GitHub App** (for an
org-owned App: `https://github.com/organizations/<org>/settings/apps`).

**1. Basic information**

| Field | Value |
|---|---|
| **GitHub App name** | e.g. `HeigVdRoster` (any unique name; the lowercased, hyphenated name becomes the **slug** that goes in `GITHUB_APP_SLUG`) |
| **Homepage URL** | your project/repo URL, e.g. `https://github.com/heigvd-software-engineering/roster` |
| **Description** | e.g. "Connecting your GitHub organisation with Roster" |

**2. Identifying and authorizing users** (OAuth, for user login/linking)

| Field | Value |
|---|---|
| **Callback URL** | `<ORIGIN>/api/auth/callback/github` (add `https://localhost:3000/api/auth/callback/github` for local linking) |
| **Request user authorization (OAuth) during installation** | **unchecked**: we attribute an install to the signed-in user via our own first-party session cookie, not an install-time OAuth |
| **Enable Device Flow** | unchecked |

**3. Post installation** (Setup URL, the connect-a-class callback)

| Field | Value |
|---|---|
| **Setup URL** | `<ORIGIN>/api/github/setup` |
| **Redirect on update** | **checked** |

After a user installs (or updates) the App on an org, GitHub redirects here with
`installation_id` + `setup_action`; the server creates or updates the class.

> **⚠️ Don't leave this blank, and click Save.** An empty Setup URL lets the
> install *silently succeed on GitHub without ever calling back*, so no class is
> created and the connect flow appears to do nothing. Check that the field shows
> the value after saving (a blank field is the #1 setup mistake).

**4. Webhook**

**Not required.** Uncheck **Active** (or leave the URL empty). roster reconciles
installation state on read (via `GET /user/installations`) instead of consuming
the `installation` webhook. Set the Webhook URL + secret later if real-time
uninstall/reinstall handling is added.

**5. Permissions**

Only the minimum. Under **Permissions & events → Organization permissions**:

| Permission | Access | Why |
|---|---|---|
| **Administration** | **Read & write** | set the org's **base repository permission** to "No access" (`PATCH /orgs/{org}`) |
| **Members** | **Read & write** | enrollment: invite students as org members; teams = groups |

And under **Repository permissions** (work repo distribution):

| Permission | Access | Why |
|---|---|---|
| **Administration** | **Read & write** | create the work repos (`POST /orgs/{org}/repos`, `/generate`), grant the group's team push |
| **Contents** | **Read & write** | `auto_init` the empty repos / generate from a template |

Leave **Account** permissions at their defaults (Metadata: Read is implied). Add
more only when a feature needs it. Which operation spends which permission is
listed in
[`apps/api/src/lib/github/README.md`](apps/api/src/lib/github/README.md).

> Changing permissions on an **already-installed** App requires each installation
> to approve the new permissions (org Settings → GitHub Apps → review request).
> Until approved, repo creation answers `403 Resource not accessible by
> integration`, which roster surfaces as an "App needs updated permissions"
> message. A fresh install includes them.

**6. Where can this App be installed?**

**Any account.** A personal-account App set to "Only on this account" **cannot be
installed on an organization** (orgs are separate accounts), so it must be public
to connect org-classes. (An org-owned App can stay "Only on this account" if all
target orgs are under that account.)

> **Where this setting lives:** a personal-account App has no radio on the
> General page. It's under the **Advanced** tab as **"Make public"**. Click that.
> Until you do, the install page only offers your personal account (no org
> selector), and the Organization permissions never come into play (the personal
> view just says "read access to public resources").

**7. Generate the credentials** (after Create)

The App's General page shows the **App ID** (top) and **Client ID**; note both,
along with the **slug**. Generate the other two, which no fresh App has:

1. **Client secret**: General → *Client secrets* → **Generate a new client
   secret**. Shown **once**, so copy it immediately (this is the OAuth pair for
   user linking, `GITHUB_CLIENT_SECRET`).
2. **Private key**: General → *Private keys* → **Generate a private key**,
   which downloads a `.pem`. It signs the App JWT used to mint installation
   tokens.

> **⚠️ Convert the key to PKCS#8.** GitHub issues the key as **PKCS#1**
> (`-----BEGIN RSA PRIVATE KEY-----`), but the App JWT is signed with **Web
> Crypto** (both on Node and on Cloudflare Workers), which only accepts
> **PKCS#8** (`-----BEGIN PRIVATE KEY-----`). The raw PKCS#1 key fails with
> `error:1E08010C:DECODER routines::unsupported`. Convert it once:
>
> ```bash
> openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
>   -in downloaded.pem -out app-key-pkcs8.pem
> ```
>
> Store the **PKCS#8** output. `createAppClient`
> (`apps/api/src/lib/github/clients.ts`) normalizes the `\n`, so store it
> single-line: turn the PEM into one with
> `awk 'NF{printf "%s\\n",$0}' app-key-pkcs8.pem`.

Those five values feed `GITHUB_APP_SLUG` in `wrangler.jsonc` (phase 2) and the
four `GITHUB_*` secrets in phase 5. Locally they go in `apps/api/.dev.vars`:

```dotenv
# User OAuth (linking GitHub identity)
GITHUB_CLIENT_ID=Iv23li...
GITHUB_CLIENT_SECRET=...

# App / installation auth (connect a class)
GITHUB_APP_ID=4194411
# PKCS#8 key, single line; \n replaces the real newlines
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

The slug is not a secret: it builds the install link the SPA opens,
`https://github.com/apps/<slug>/installations/new`, delivered through `/api/me`.

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
6. Create an assignment, accept it from a student test account via the join link →
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

A second target, `apps/api/wrangler.demo.jsonc`, ships the `roster` Worker to
its workers.dev URL against the older `labs` D1, so existing demo data survives:
`pnpm --filter @roster/api run deploy:demo`. That name is the product's own
former one, not the assignment concept, and the binding is by `database_id`
anyway, so leave it alone.

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

Three defenses ship with the Worker and need no setup, each invisible until it
refuses something. The mechanism is in
[`docs/architecture.md`](docs/architecture.md); what matters when operating:

- **Rate limits.** Over the limit answers `429 {"error":"rate_limited"}`. The
  two `ratelimits` bindings in `wrangler.jsonc` are declared per route module,
  not in a central list, and `namespace_id` is just a counter name, provisioned
  nowhere. The binding is optional in code, so `wrangler dev` runs without it.
- **Response headers.** The SPA's come from `apps/www/build/client/_headers`,
  GENERATED at build time (the CSP hashes the built page's inline scripts, so
  hand-writing it fails). The Worker sets the API's. Neither covers the other.
- **Same-origin writes.** Writes under `/api` get
  `403 {"error":"cross_origin"}` from a different origin. A future deploy
  serving the SPA from a SECOND origin will trip that check, which is keyed on
  `BETTER_AUTH_URL`.

## Not in scope (revisit for real use)

- CI deploys (GitHub Actions with a Cloudflare API token).
- D1 backups / time travel beyond the built-in 30 days.
- GitHub API headroom: shares the GitHub App installation quota
  (5000/hr/org); a class of 30 doesn't approach it.
- OAuth tokens (`account.access_token` / `refresh_token`) are stored in D1
  in the clear. Better Auth can encrypt them (`account.encryptOAuthTokens`),
  which needs a decision about the rows already there.
