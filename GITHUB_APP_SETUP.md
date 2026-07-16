# GitHub App setup (`HeigVdLabs`)

labs uses **one GitHub App per environment** for two distinct jobs. This
document explains what the App is for and how to create/configure one from
scratch (or reconfigure an existing one).

> **Current dev instance:** name `HeigVdLabs`, slug `heigvdlabs`, App ID
> `4194411`, owner `@Ovich`. The steps below are what produced it — follow them
> to recreate the App in another account/org or to stand up a production one.

## ⚠ One App per ENVIRONMENT — not optional

Each running environment (localhost, the workers.dev demo, a future prod)
needs its **own** App. The App accepts up to 10 **Callback URLs**, so OAuth
linking could share one — but the **Setup URL is single-valued**, and the
whole "connect a class" flow hangs on it: after an org installs or
reconfigures the App, GitHub redirects the browser to that ONE URL, which is
where the class row is born. Whichever environment does not own the Setup
URL gets its install redirects hijacked to the other one. Sharing was tried
(dev + demo); it only works one environment at a time.

Corollary: every URL in this guide is per-environment. Dev uses
`https://localhost:3000`; substitute the environment's origin (e.g.
`https://labs.stefan-teofanov.workers.dev`) everywhere when creating that
environment's App.

## Why a GitHub App (not an OAuth App)?

A GitHub **App** can act in two modes, which is exactly what labs needs:

| Mode | Token | Used for | In labs |
|---|---|---|---|
| **User-to-server** (OAuth) | short-lived **user** token (~8 h, refreshable) | identify a person, read what *they* can access | Linking a student/teacher's GitHub identity to their edu-ID account (onboarding). |
| **Server-to-server** (installation) | short-lived **installation** token | act on an org the App is *installed* on, with least privilege | Connecting a class: reading org members, setting the org base permission, later creating repos/teams. |

An OAuth App only does the first. The installation model also means **org write
powers live in the installation, never in a user token** — least privilege — and
each org owner explicitly consents by installing the App.

### The two flows

1. **Link GitHub (per user)** — Better Auth uses the App's OAuth credentials
   (Client ID/secret + Callback URL) to link a user's GitHub account. See
   `apps/api/src/lib/auth/config.ts` (`socialProviders.github`).
2. **Connect a class (per org)** — a teacher installs the App on a GitHub org
   they own. GitHub redirects to our **Setup URL**; the server records a thin
   `classes` row and sets the org's base repository permission to **No access**
   using an **installation token** (Octokit App, signed with the App's private
   key). See `apps/api/src/handlers/setup.ts`, `apps/api/src/handlers/classes.ts`,
   `apps/api/src/lib/github/` (clients + operations).

## Prerequisites

- A GitHub account (personal is fine for dev) to **own** the App.
- A GitHub **organization you own** to test the "connect a class" flow (a
  personal-account App must be **public** to be installed on an org — see below).

> **⚠ "Owner" means GitHub org Owner, literally.** On the install picker, an
> org where you're a plain Member shows **Request** (or "Cancel request")
> instead of **Install** — clicking it files an approval request with the
> org's owners and bounces you back WITHOUT installing, so no class is
> created and no confirm page appears. Check your role under
> `github.com/orgs/<org>/people`; only Install completes the connect flow.
> (The same rule holds in the product: labs' teacher check is a live
> is-org-admin call, so a class on an org you don't own would never be
> yours anyway.)

## Create the App

Go to **https://github.com/settings/apps** → **New GitHub App** (for an
org-owned App: `https://github.com/organizations/<org>/settings/apps`).

### 1. Basic information

| Field | Value |
|---|---|
| **GitHub App name** | `HeigVdLabs` (any unique name; the lowercased, hyphenated name becomes the **slug** used in the install URL) |
| **Homepage URL** | your project/repo URL, e.g. `https://github.com/heigvd-software-engineering/labs` |
| **Description** | e.g. "Connecting your GitHub organisation with Labs" |

### 2. Identifying and authorizing users (OAuth — for user login/linking)

| Field | Value |
|---|---|
| **Callback URL** | `https://localhost:3000/api/auth/callback/github` (dev). Production: `https://<your-domain>/api/auth/callback/github` |
| **Request user authorization (OAuth) during installation** | **unchecked** — we attribute an install to the signed-in user via our own first-party session cookie, not an install-time OAuth |
| **Enable Device Flow** | unchecked |

### 3. Post installation (Setup URL — the connect-a-class callback)

| Field | Value |
|---|---|
| **Setup URL** | `https://localhost:3000/api/github/setup` (dev). Production: `https://<your-domain>/api/github/setup` |
| **Redirect on update** | **checked** |

After a user installs (or updates) the App on an org, GitHub redirects here with
`installation_id` + `setup_action`; the server creates/updates the class.

