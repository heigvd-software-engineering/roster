# Identity

Two systems answer two different questions. SWITCH edu-ID says who a person is. GitHub says what they may do. Nothing in the database decides either.

## The split

A roster user (`user.id`) is created by Better Auth the first time someone signs in with edu-ID. Two provider rows can hang off it in `account`: `switch` (always, sign-in creates it) and `github` (once the user links). `apps/api/src/lib/identity.ts` is the only module that translates between them, and its header states the rule it lives by: it answers "who is this" and "what may we say about them", never "may they do this".

The edu-ID registration uses the HES-SO academic-login audience, so the `email` claim is the person's professional address. That is why `user.email` can be shown to other members of a class (`profilesByGithubId` in `identity.ts`) and why it can carry privilege (see super admins below). `mapProfileToUser` stores `given_name`/`family_name` as `firstName`/`lastName`, and `overrideUserInfo: true` re-applies the profile at every sign-in, so a name change at SWITCH propagates on the next login.

GitHub is the execution surface: orgs, teams and repos are the only things that actually hold access, and every org, team and repo call speaks GitHub account ids. `githubIdsForUser` returns the linked `account.accountId` in both shapes callers need, `ghId` as a number and `githubId` as the string stored on member rows, and returns `null` when the column is not numeric (it is TEXT, shared with providers whose ids are not numbers), which is as good as unlinked.

## Better Auth configuration

`apps/api/src/lib/auth/config.ts` builds the instance per request from the Worker env. The settings that carry security weight:

| Setting | Value | What it buys |
|---|---|---|
| `socialProviders.github.disableSignUp` | `true` | A GitHub sign-in may not mint a user whose email GitHub attests instead of SWITCH. It refuses the create and nothing more. |
| `accountLinking.disableImplicitLinking` | `true` | Better Auth otherwise matches an incoming OAuth profile to an existing user by email and links it unasked. With `github` trusted, only the local `emailVerified` flag stands in the way, and SWITCH sets it, so a GitHub account holding a verified copy of someone's edu-ID address would link to their user and sign in as them. |
| `accountLinking.trustedProviders` | `["github"]` | Required for `linkSocial` to accept GitHub at all; without it Better Auth refuses the link as an untrusted provider. |
| `accountLinking.allowDifferentEmails` | `true` | The edu-ID address and the GitHub address routinely differ, and the link targets the session user, not an email match. |
| `session.freshAge` | `0` | Better Auth gates `unlink-account`, `delete-user` and `list-sessions` behind a session younger than 24h and answers `SESSION_NOT_FRESH` otherwise. Unlinking GitHub to link a different account is a normal correction, no password exists to protect, and a re-auth through SWITCH proves nothing extra. A valid session is still required. |
| `rateLimit.enabled` | `false` | Better Auth's limiter counts in memory per isolate, which on Workers is no ceiling at all. The Cloudflare rate-limiter binding in `apps/api/src/routes/auth.ts` is the real one. See [architecture](./architecture.md). |

The edu-ID provider is registered through `genericOAuth` with OIDC discovery against `EDUID_ISSUER`, PKCE on (SWITCH advertises S256 only), and scopes `openid profile email https://eduid.ch/scope/userinfo.read`. `authorizationUrlParams.claims` asks for the four identity claims in the `id_token` as well as at `userinfo`, which is the endpoint Better Auth actually reads.

`apps/api/better-auth.config.ts` exists only so `@better-auth/cli generate` can read the options; its placeholder secrets never reach a runtime.

## The sign-in guard

`apps/api/src/lib/auth/sign-in-guard.ts` sits in `hooks.before`, the one slot that sees Better Auth's whole route table, and refuses everything under `/sign-in/` except `/sign-in/oauth2` with a 403 carrying `EDU_ID_IS_THE_ONLY_SIGN_IN`.

It is written as an allowlist on purpose. What it protects is the claim "sign-in is edu-ID only", not one provider's name: Better Auth ships `/sign-in/email`, `/sign-in/magic-link`, `/sign-in/username` and more behind plugins, and a denylist would open a second door the day someone enables one, with no test able to notice. `apps/api/test/sign-in-guard.test.ts` pins exactly that, asserting the unshipped routes are refused too.

