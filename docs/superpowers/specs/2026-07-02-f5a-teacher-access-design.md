# F5a — Multi-teacher access model (design)

**Date:** 2026-07-02 · **Status:** approved (design) · **Slice:** the access-model
half of F5, pulled ahead of F4 because F4/F6 write routes must sit on the right
authorization primitive. F5b (people counts/roster UI, health chip) follows later.

## Problem

A class is a GitHub org, and orgs have **multiple Owners** (co-teachers). Today
`GET /api/classes` filters by `connectedByUserId` and the confirm route checks
the same column — so only the teacher who clicked "Connect" can see or
administer the class. A co-owner professor gets an empty hub (a dead end,
confirmed in review).

## Decision

**Teacher = live GitHub org Owner (role `admin`).** Delegate the teacher
relationship entirely to GitHub — no labs-side teacher table, no invitations.
Making someone a co-teacher = making them an org Owner on GitHub; removing them
removes their labs access on the next read. `connectedByUserId` remains
**provenance only** (who connected the class), never authorization.

### Why not installation-accessibility alone

"Org appears in the caller's `GET /user/installations`" is only a teacher
signal *today* (base permission "No access" ⇒ only Owners can access the
installation). Once **F8** grants student teams access to lab repos, students
gain installation access too — an intersection-only model would then list
classes on students' teacher hub and pass their writes. The role check is what
survives F8.

### The check (installation-token based)

Caller's GitHub **user id** ∈ the org's **admins**:

- The caller's GitHub id comes from the stored `account` row
  (`providerId: "github"` → `accountId`) — no user-token call, so an expired
  user OAuth token cannot break authorization.
- The org's admins come from `GET /orgs/{org}/members?role=admin` with the
  **installation token** (server-to-server; matches least-privilege rules).

## Server design (`apps/api`)

New module `src/github-teacher.ts`:

- `callerGithubId(db, userId): Promise<number | null>` — reads the `github`
  `account.accountId`, parsed to a number; null when unlinked.
- `isOrgAdmin(env, installationId, orgLogin, githubUserId): Promise<boolean>` —
  installation-token `GET /orgs/{org}/members?role=admin`, true iff the id is in
  the list. Errors propagate to the caller for containment there.

### Route changes

- **`GET /api/classes`** — keep the existing flow (rows → caller's
  installations intersection → reconcile), but:
  1. list **all** class rows whose `orgId` is in the caller's installations
     (new helper `listClassesByOrgIds(db, orgIds)`, replacing
     `listClassesByUser` in this route);
  2. per surviving class (parallel, error-contained like the enrich): admin
     check — **not an admin ⇒ class skipped**;
  3. response shape unchanged (`{ classes: [...] }`) — the hub UI needs no
     changes.
- **`POST /api/classes/:id/confirm`** — replace the `connectedByUserId`
  comparison with the admin check (resolve org login from the installation as
  it already does): **not an admin ⇒ 404** (no existence leak). This is the
  authorization pattern all future class writes (F4 join-token, F6 create-lab)
  must copy.
- **Setup callback** — unchanged. Its installation-ownership check (caller's
  `GET /user/installations` contains the id) already proves the installer is
  party to the installation; only an org Owner can install an App, so the
  installer is an Owner by construction.

### DB

`listClassesByOrgIds(db, orgIds: number[])` added to `packages/db/src/classes.ts`
(a `WHERE org_id IN (...)` select; empty input → `[]`). `listClassesByUser`
stays for provenance queries if needed later; no schema change.

## Behavior (the acceptance story)

Org with Owners A and B. A connects the class. B signs in to labs (edu-ID +
GitHub link) — **the class is already on B's hub**, and B can run every teacher
action (confirm today; join-link/labs later). No claim, no invite. If B is
demoted to Member on GitHub, the class disappears from B's hub on the next load
and writes 404.

## Error handling

- Caller has no linked GitHub / no parsable `accountId` → treated as
  not-a-teacher (list: empty contribution; write: 404). The onboarding gate
  makes this state unreachable in practice.
- Admin-list call fails for one org → that class is skipped in the list (same
  containment as the enrich); on writes the error propagates as a 5xx (the
  action must not proceed on an unverified role).
- Orgs large enough to paginate the admin list are out of scope for now
  (class orgs are small); noted as a future hardening if a real org exceeds
  the default page.

## Testing

Mocked-Octokit route tests:

- list: a class row connected by A is **returned for B** when B's installations
  include the org AND B's GitHub id is in the org admins; **skipped** when B is
  not an admin (even with installation access — the F8 regression guard).
- confirm: co-owner B → 200; installation-accessible non-admin → 404 and no
  GitHub writes.
- db: `listClassesByOrgIds` (match, no-match, empty input) against real D1.

**🔴 Live gate (user has two GitHub accounts):** account #2 added as org Owner
on the test org → sign in with it in labs → the class appears; run confirm.
Then demote to Member → hub empty for #2.

## Out of scope

People counts/roster UI + base-permission health chip (F5b), join link (F4),
student surfaces (F9). No caching layer — reads are live per request; add
short-TTL caching only when the dashboard (F10) needs it.
