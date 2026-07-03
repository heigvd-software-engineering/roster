# F4 — Class join link + student enrollment (design)

**Date:** 2026-07-03 · **Status:** approved (brainstorm 2026-07-03)
**Grounding:** foundation flows §3.5 (share join link) + §3.8 (student joins);
classes-hub design (Copy button on `ClassCard`); F5a teacher-access model
(`isOrgAdmin` guard on teacher writes).

## Outcome

A teacher copies one durable join link from the class card and shares it with
the cohort. A student opens it, sees what class they're joining, clicks **Join
class**, accepts GitHub's native org invitation, and is enrolled (= org
**Member**). Idempotent at every step; no new user OAuth scope.

## Decisions (brainstormed)

1. **Landing page first** — opening `/join/{token}` never fires an invite;
   the student sees the class identity and explicitly clicks **Join class**.
   (No drive-by invites; a surface for already-enrolled / error states.)
2. **New tab + live status** — after the invite is created we stay on our
   page, open `github.com/orgs/{login}/invitation` in a new tab, and offer
   **Check my enrollment** (re-reads membership live). No reliance on GitHub
   redirecting back.
3. **Enrolled end-state lives on the join page** — "You're enrolled in
   {class}". F9 (student home) later gives it a destination; nothing pulled
   forward.
4. **No regeneration in F4** — link revocation (kill switch) is deferred to
   the class-settings surface. Abuse fallback today: the professor manages
   members/invites directly on GitHub. Schema supports regeneration later
   (one UPDATE + one endpoint + one button; no migration).
5. **Token-as-capability API** (Approach A) — the student flow only ever sees
   the token; class ids stay internal. `classes` routes stay teacher-only;
   new `join` routes are student-facing.

## Token semantics

- `classes.joinToken` — **separate from the class `id` (cuid)**: `id` is
  stable identity (future FK target), `joinToken` is a disposable secret.
- ~128-bit URL-safe random string minted with Web Crypto (no new dependency).
- Minted in `upsertClassByOrgId` at connect time; the **conflict (reinstall)
  branch does not touch it** — a reinstall must not kill the cohort's link.
- Possession of the link is the only enrollment gate (like a GitHub Classroom
  invite URL). It does not authenticate (edu-ID + GitHub link still required)
  and does not grant membership — it only lets the app create a **pending**
  org invitation the student accepts natively on GitHub. Worst-case leak =
  unwanted pending invites, visible and revocable in the org.

## Schema

One column on `classes`:

| column | type | constraints |
|---|---|---|
| `join_token` | text | NOT NULL, UNIQUE |

Migration: drizzle-kit ALTER + a backfill statement
(`UPDATE classes SET join_token = lower(hex(randomblob(16)))` per row) so the
existing row(s) satisfy NOT NULL from day one.

New DB helper: `getClassByJoinToken(db, token)`.

## API

### Teacher side

- `GET /api/classes` response gains `joinToken` per class. No new endpoint —
  the list is already filtered to live org Owners (F5a), so only teachers see
  tokens. The client builds `{origin}/join/{token}`.

### Student side — new `joinRoutes` module

`requireAuth` + linked-GitHub required (invite needs the caller's GitHub
username); **no `isOrgAdmin` check** — that is the point of the flow.

- **`GET /api/join/:token`** — class preview + caller's membership state.
  - Lookup by token; unknown → `404 { error: "invalid_link" }`.
  - Resolve org identity live via the stored `installationId` (login, name,
    avatar).
  - Caller's state via `GET /orgs/{org}/memberships/{username}` (installation
    token): `404` → `none`; else `state` `pending` | `active`.
  - Response: `{ class: { login, name, avatarUrl }, membership: "none" | "pending" | "active" }`.
- **`POST /api/join/:token`** — create the invite.
  - Same lookup/404.
  - Read current membership first. Short-circuits (no PUT): state `active` →
    return `active`; **role `admin` → return `active`** (an org Owner opening
    their own link must never be demoted by
    `PUT .../memberships` with `role: "member"`).
  - Otherwise `PUT /orgs/{org}/memberships/{username}` with `role: "member"`
    → pending invite (GitHub-idempotent on replay) → return `pending`.

A dead installation (App uninstalled) surfaces as `invalid_link` — the class
is effectively disconnected. No reconciliation added here; the classes list
already refreshes `installationId` on teacher reads.

## Frontend

### Teacher — `ClassCard` Copy button (first dummy-seam replacement)

- `joinToken` flows from the classes loader into `ClassCard`.
- Click → `navigator.clipboard.writeText("{origin}/join/{token}")` → label
  swaps to "Copied ✓" for ~2 s (the button is its own feedback; no toast
  dependency).

### Student — `/join/:token` route

`routes/join.tsx` + `pages/join-page.tsx`, wrapped in the existing `Auth`
guard: signed-out → login renders in place, URL preserved; signed-in but
unlinked → GitHub onboarding gate, then back. Hero-style card (same family as
login/confirm). Four states:

1. **Preview** (`membership: none`) — org avatar, name, `@login`, "You've
   been invited to join this class", **Join class** button.
2. **Invited** (after POST, or opening with `pending`) — "Accept your
   invitation on GitHub": button opens
   `github.com/orgs/{login}/invitation` in a **new tab**, plus **Check my
   enrollment** re-fetching state; flips to Enrolled when `active`.
3. **Enrolled** (`active`, incl. owners/already-members on first open) —
   "You're enrolled in {class}". Terminal for F4.
4. **Invalid** — "This join link isn't valid — ask your teacher for a fresh
   one." No org details leak.

## Error handling

- Unknown token → Invalid state (above).
- GitHub failures (rate limit, dead installation, network) → in-page error
  state with retry, mirroring the classes-list containment pattern; the
  route's ErrorBoundary is last resort only.
- Idempotency everywhere: replaying POST while `pending` re-sends the same
  invite; `active`/`admin` short-circuit; opening the link enrolled shows
  Enrolled.

## Testing

- **db:** upsert mints a token; reinstall conflict preserves it;
  `getClassByJoinToken` hit + miss. (Real-D1 pool infra from F3.)
- **api:** invalid token → 404; GET maps GitHub membership to
  `none`/`pending`/`active`; POST invites on `none`; short-circuits on
  `active` and on `admin` (no demotion PUT); join routes usable without org
  admin.
- **www:** join page renders all four states; copy button writes the URL and
  shows feedback.
- **🔴 Human gate (live walk):** copy the real link from the hub → open as
  the second GitHub account (test student) → sign in, link, Join → accept
  natively on GitHub → **Check my enrollment** flips to Enrolled → student
  appears as org Member. 👁 visual gate on the join page states + copy
  interaction.

## Out of scope (deferred)

- Link regeneration / revocation (class settings, later).
- Student home (F9) — the enrolled state's destination.
- People view / member counts (F5b).
- `installation` webhook; silent token refresh (standing deferrals).
