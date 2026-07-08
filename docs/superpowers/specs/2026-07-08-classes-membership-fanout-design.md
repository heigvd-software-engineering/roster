# Collapsing `GET /classes`'s per-class Owner check

**Status:** proposed, blocked on one empirical check.
**Date:** 2026-07-08.
**Owner question:** does a GitHub App *user-to-server* token reach
`GET /user/memberships/orgs`?

## The cost today

`listClasses` (`apps/api/src/handlers/classes.ts`) spends `2 + N` GitHub calls,
where `N` is the number of candidate classes:

| Call | Token | Why |
| --- | --- | --- |
| `GET /user/installations` | user | which orgs the caller can reach |
| `GET /user` (`fetchGithubProfile`) | user | the caller's login — needed only as an argument to the next call |
| `GET /orgs/{org}/memberships/{login}` × N | installation | **is the caller a live org Owner of this class** |

The third is authorization. It cannot be cached: `class_members` may never
authorize (data-model spec §0), and a cached `teacher` row is a display fact,
not a role. So the goal is to ask the same question in fewer calls, never to
stop asking it.

## The proposal

`GET /user/memberships/orgs`, with the caller's **user** token, returns every org
that user belongs to — each with `role` (`admin` | `member` | `billing_manager`)
and `state` (`active` | `pending`) — 100 per page.

Intersect that with the `/user/installations` map (already fetched, keyed by org
id) and every class's Owner question is answered at once:

```
GET /user/installations   → Map<orgId, {installationId, login, avatarUrl}>
GET /user/memberships/orgs → Map<orgLogin, {role, state}>
```

`2 + N → 2`. The `fetchGithubProfile` call also disappears: the endpoint is
implicitly scoped to the token's user, so we never need the login to ask about
ourselves.

A class is the caller's iff:

- its `orgId` is in the installations map (the App can still reach the org), **and**
- its org login maps to `{ role: "admin", state: "active" }`.

`state: "pending"` is not an Owner yet — an invited Owner who hasn't accepted
must not see the class.

Authorization stays LIVE. This swaps one live shape for another; it introduces
no cache and no new trust in `class_members`.

## The blocker

A GitHub App user-to-server token carries **no OAuth scopes**. Its reach is
defined by the App's declared account permissions, and only a subset of
`/user/*` endpoints is enabled for GitHub Apps. This endpoint has historically
wanted `read:org`, an OAuth-app scope such a token cannot hold.

The REST docs page for it states neither a "works with GitHub Apps" note nor a
fine-grained permission. **Absence of a statement is not a yes.** Verify before
building:

```bash
# the caller's stored GitHub user token
cd apps/api && pnpm exec wrangler d1 execute DB --local \
  --command "SELECT access_token FROM account WHERE provider_id='github' LIMIT 1;"

curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer <token>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user/memberships/orgs
```

- `200` → build it.
- `403` / `404` → the endpoint is closed to us. Abandon; `listClasses` stays
  `2 + N`, and this document is the record of why.

If it returns `200`, also confirm the body actually carries `role` for an org
where the caller is an Owner — a `200` with a role we can't read is no better
than a `403`.

## If it works

1. `apps/api/src/lib/github/user.ts`: add
   `userOrgMemberships(token): Promise<Map<string, { role: string; state: string }>>`,
   keyed by `organization.login` (lowercased — GitHub logins are
   case-insensitive, cf. `isSameRepo`). Paginate.
2. `listClasses`: fetch it alongside `/user/installations` (`Promise.all` — they
   are independent). Drop `fetchGithubProfile` and the per-class `orgMembership`
   loop.
3. Keep the existing per-class `try/catch`: an org can still rate-limit or vanish
   between the two calls. A class we cannot decide about is skipped, never shown.
4. `apps/api/test/classes.test.ts`: assert the Owner gate still holds —
   `role: "member"` and `state: "pending"` must both mean "no class", and a class
   whose org is absent from the installations map must be skipped even when the
   caller is its Owner.

## Non-goals

- Caching the answer. The teacher check is live, always.
- Touching `resolveClassAccess` / `resolveClassAsTeacher`. They authorize a
  SINGLE class; one call each is already minimal.
- `orgRepoActivity` and `orgTemplateRepos` — genuinely live facts, nothing to
  collapse.

## Related

- The three surviving live `team.roster` reads in `handlers/lab-groups.ts` are
  deliberate: their answers authorize or gate an irreversible repo create. See
  `lib/access.ts`'s `ClassTeam` docstring.
- `fetchGithubProfile` returns `null` on ANY non-OK response, so a GitHub 5xx or
  rate-limit currently reads as "not linked" in `/api/me`, "invalid" in
  `handlers/join.ts`, and "not found" in `resolveClassAccess`. Independent bug;
  fixing it is a prerequisite for trusting any of these call-count changes under
  load.
