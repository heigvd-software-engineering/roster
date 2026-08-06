# Architecture

roster is a pnpm monorepo that ships as one Cloudflare Worker: it serves the SPA's
static assets and answers `/api/*` on a single origin, over D1. Types reach the
browser from the Drizzle schema by inference, with no generated client.

## Monorepo layout

| Package | Owns |
|---|---|
| `packages/db` | The Drizzle schema for D1, the migrations, `getDb(d1)`, the inferred entity types. Schema only: no query helpers, no tests. |
| `apps/api` | The Worker: Hono route tables, handlers, Better Auth, the GitHub integration layer, the reconcile subsystem. Exports `AppType`. |
| `apps/www` | The React Router SPA. It has no server of its own. |

`apps/www` imports one thing from `apps/api`, the `AppType` type, and never
`packages/db`; `apps/api` imports `packages/db`, which has no build step because its
`exports` names TypeScript source. `AGENTS.md` holds the rules for the type chain and
the routes/handlers/lib split.

## One Worker, one origin

`apps/api/wrangler.jsonc` binds `../www/build/client` as the Worker's assets, with
`not_found_handling: "single-page-application"` and `run_worker_first: ["/api/*"]`.
The Assets layer serves the SPA; anything under `/api/*` reaches Hono first, browser
navigations included, so the OAuth callback lands on Better Auth, not the SPA
fallback. Deploy steps live in [`DEPLOY.md`](../DEPLOY.md), GitHub App setup in
[`GITHUB_APP_SETUP.md`](../GITHUB_APP_SETUP.md).

One origin keeps the session cookie first-party: Better Auth sets a `SameSite=Lax`
cookie on `BETTER_AUTH_URL`, the origin serving the SPA, so no CORS layer, no
third-party cookie, no token in local storage (see [`identity.md`](./identity.md)).
Security headers split the same way: the Worker sets its own on `/api/*`, while the
document's, CSP included, are generated into `build/client/_headers` at build time by
`apps/www/scripts/security-headers.mjs`, because only the build knows the bytes its
`script-src` must hash.

## The API

`apps/api/src/index.ts` is one chain: the two guards on `/api/*`, a `.route()` per
resource module, an `/api/*` 404, then `.onError`. The guards come first, so they wrap
every answer, 404s and 500s included; the catch-all comes last, so it sees only
unclaimed paths. `src/routes/*.ts` holds paths and middleware only; the
implementations sit in `src/handlers/`, built with `createHandlers` from
`src/factory.ts`: `authedFactory` behind `requireAuth`, where `c.get("user")` is
non-null, and `factory` for the session-optional `me`, `setup`, `auth`, `health`. A
bare `async (c) => …` would drop `c`'s inference; `createHandlers` keeps it, lets a
zod validator sit beside its handler, and carries both into `AppType`. Shared rules go
to `src/lib/`, every GitHub call through `src/lib/github/`, and `src/env.ts` alone
types the bindings. The routes themselves are
[`classes-and-assignments.md`](./classes-and-assignments.md) and [`reconcile.md`](./reconcile.md).

`apiSecurityHeaders` runs Hono's `secureHeaders` with `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, and a `default-src 'none'` CSP, then adds
`Cache-Control: no-store` unless the response set one, which Better Auth's OAuth
redirects do. `requireSameOrigin` refuses a POST, PUT, PATCH, or DELETE with 403
`cross_origin` when the browser reports `Sec-Fetch-Site: cross-site` or `Origin`
disagrees with `BETTER_AUTH_URL`; an absent `Origin` passes, since that means a
non-browser caller with no ambient cookie to abuse. It is the second lock behind the
`SameSite=Lax` cookie.

`rateLimit(binding)` limits per IP (`CF-Connecting-IP`), and each route module
declares its own beside the path it protects. `AUTH_LIMITER` (60 a minute) covers
`/api/auth/*`, where Better Auth's own limiter is off, and `/api/join/*`, which
invites people into a GitHub org; `SETUP_LIMITER` (10 a minute) covers the
unauthenticated install callback `/api/github/setup`, which costs several calls of the
App's shared quota. An absent binding means no limit, so `wrangler dev` and the tests
boot without one.

`src/on-error.ts` translates thrown errors. A `GithubUnavailableError` answers 503
`github_unavailable`, so a transient upstream fault never reads as a 404 blaming the
user's link or join token; an `HTTPException` keeps its status; everything else logs
and answers 500 `internal`.

## Type safety without codegen

Handlers write their Drizzle queries inline and return object literals from `c.json`;
`AppType` captures those return types; `apps/www/app/lib/api.ts` builds `hc<AppType>`
and derives what it needs with
`InferResponseType<typeof api.api.classes.$get, 200>`. JSON serialization is part of
the inference, so a `Date` column arrives typed as a string, and a column
rename that changes a response breaks `pnpm typecheck` in `apps/www`. Inputs run in
reverse, as zod schemas declared next to their handler and passed to `zValidator`,
which types `c.req.valid("json")` and rides into `AppType` too. `packages/db` carries
no query-helper layer: the database is already the abstraction.

## The SPA

React Router 8 with `ssr: false` (`apps/www/react-router.config.ts`).
`app/entry.server.tsx` runs once at build time to prerender the `index.html` shell,
never per request, and only `build/client/` ships. `app/routes.ts` is the route table,
`app/routes/` thin glue that gates a screen with `<Auth>`, and `app/pages/` one
component per screen, fetching its own data and taking no props. Tailwind 4 comes
through `@tailwindcss/vite`, tokens in `app/app.css`; shadcn components over Base UI
land in the generated `components/ui/`, ours in `components/custom/`. Reads use
`useApi`, an SWR wrapper keyed on the substituted URL and query; writes use
`useAction`.

In dev, Vite owns `https://localhost:3000` with a dev-only self-signed cert and
proxies `/api` to `wrangler dev` on `:8788`; that origin is the one registered with
SWITCH edu-ID and the GitHub App, so sign-in works nowhere else. In production nothing
proxies: one Worker answers both.

## D1 and migrations

The `DB` binding points at the `roster-db` database, whose tables are the Drizzle
models in `packages/db` ([`data-model.md`](./data-model.md)). `drizzle-kit generate`
writes numbered, descriptively named SQL into `packages/db/migrations` plus an entry
in `meta/_journal.json`; that output gets read and corrected before it ships, since
drizzle-kit mishandles SQLite table rebuilds and never writes a backfill.
`wrangler.jsonc` points `migrations_dir` there, and `wrangler d1 migrations apply
roster-db --local` (or `--remote`) runs them, locally against a SQLite file under
`apps/api/.wrangler/`.

## Tests

`apps/api` runs on `@cloudflare/vitest-pool-workers` against a real local D1:
`vitest.config.ts` reads the migration directory with `readD1Migrations` and
`test/apply-migrations.ts` applies that SQL before each test file, so tests meet the
real schema, foreign keys and unique indexes included. Each test seeds rows with the
Drizzle models the handlers use, mounts a route module in a bare Hono app, and mocks
only the session and the GitHub layer. `apps/www` runs vitest with jsdom and
testing-library over `test/`, resolving `~` to `app/`.
