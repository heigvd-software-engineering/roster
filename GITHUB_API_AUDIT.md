# GitHub API call audit — per surface

State: branch `milestone-6-performance` (2026-07-10), after the lab-page merges
(one request carries lab + class + role + membership state, on BOTH lab pages),
the cached-login change in `resolveClassAccess`, and the `classes.login` read
(task 2) in both resolvers.

## How to read the numbers

- **API request** = browser → Worker. **GitHub calls** = Worker → api.github.com
  while handling it. One request usually fans out into several calls.
- Counts are the **warm-isolate hot path**. A cold isolate adds ONE
  `POST /app/installations/{id}/access_tokens` (cached ~55 min per isolate,
  `lib/github/clients.ts`). Occasional extras, not counted per row:
  - `resolveClassAccess` fallback: `GET /user` when the caller has no
    `class_members` row for the class yet, or their cached login went stale
    (rename) — one retry, then back to the hot path.
  - Both resolvers: a live `GET /app/installations/{id}` when `classes.login`
    is unfilled (legacy row) or proven stale (org renamed) — one retry.
  - Better-auth may refresh an expired OAuth token (`github.com/login/oauth`,
    not api.github.com).
- **SWR revalidates on every mount and window focus** (defaults; no
  `SWRConfiguration` overrides anywhere). A “cache hit” paints instantly but
  still fires the request — so every count below is paid on every visit,
  every alt-tab back, and after every mutation (`useAction` revalidates).

## Shared authorization building blocks

| Resolver | GitHub calls | Breakdown | Notes |
|---|---|---|---|
| `resolveClassAccess` (caller acts as themselves) | 1 | `GET /orgs/{org}/memberships/{login}` (live state/role) | Caller login from `class_members`, org login from `classes.login` (both DB). The one remaining call IS the authorization. |
| `resolveClassAsTeacher` (teacher-only routes) | 1 | `GET /orgs/{org}/members?role=admin` (live Owner check) | Org login from `classes.login`. No user-token dependence by design. |
| Membership / admin checks themselves | — | — | Deliberately never cached (`access.ts`): authorization is always live GitHub state. **Necessary.** |

---

## App shell (every page)

The auth gate fetches `/api/me` on boot, and again on focus/revalidation.

| Trigger | API request | GitHub calls | What for | Necessary? |
|---|---|---|---|---|
| App boot / auth gate | `GET /api/me` | 1 | `GET /user` — is the GitHub link alive, and who is it (profile for the header, tri-state `githubState` for the outage banner) | **Yes** — this is the one place that owns “is the link usable”, and it must be live to tell `unlinked` from `unknown` (outage). |

## Classes hub (`/classes`)

| Trigger | API request | GitHub calls | What for | Necessary? |
|---|---|---|---|---|
| Page load | `GET /api/classes` | 2 | `GET /user/installations` + `GET /user/memberships/orgs` — the caller’s live reach, intersected for the Owner check; fixed cost however many classes | **Yes** for the teacher side (live Owner check, already optimal: 2 calls replace 2+N). The **enrolled** side is a pure DB read riding along for free. |
| “Load more” (older semesters) | `GET /api/classes?from=` | 2 | Same two bulk calls again | **Partly** — the live reach was just established; a shared SWR key or short dedupe window could make paging DB-only. Low stakes. |

## Teacher lab page (`/classes/:id/labs/:labId/manage`)

One request since the merge — the response carries lab + class identity + role.

| Trigger | API request | GitHub calls | What for | Necessary? |
|---|---|---|---|---|
| Page load | `GET …/labs/:labId/groups` | 2 | `resolveClassAccess` (1) + `GET /orgs/{org}/repos` (push activity for the status chips, 1 page per 100 repos; skipped when no group has a repo) | Auth: yes. Repo listing: **acceptable** — one call regardless of group count, degrades gracefully, quota is a non-issue. Webhook-fed `lastPushAt` would make it 0 but is a real project. |
| Every mutation (below) revalidates | same | 2 | — | Comes with SWR; the price of fresh chips after each action. |