The GitHub sign-in path needs closing because `disableSignUp` does not close it. Configuring `socialProviders.github` is what makes `authClient.linkSocial` work, and it also registers a public `POST /api/auth/sign-in/social` for that provider. For anyone past onboarding, that callback finds their account by `(providerId, accountId)`, takes the linked-account branch, and mints a full session with SWITCH never involved. A borrowed GitHub account would become a roster session as its owner, teacher or super admin included.

Linking is untouched: `linkSocial` posts to `/link-social`, and its callback returns from the `link` branch before any sign-in machinery runs. `/get-session`, `/sign-out` and `/callback/github` pass through.

## Linking GitHub

`linkGithub` in `apps/www/app/contexts/auth-context.tsx` calls `authClient.linkSocial({ provider: "github" })`, with an `errorCallbackURL` back to `/onboarding/github?error=link_failed` so a refused link (a brand-new GitHub account with no verified email, for instance) lands on a retry page rather than Better Auth's raw error page. `unlinkGithub` calls `unlinkAccount` and revalidates.

Two different signals drive the onboarding gate, and they are not interchangeable:

- `githubLinked` on the session (`apps/api/src/lib/auth/session-payload.ts`) is row existence: true once an `account` row with `providerId: "github"` exists. `apps/www/app/routes/onboarding.tsx` uses it to bounce an already-linked user away from the onboarding page.
- `githubState` on `/api/me` (`apps/api/src/handlers/me.ts`) is liveness, one of `linked`, `unlinked`, `unknown`. The route guard in `apps/www/app/components/custom/shell/auth.tsx` redirects to onboarding only on `unlinked`, which means a proven-dead token: no token at all, or GitHub answering 401. A `GithubUnavailableError` becomes `unknown` and the guard fails open with a warning strip, because re-linking during a GitHub outage would fail too.

## The GitHub token

`githubAccessToken(env, userId)` in `apps/api/src/lib/auth/github-token.ts` wraps `auth.api.getAccessToken` and returns `string | null`. GitHub App user tokens expire after eight hours; Better Auth refreshes an expired one from the stored refresh token and persists the new pair, so the next caller reuses it instead of refreshing again. `apps/api/test/github-token.test.ts` exercises the real refresh path against real D1 and asserts the persistence.

`null` means nothing usable: no linked account, or a refresh GitHub rejected (revoked grant, expired refresh token). Every caller reads that as "not linked" and routes the user to link again. Tokens live in the Better Auth `account` row and never leave the server.

## Session reads

`customSession` wraps every session read in `buildSessionPayload`, which returns `{ user, session, githubLinked }` and runs two independent queries in one round trip. `user` and `session` pass through untouched, because the SPA infers the session type from this return through `customSessionClient<Auth>` and anything narrowed here disappears from every client.

The other half is `healAcceptedInvitations` (`apps/api/src/lib/auth/accepted-invitation-heal.ts`), which repairs the caller's own stale invitation rows. Both teacher and student invitations reach the same dead end: something cached a row saying "invited" (`inviteTeacher` sending an Owner invite, or the join flow observing a pending membership), the person accepted on GitHub, and GitHub tells the app nothing. Someone showing up is the closest signal to "they accepted", which is why a session read is the trigger rather than sign-in alone: a teacher already signed in when they accept would otherwise stay listed as invited until their next login.

The cached row proposes; live GitHub authorizes. `userOrgMemberships` decides the outcome, `admin` becoming `teacher` and anything else `active`, and a membership still `pending` heals nothing. The heal drops the invitation placeholder through `forgetMember`, then records the real membership through `observeMember`, carrying the avatar over rather than blanking it (a nulled avatar would read as a change to [reconcile](./reconcile.md) after every accepted invitation).