> **⚠️ Don't leave this blank — and click Save.** If the Setup URL is empty, the
> install *silently succeeds on GitHub but never calls back*, so no class is
> created and the connect flow appears to do nothing. Verify the field shows the
> value after saving (a blank field is the #1 setup mistake).

### 4. Webhook

**Not required for F3.** Uncheck **Active** (or leave the URL empty). labs
currently reconciles installation state on read (via `GET /user/installations`)
rather than consuming the `installation` webhook. If real-time
uninstall/reinstall handling is added later, set the Webhook URL + secret then.

### 5. Permissions

Only the minimum. Under **Permissions & events → Organization permissions**:

| Permission | Access | Why |
|---|---|---|
| **Administration** | **Read & write** | set the org's **base repository permission** to "No access" (`PATCH /orgs/{org}`) |
| **Members** | **Read & write** | enrollment (invite students as org members) — F4; teams = groups — F7 |

And under **Repository permissions** (added for F8 — work repo distribution):

| Permission | Access | Why |
|---|---|---|
| **Administration** | **Read & write** | create the work repos (`POST /orgs/{org}/repos`, `/generate`), grant the group's team push |
| **Contents** | **Read & write** | `auto_init` the empty repos / generate from a template |

Leave **Account** permissions at their defaults (Metadata: Read is implied).
Add more only when a feature needs it.

> Changing permissions on an **already-installed** App requires each installation
> to approve the new permissions (org Settings → GitHub Apps → review request;
> until approved, repo creation answers `403 Resource not accessible by
> integration` — labs surfaces it as an "App needs updated permissions"
> message). For a fresh install it's included.

### 6. Where can this App be installed?

**Any account.** A personal-account App set to "Only on this account" **cannot be
installed on an organization** (orgs are separate accounts), so it must be public
to connect org-classes. (An org-owned App can stay "Only on this account" if all
target orgs are under that account.)

> **Where this setting lives:** for a personal-account App there's no radio on
> the General page — it's under the **Advanced** tab as **"Make public"**. Click
> that. Until you do, the install page only offers your personal account (no org
> selector), and the Organization permissions never come into play (the personal
> view just says "read access to public resources").

You also need a **GitHub organization you own** to install onto — create a
dedicated classroom org if you don't have one.

### 7. Generate the credentials (after Create)

The App's General page shows the **App ID** (top) and **Client ID** — note
both. The other two credentials must be **generated**; neither exists on a
fresh App:

1. **Client secret** — General → *Client secrets* → **Generate a new client
   secret**. Shown **once**: copy it immediately (this is the OAuth pair for
   user linking, `GITHUB_CLIENT_SECRET`).
2. **Private key** — General → *Private keys* → **Generate a private key** →
   downloads a `.pem`. It signs the App JWT used to mint installation tokens.

> **⚠️ Convert the key to PKCS#8.** GitHub issues the key as **PKCS#1**
> (`-----BEGIN RSA PRIVATE KEY-----`), but the App JWT is signed with **Web
> Crypto** (both on Node and on Cloudflare Workers), which only accepts
> **PKCS#8** (`-----BEGIN PRIVATE KEY-----`). Using the raw PKCS#1 key fails with
> `error:1E08010C:DECODER routines::unsupported`. Convert it once:
>
> ```bash
> openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
>   -in downloaded.pem -out app-key-pkcs8.pem
> ```
>
> Store the **PKCS#8** output. `createAppClient` (`apps/api/src/lib/github/clients.ts`)
> normalizes the `\n`, so store it single-line with `\n` (see below).

## Wire the secrets

The Worker reads these as **secrets** — never commit them.

**Local dev** — `apps/api/.dev.vars`:

```dotenv
# User OAuth (linking GitHub identity)
GITHUB_CLIENT_ID=Iv23li...
GITHUB_CLIENT_SECRET=...

# App / installation auth (connect a class)
GITHUB_APP_ID=4194411
# PKCS#8 key (step 7), single line; \n replaces the real newlines
# (createAppClient normalizes \n -> newlines):
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```
Turn a PEM into that single line: `awk 'NF{printf "%s\\n",$0}' app-key-pkcs8.pem`.

**Deployed environments** — set them as Worker secrets instead of `.dev.vars`
(full deployment flow: `DEPLOY.md`):

```bash
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

> **⚠ BOM warning:** don't PIPE secret values into `wrangler secret put` from
> PowerShell 5.1 — it prepends a UTF-8 BOM and the provider then rejects the
> credential as unknown. Paste interactively, or pipe from Git Bash with
> `printf '%s' "<value>" | wrangler secret put NAME`.

The install link also needs the **public** App slug — not a secret. It's the
`GITHUB_APP_SLUG` var (`wrangler.jsonc` for the deployed value, `.dev.vars`
override for dev), delivered to the SPA via `/api/me`:
`https://github.com/apps/<slug>/installations/new`.

## How "connect a class" works end to end

1. Signed-in teacher clicks **Connect a GitHub organization** → browser goes to
   `https://github.com/apps/heigvdlabs/installations/new`.
2. Teacher installs the App on an org they own (only org owners can install —
   self-gating; no teacher role stored).
3. GitHub redirects to the **Setup URL** (`/api/github/setup`) with the
   `installation_id`. The server: identifies the user (session cookie), resolves
   the org via the App JWT (`GET /app/installations/{id}`), and writes a thin
   `classes` row keyed on the stable **org id**.
4. The user lands on a **confirm page**; confirming makes the server set the org
   **base repository permission** to **No access** (`PATCH /orgs/{org}`, with an
   installation token) and verify it.
5. The class then appears in the teacher's list, with the org name/avatar read
   live from GitHub.

## Notes / gotchas

- **User tokens expire (~8 h).** GitHub App user-to-server tokens are short-lived
  (with a 6-month refresh token). labs treats an unusable GitHub link by routing
  the user back through onboarding to re-link.
- **The class keys on the org id, not the installation id.** Reinstalling the App
  changes the `installationId` (reconciled on read); the `orgId` is stable.
- **Nothing about the org is stored** beyond the thin anchor row — name, avatar,
  and members are read live each visit.