## Student lab page (`/classes/:id/labs/:labId`)

Same merged request as the teacher page. A PENDING invitee resolves too
(`allowPending`): they get the header data + an empty roster + the live
membership state, never a 404 — the accept-invitation prompt is now live
GitHub truth instead of the display cache.

| Trigger | API request | GitHub calls | What for | Necessary? |
|---|---|---|---|---|
| Page load (active member) | `GET …/labs/:labId/groups` | 2 | Same as teacher page | Same as teacher page. |
| Page load (pending invitee) | `GET …/labs/:labId/groups` | 1 | `resolveClassAccess` only — the pending branch returns before the repo listing | **Yes** — “invited but not yet accepted” must be live to unlock on refocus. |

## Group actions (both lab pages)

All go through `resolveClassAccess` (1), then GitHub is the system of record
for the team, then ONE roster re-read mirrors it into the `group_members`
cache.

| Action | API request | GitHub calls | Breakdown | Necessary? |
|---|---|---|---|---|
| Join group | `PUT …/groups/:gid/membership` | 3 | auth 1 + team add 1 + roster sync 1 | **Yes** — the team is the source of truth; the sync is what keeps reads at 0 calls. |
| Leave group | `DELETE …/membership` | 3 | auth 1 + team remove 1 + sync 1 | Same. |
| Add member (teacher) | `PUT …/members/:login` | 3 | auth 1 + add 1 + sync 1 | Same. |
| Remove member (teacher) | `DELETE …/members/:login` | 3 | auth 1 + remove 1 + sync 1 | Same. |
| Delete group (teacher) | `DELETE …/groups/:gid` | 2 | auth 1 + team delete 1 | **Yes.** |
| Create group | `POST …/labs/:labId/groups` | 3 + seeds | auth 1 + create team 1 + 1 per seeded member (auto-join / copy-forward) + sync 1 | **Yes** — writes are inherently per-member on GitHub’s API. |
| Create repo (one group) | `POST …/groups/:gid/repo` | 4 | auth 1 + LIVE roster 1 (gates an irreversible create) + create/generate 1 + team grant 1 | **Yes** — the live roster here is authorization-adjacent (min-size gate), correctly not the cache. |
| Create missing repos (batch) | `POST …/labs/:labId/repos` | 1 + 3/group | auth 1 + per group: roster 1, create 1, grant 1 (sequential on purpose — abuse limits) | **Yes** — already the batched form of N create+refetch round-trips. |
| Accept individual lab | `POST …/labs/:labId/accept` | 4–6 | auth 1 + find-or-create solo team (0–3) + roster check 1 + repo create 1 + grant 1 | **Yes** — one click deliberately does group+repo. |

## New-group dialog (both roles)

| Trigger | API request | GitHub calls | What for | Necessary? |
|---|---|---|---|---|
| Dialog opened (only while open — mounted on demand) | `GET …/labs/:labId/reusable` | 1 | `resolveClassAccess` only; rosters come from the `group_members` cache | **Yes/optimal** — the data itself is already 0 calls; only the authorization remains. |

## Lab dialog (teacher: create / edit lab)

| Trigger | API request | GitHub calls | What for | Necessary? |
|---|---|---|---|---|
| Dialog opened | `GET /api/classes/:id/templates` | 2 | `resolveClassAsTeacher` (1) + `GET /orgs/{org}/repos` template listing (1) | **Yes** — template choices must be current; fetched only while the dialog is open. |
| Save (create or edit) | `POST/PUT …/labs` | 1 | `resolveClassAsTeacher` only — the lab row is pure DB | **Yes.** |

## Join flow (`/join/:token`)

Every step re-resolves the token: profile + org login, then live membership.
These are student-onboarding paths — cold by nature, no caches exist yet, so
the profile fetch here is legitimate (it’s often the first contact).

