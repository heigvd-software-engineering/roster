# @labs/api

The Cloudflare Worker (Hono) for `labs`. Serves `/api/*` and — via Cloudflare
Assets with `run_worker_first: ["/api/*"]` — the `@labs/www` SPA on the same
origin.

- **Auth:** Better Auth (SWITCH edu-ID OIDC) — `src/lib/auth/config.ts`.
- **Routes:** one module per resource in `src/routes/`, composed in
  `src/index.ts` with `.route()` (which also composes the `AppType` used by the
  frontend's typed `hc<AppType>` client).
- **DB:** Drizzle over D1 (`@labs/db`).

## Scripts

```txt
pnpm --filter @labs/api dev            # wrangler dev --env dev (HTTP on :8788)
pnpm --filter @labs/api preview        # wrangler dev --env dev (HTTPS on :3000)
pnpm --filter @labs/api typecheck
pnpm --filter @labs/api test
pnpm --filter @labs/api build          # wrangler deploy --dry-run
pnpm --filter @labs/api run deploy:demo   # deploy the demo env (or deploy:prod)
pnpm --filter @labs/api run auth:schema   # regenerate the Better Auth schema
pnpm --filter @labs/api cf-typegen     # regenerate worker-configuration.d.ts
```

In dev the SPA is served by Vite on `https://localhost:3000` (the only origin
where sign-in works) and proxies `/api` to this Worker on `:8788`. `preview`
is the other shape: this Worker serving the built SPA on `:3000`, no proxy.

## Config & secrets

Everything environment-specific lives in a `wrangler.jsonc` `env` block —
`dev`, `demo`, `prod` — because Wrangler does not inherit `vars` or
`d1_databases` into environments. Any `wrangler` command that touches D1 or
deploys needs `--env`; `build`'s `--dry-run` bundle check needs no bindings and
so takes none.

- Public config (`BETTER_AUTH_URL`, `EDUID_ISSUER`, `GITHUB_APP_SLUG`) →
  each env's `vars`, restated in full.
- The seven secrets (`BETTER_AUTH_SECRET`, `EDUID_CLIENT_ID/SECRET`,
  `GITHUB_CLIENT_ID/SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`) →
  `.dev.vars` (git-ignored; start from `.dev.vars.example`) locally,
  `wrangler secret put … --env <env>` when deployed. Never in `wrangler.jsonc`.
- Each env carries its own `database_id`. `dev`'s is an all-zeros placeholder
  (miniflare uses a local sqlite and ignores it); `prod`'s is a placeholder
  until that environment is provisioned — see `DEPLOY.md`.

The Worker env is typed as `Env` (`src/lib/auth/config.ts`): `new Hono<Env>()`
→ `c.env` is the D1 binding + config/secrets.
