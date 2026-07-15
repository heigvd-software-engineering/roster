# Hybrid identity: name + GitHub everywhere, affiliations on demand, private email nowhere

**Date:** 2026-07-15
**Status:** approved (brainstorm with Stefan)

## Problem

The SWITCH edu-ID login email (`user.email`) is generally a **private**
email. Today it leaks two ways:

1. **API payload:** `linkedUsers` (apps/api/src/lib/access.ts) selects the
   FULL user row — email included — and its rows ride on `/api/classes`
   and the lab-groups responses. Any student can read classmates' and
   teachers' private emails in devtools, whether or not the UI shows them.
2. **UI:** PeopleChip renders `user.email` as the identity subtitle in the
   class card's people popovers.

Teachers manage work through their **professional** emails — which SWITCH
provides as the affiliation list in the id_token (already decoded for the
caller by `readAffiliationEmails` in apps/api/src/lib/switch/claims.ts,
surfaced only on `/api/me`).

## Decision (from brainstorm)

- **The private email is not needed anywhere, feature-wise.** It stays
  only on `/api/me` (the caller sees their own). It leaves every shared
  payload and every UI surface.
- **Identity is hybrid everywhere:** SWITCH first/last name + GitHub
  `@login`. That is already `personIdentity`'s output — the change is to
  stop showing the email where it still appears.
- **Affiliation emails replace it, on demand:** a chevron on the identity
  component opens a floating overflow-style menu (popover) listing the
  person's affiliation (professional) emails — the row itself never grows.
  The GitHub login stays visible on the identity at all times. Visible to
  **everyone in the class** — teachers see students' institutional emails,
  students see teachers'. One rule, no role filtering. *(Amended
  2026-07-15: was an inline expansion; changed to a floating menu +
  always-visible login after seeing it live.)*
- **This applies to every identity display in the app**, not just
  PeopleChip — group member rows (teacher drawer, student tiles),
  add-from-pool, unassigned pool, and future surfaces. Avatar-only spots
  (AvatarCluster) stay avatars.

## Design

### API

- `linkedUsers` stops selecting the full user row. Explicit safe shape:
  `{ githubId, user: { firstName, lastName, name, affiliations } }`.
  - `affiliations: string[]` is decoded per user from the stored SWITCH
    `account.idToken` with the existing `readAffiliationEmails` — **no new
    storage, no migration**; as fresh as that user's last SWITCH sign-in.
    (JWT decode is a base64 parse; N-per-response is cheap. Revisit a
    stored column only if profiling ever says otherwise.)
  - `email` is gone from every response except `/api/me`.

### Frontend

- `PersonIdentity` (apps/www/app/lib/identity.ts) gains
  `emails: string[]` (empty when unlinked or none). `personIdentity`
  fills it from the linked user's `affiliations`.
- `UserIdentity` gains optional `emails?: string[]`: when non-empty, a
  small chevron after the text block opens a Popover listing the emails.
  No emails → no chevron, row unchanged.
- Call sites pass what `personIdentity` gives them; they make no
  visibility decisions.
- **PeopleChip:** the Switch-identity cell drops the email subtitle and
  shows name + `@login` + the chevron (the GitHub column keeps the
  clickable profile link and the pending badge).
- **Own menu** (`main-switch-identity`): untouched — it may keep showing
  the caller their own private email and affiliations from `/api/me`.

### Accepted trade

A person with no SWITCH link (or no affiliations in their id_token) shows
as name/login only, with no email anywhere — including to teachers. That
is intended: private emails are never shown.

### Testing

- API: `linkedUsers` shape test — no `email` key in shared responses;
  affiliations decoded from a fixture id_token.
- www: UserIdentity chevron renders only with emails and expands them;
  PeopleChip shows no email and expands affiliations; a roster row test
  for the same via `personIdentity`.
