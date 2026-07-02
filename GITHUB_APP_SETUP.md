# GitHub App setup (`HeigVdLabs`)

labs uses **one GitHub App** for two distinct jobs. This document explains what
it's for and how to create/configure it from scratch (or reconfigure an existing
one).

> **Current dev instance:** name `HeigVdLabs`, slug `heigvdlabs`, App ID
> `4194411`, owner `@Ovich`. The steps below are what produced it — follow them
> to recreate the App in another account/org or to stand up a production one.

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
   `apps/api/src/auth.ts` (`socialProviders.github`).
2. **Connect a class (per org)** — a teacher installs the App on a GitHub org
   they own. GitHub redirects to our **Setup URL**; the server records a thin
   `classes` row and sets the org's base repository permission to **No access**
   using an **installation token** (Octokit App, signed with the App's private
   key). See `apps/api/src/routes/setup.ts`, `apps/api/src/routes/classes.ts`,
   `apps/api/src/github.ts`.

## Prerequisites

- A GitHub account (personal is fine for dev) to **own** the App.
- A GitHub **organization you own** to test the "connect a class" flow (a
  personal-account App must be **public** to be installed on an org — see below).

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
| **Members** | **Read & write** | enrollment (invite students as org members) — F4 |

Leave **Repository** and **Account** permissions at their defaults (Metadata:
Read is implied). Add more only when a feature needs it.

> Changing permissions on an **already-installed** App requires each installation
> to approve the new permissions. For a fresh install it's included.

### 6. Where can this App be installed?

**Any account.** A personal-account App set to "Only on this account" **cannot be
installed on an organization** (orgs are separate accounts), so it must be public
to connect org-classes. (An org-owned App can stay "Only on this account" if all
target orgs are under that account.)

### 7. Generate a private key

**General → Private keys → Generate a private key** → downloads a `.pem`. Note
the **App ID** (top of the General page). The private key signs the App JWT used
to mint installation tokens.

## Wire the secrets

The Worker reads these as **secrets** — never commit them.

**Local dev** — `apps/api/.dev.vars`:

```dotenv
# User OAuth (linking GitHub identity)
GITHUB_CLIENT_ID=Iv23li...
GITHUB_CLIENT_SECRET=...

# App / installation auth (connect a class)
GITHUB_APP_ID=4194411
# Single line; \n replaces the PEM newlines (Octokit normalizes them):
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

**Production** — set them as Worker secrets instead of `.dev.vars`:

```bash
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

The frontend also needs the **public** App slug to build the install link — it's
not a secret (`apps/www`, wired to `heigvdlabs`):
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
