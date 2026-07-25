# @roster/api

The Cloudflare Worker (Hono) for `roster`. Serves `/api/*` and — via Cloudflare
Assets with `run_worker_first: ["/api/*"]` — the `@roster/www` SPA on the same
origin.

- **Auth:** Better Auth (SWITCH edu-ID OIDC) — `src/lib/auth/config.ts`.
- **Routes:** one module per resource in `src/routes/`, composed in
  `src/index.ts` with `.route()` (which also composes the `AppType` used by the
  frontend's typed `hc<AppType>` client).
- **DB:** Drizzle over D1 (`@roster/db`).

## Scripts

```txt
pnpm --filter @roster/api dev            # wrangler dev (HTTP on :8788)
pnpm --filter @roster/api preview        # wrangler dev (HTTPS on :3000)
pnpm --filter @roster/api typecheck
pnpm --filter @roster/api test
pnpm --filter @roster/api build          # wrangler deploy --dry-run
pnpm --filter @roster/api run deploy        # build the SPA first, then deploy
pnpm --filter @roster/api run auth:schema   # regenerate the Better Auth schema
pnpm --filter @roster/api cf-typegen     # regenerate worker-configuration.d.ts
```

`worker-configuration.d.ts` supplies the Worker runtime globals (`D1Database`
and friends) — it is generated from `wrangler.jsonc`, so rerun `cf-typegen`
whenever that file changes.

In dev the SPA is served by Vite on `https://localhost:3000` (the only origin
where sign-in works) and proxies `/api` to this Worker on `:8788`. `preview`
is the other shape: this Worker serving the built SPA on `:3000`, no proxy.

## Config & secrets

There is ONE environment — the top-level config in `wrangler.jsonc`, deployed
to `roster.y-software.ch`. No `--env` flag. `wrangler dev` runs the same config
locally and reads `.dev.vars` (which overrides the two dev-only vars).

- Public config (`BETTER_AUTH_URL`, `EDUID_ISSUER`, `GITHUB_APP_SLUG`) →
  top-level `vars`. Local dev overrides `BETTER_AUTH_URL` + `GITHUB_APP_SLUG`
  in `.dev.vars`.
- The seven secrets (`BETTER_AUTH_SECRET`, `EDUID_CLIENT_ID/SECRET`,
  `GITHUB_CLIENT_ID/SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`) →
  `.dev.vars` (git-ignored; start from `.dev.vars.example`) locally,
  `wrangler secret put …` when deployed. Never in `wrangler.jsonc`.
- The `database_id` (`roster-db`) is an all-zeros placeholder until you create
  the D1 and paste its id (miniflare ignores it locally) — see `DEPLOY.md`.

The Worker env is typed as `Env` (`src/lib/auth/config.ts`): `new Hono<Env>()`
→ `c.env` is the D1 binding + config/secrets.