| Trigger | API request | GitHub calls | Breakdown | Necessary? |
|---|---|---|---|---|
| Landing (preview) | `GET /api/join/:token` | 4 | `GET /user` 1 + org login 1 + `GET /orgs/{org}` (name/avatar) 1 + membership 1 | **Yes** — the preview must be live and the caller may be unknown to every cache. |
| “Join” click | `POST /api/join/:token` | 3–4 | profile 1 + org login 1 + membership 1 + invite 1 (skipped if already member/invited) | **Yes** — idempotent invite requires knowing current state. |
| Confirm (records observation) | `POST /api/join/:token/confirm` | 3 | profile 1 + org login 1 + membership 1 | **Yes** — re-reads live rather than trusting the client. |

## Class confirm page (`/classes/:id/confirm`)

| Trigger | API request | GitHub calls | Breakdown | Necessary? |
|---|---|---|---|---|
| Page load | `GET /api/classes` | 2 | Hub data reused for the class name | **Won’t fix** — a teacher-authorized DB read would cost 1, but the page runs once per class ever; a new endpoint would never pay for itself. Revisit only if a class-detail page ever exists to ride on. |
| Confirm click | `POST /api/classes/:id/confirm` | 3 | auth 1 + `PATCH /orgs/{org}` (base permission → none) 1 + `GET /orgs/{org}` verify 1 | **Yes** — a security-relevant write plus its read-back verification. |

## Reconcile page (`/classes/:id/reconcile`)

Deliberately call-heavy: its purpose is to compare EVERYTHING against live
GitHub. Numbers scale with what the reconcilers inspect (lazy `once()` context).

| Trigger | API request | GitHub calls | Breakdown | Necessary? |
|---|---|---|---|---|
| Page load (audit) | `GET /api/classes/:id/audit` | ~8 + 1/group | `GET /user/installations` 1 + `isOrgAdmin` 1 (stale-pointer-safe auth — deliberately NOT the cached org login, this page repairs the caches) + org info 1 + people 3 (admins/members/invitations) + base permission 1 + org repos 1 + one team-roster read per group | **Yes** — drift detection IS the live comparison. Only runs when a teacher opens the page. |
| Page load | `GET /api/classes` | 2 | Class name for the header | **Partly** — same pattern as above. |
| Apply findings | `POST /api/classes/:id/reconcile` | 2 + per finding | auth 2 + whatever each accepted repair writes | **Yes** — repairs are writes. |

## GitHub App setup callback (`/api/setup`)

| Trigger | API request | GitHub calls | Breakdown | Necessary? |
|---|---|---|---|---|
| Install/reinstall redirect from GitHub | `GET /api/setup?installation_id=` | 2–3 | `GET /app/installations/{id}` (App JWT names the org — the anti-spoof) 1 + `GET /orgs/{org}` (identity cache seed) 1 + `GET /user/installations` (CREATE only: caller really holds the installation) 1 | **Yes** — each call carries a distinct trust decision; runs once per (re)install. |

---

## Summary of the reduction work

| Change | Effect | Status |
|---|---|---|
| Teacher lab page: one merged request (lab + class + role on the groups response) | −1 request, −2 GitHub calls per visit | ✅ done |
| Student lab page: same merge, pending invitees resolved live (`allowPending`) | −1 request, −2 GitHub calls per visit; pending state is live truth | ✅ done |
| `resolveClassAccess`: caller login from `class_members`, live re-fetch only on miss/rename | −1 call on EVERY class-scoped request; student hot path no longer needs a live OAuth token | ✅ done |
| Org login from `classes.login` in both resolvers (rename-safe retry) | −1 call on every `resolveClassAccess` / `resolveClassAsTeacher` request | ✅ done |
| Webhook-fed `lastPushAt` (drop the org-repos listing) | −1 call on lab-page reads; scales past 100 repos | 💤 deferred — not worth it at current scale |
| Confirm page: single-class DB read instead of `GET /api/classes` | −1 call, once per class ever | ❌ won’t fix — visit count makes it noise |
| Membership/admin checks stay live, never cached | 1 call per request, by design | 🔒 keep |

Lab page trajectory: **6 → 2** GitHub calls per visit (teacher and active
student alike); every class-scoped mutation dropped by 1 as well.
