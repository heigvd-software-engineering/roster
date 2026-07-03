# labs

HEIG-VD's in-house replacement for GitHub Classroom.

## About

A **class is a GitHub organization** — labs manages it and stores only what
GitHub can't express. The mapping:

| labs | GitHub |
|---|---|
| Class | Organization (connected via the labs GitHub App) |
| Teacher | Organization **Owner** |
| Student | Organization **Member** (self-enrolls via the class join link) |
| Group | Team *(upcoming)* |
| Student lab repo | Repository created on lab accept *(upcoming)* |

Identity: users sign in with **SWITCH edu-ID** and must **link their GitHub
account** — the edu-ID identity is THE identity inside the app; GitHub is the
execution surface. On connect, labs sets the org's base repository permission
to **No access** so students only see repos they're granted.

## Stack

pnpm monorepo. One Cloudflare **Worker** serves the SPA's static assets and
`/api/*` (same origin, first-party cookies).

| Package | What |
|---|---|
| `apps/api` | Hono on Cloudflare Workers · Better Auth (edu-ID OIDC + GitHub linking) · octokit App |
| `apps/www` | React Router SPA (`ssr:false`) · Tailwind 4 · shadcn/ui (Base UI) |
| `packages/db` | Drizzle schema for D1 — schema ONLY, no query layer (see its README) |

End-to-end type safety with no codegen: Drizzle models → inline queries in
endpoints → responses inferred by the SPA via Hono's `hc<AppType>`.

## Local development

Prereqs: Node ≥ 22.22, pnpm 11 (auto-downloaded via `devEngines`), and
`apps/api/.dev.vars` with the secrets (edu-ID client, GitHub App key —
see `GITHUB_APP_SETUP.md`).

```bash
pnpm install

# one-time / after schema changes: apply migrations to the local D1
pnpm --filter @labs/api exec wrangler d1 migrations apply labs --local

# run the app (build the SPA first — the Worker serves apps/www/build/client)
pnpm --filter @labs/www build
pnpm --filter @labs/api dev        # → https://localhost:3000
```

The Worker origin `https://localhost:3000` is the ONLY origin where sign-in
works (SWITCH redirect URIs and cookies are registered for it). For pure-UI
iteration with HMR there's also `pnpm --filter @labs/www dev` (proxies `/api`
to :3000), but auth flows must be exercised on :3000.

> Windows gotcha: the running Worker locks `apps/www/build/client` — stop it
> (and any lingering `workerd` process) before rebuilding the SPA.

### Checks

```bash
pnpm run biome        # lint + format (Biome)
pnpm typecheck        # tsc across all packages
pnpm test             # vitest — api tests run on a real local D1 (Workers pool)
pnpm build            # SPA build + Worker dry-run
```

### Database

```bash
pnpm --filter @labs/db db:generate                                    # new migration from schema
pnpm --filter @labs/api exec wrangler d1 migrations apply labs --local    # apply locally
pnpm --filter @labs/api exec wrangler d1 migrations apply labs --remote   # apply to prod D1
pnpm --filter @labs/api run auth:schema                               # regenerate Better Auth schema
```

The local D1 is a plain SQLite file under
`apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` — point DBeaver
(or any SQLite client) at it to browse.

## Documentation

- Design specs: [`docs/superpowers/specs/`](docs/superpowers/specs/)
- Implementation plans & feature tracker: [`docs/superpowers/plans/`](docs/superpowers/plans/)
- GitHub App setup & gotchas: [`GITHUB_APP_SETUP.md`](GITHUB_APP_SETUP.md)
- Per-package rules: [`packages/db/README.md`](packages/db/README.md), [`apps/api/src/lib/github/README.md`](apps/api/src/lib/github/README.md)
