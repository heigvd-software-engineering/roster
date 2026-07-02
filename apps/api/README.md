# @labs/api

The Cloudflare Worker (Hono) for `labs`. Serves `/api/*` and — via Cloudflare
Assets with `run_worker_first: ["/api/*"]` — the `@labs/www` SPA on the same
origin.

- **Auth:** Better Auth (SWITCH edu-ID OIDC) — `src/auth.ts`.
- **Routes:** one module per resource in `src/routes/`, composed in
  `src/index.ts` with `.route()` (which also composes the `AppType` used by the
  frontend's typed `hc<AppType>` client).
- **DB:** Drizzle over D1 (`@labs/db`).

## Scripts

```txt
pnpm --filter @labs/api dev          # wrangler dev (HTTPS on :3000)
pnpm --filter @labs/api typecheck
pnpm --filter @labs/api test
pnpm --filter @labs/api build        # wrangler deploy --dry-run
pnpm --filter @labs/api cf-typegen   # regenerate worker-configuration.d.ts
```

## Config & secrets

- Public config (`BETTER_AUTH_URL`, `EDUID_ISSUER`) → `wrangler.jsonc` `vars`.
- Secrets (`EDUID_CLIENT_ID/SECRET`, `BETTER_AUTH_SECRET`) → `.dev.vars`
  (git-ignored) locally, `wrangler secret` in production.
- `database_id` in `wrangler.jsonc` is a local-dev placeholder — set the real
  one from `wrangler d1 create labs` before deploying.

The Worker env is typed as `Env` (`src/auth.ts`): `new Hono<Env>()` → `c.env`
is the D1 binding + config/secrets.