Two properties make it affordable on a hot path. The indexed `class_members` lookup runs first, so a read with nothing outstanding costs one query and no network. And it touches only the caller's rows; everyone else stays reconcile's job. It never throws: a failed heal must not cost anyone their session, and the stale row is exactly what reconcile already repairs.

## Roles

There are no role columns. A teacher is a live Owner (`role: "admin"`, `state: "active"`) of the class's GitHub organization; a student is a live active Member. The words are pinned in [nomenclature](./nomenclature.md). `apps/api/src/lib/class-scope.ts` is the one place that asks, and both of its entry points deny with `null` so routes answer 404 rather than confirming a class exists to an outsider.

- `resolveClassAsMember` asks `orgMembership` through the installation token for the caller's login. `isTeacher` is true only for an active admin; a pending Owner invite is not one.
- `resolveClassAsTeacher` asks `isOrgAdmin` for the caller's stored account id and never touches their OAuth token, so a teacher whose GitHub link has expired can still run the class and loses only the routes that act as them.

The caches (`classes.login`, `class_members.login`, `group_members`) only propose names to ask about. A membership miss re-derives whatever came from a cache and retries once before believing it. No cache ever authorizes: `ClassTeam.roster` is documented as the live read to use wherever the answer gates an irreversible write, with the cache reserved for display. See [data model](./data-model.md) for the tables and [classes and assignments](./classes-and-assignments.md) for what the roles unlock.

`profilesByGithubId` defines the one shape a person's roster user may take when leaving the server for other class members: `firstName`, `lastName`, `name`, `email`. `personIdentity` in `apps/www/app/lib/identity.ts` renders the three states it produces, and states the unlinked ones in words rather than leaving a teacher to infer them: edu-ID plus GitHub shows the SWITCH name and `@login`, GitHub alone shows the login as the name with "not linked to edu-ID", edu-ID alone shows the name with "GitHub not linked yet".

## Super admins and class creation

Super admins are configuration, never data. `isSuperAdmin(env, email)` in `apps/api/src/lib/auth/super-admin.ts` tests `user.email` against `SUPER_ADMIN_EMAILS`, a comma-separated public var in `apps/api/wrangler.jsonc`, matched case-insensitively and tolerant of whitespace. Keeping the list in config also solves the bootstrap problem: the first admin is added by editing a var and redeploying, and super admin is never grantable from the app.

The toggle gates exactly one thing: `/api/admin/*`, through `requireSuperAdmin`, which answers 401 without a session and 403 without a match. That zone lists every user and flips `class_creators` rows (`apps/api/src/handlers/admin.ts`). The account-menu link and the hidden "New class" button are convenience; the API is the boundary.

Being a super admin grants no class creation. `userCanCreateClasses` checks for a `class_creators` row and nothing else, one condition for everyone, and admins flip their own toggle like anyone else. The check reads `row != null` rather than `!== undefined` on purpose: if the ORM's "no row" answer ever became `null`, strict-undefined would fail open and make every user a creator. `apps/api/test/super-admin.test.ts` pins both answers.

The whole arrangement fails closed. An unset `SUPER_ADMIN_EMAILS` means no admins, so nobody can grant, and with an empty `class_creators` table nobody can create a class; every deployment must set the var (see `DEPLOY.md`). The enforcement point is the GitHub App setup callback (`apps/api/src/handlers/setup.ts`): a callback that would create a new class row without a grant redirects to `/?error=not_class_creator` and no class is born. The repair path for an existing class returns before that line, so reconnecting an installation stays open to anyone. App creation and its permissions are in [DEPLOY.md](../DEPLOY.md), phase 3.

`/api/me` carries `isSuperAdmin` and `canCreateClasses` on the boot fetch for display only; the setup callback and `/api/admin` both re-check server-side.

## Affiliations

Nothing reads SWITCH affiliations. The registration no longer requests the `swissEduID*` claims and the deprecated `<issuer>/authz/User.Read` scope went with them. Because the audience is HES-SO academic login, `user.email` is already the professional address, so the one thing affiliations were used for is now a plain column. `account.idToken` exists in the schema and no code decodes it.
