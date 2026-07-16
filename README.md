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
| Group | Team (per lab — holds the roster and the work-repo grant) |
| Student lab repo | Repository created when a lab is accepted |

Identity: users sign in with **SWITCH edu-ID** and must **link their GitHub
account** — the edu-ID identity is THE identity inside the app; GitHub is the
execution surface. On connect, labs sets the org's base repository permission
to **No access** so students only see repos they're granted.

Because GitHub is the authority, each class has a **reconcile** page: it audits
the class against GitHub and repairs any drift — a moved App installation, a
renamed org, roster or team changes made outside labs, an unset base
permission — applying only the fixes the teacher accepts (the audit reads,
never writes). The page's *“What does reconcile cover?”* link lists every drift
the subsystem recognises.

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

# run the app (two terminals)
pnpm --filter @labs/api dev        # Worker (API) on :8788
pnpm --filter @labs/www dev        # SPA with HMR → https://localhost:3000
```

`https://localhost:3000` is the ONLY origin where sign-in works (SWITCH
redirect URIs and cookies are registered for it). In dev, Vite owns that
origin and serves the SPA with HMR, proxying `/api` to the Worker on :8788 —
so auth flows work live, no rebuild needed. The HTTPS cert is self-signed;
accept the browser warning once.

To exercise the prod setup (Worker serving the built SPA, no proxy):

```bash
pnpm --filter @labs/www build
pnpm --filter @labs/api preview    # → https://localhost:3000
```

> Windows gotcha: a running `preview` Worker locks `apps/www/build/client` —
> stop it (and any lingering `workerd` process) before rebuilding the SPA.

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

## Deploy

One Cloudflare Worker serves the API and the built SPA, so a deploy is
build-then-ship — two commands (PowerShell 5.1 has no `&&`):

```bash
pnpm --filter @labs/www build
pnpm --filter @labs/api run deploy    # `run deploy`, not `deploy` (a pnpm built-in)
```

If migrations were added since the last deploy, apply them to the remote D1
first:

```bash
pnpm --filter @labs/api exec wrangler d1 migrations apply labs --remote
```

Secrets and D1 survive deploys — only code and `vars` ship. The live demo is
[`https://labs.stefan-teofanov.workers.dev`](https://labs.stefan-teofanov.workers.dev).
First-time setup from scratch (create the remote D1, the environment's own
GitHub App, the SWITCH redirect URI, the secrets) is a one-time sequence —
follow [`DEPLOY.md`](DEPLOY.md) end to end.

## Documentation

- Design specs: [`docs/superpowers/specs/`](docs/superpowers/specs/)
- GitHub App setup & gotchas: [`GITHUB_APP_SETUP.md`](GITHUB_APP_SETUP.md)
- Per-package rules: [`packages/db/README.md`](packages/db/README.md), [`apps/api/src/lib/github/README.md`](apps/api/src/lib/github/README.md)
