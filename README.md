# roster

HEIG-VD's in-house replacement for GitHub Classroom.

## About

A **class is a GitHub organization**. roster manages it and stores only what
GitHub can't express:

| roster | GitHub |
|---|---|
| Class | Organization (connected via the roster GitHub App) |
| Teacher | Organization **Owner** |
| Student | Organization **Member** (self-enrolls via the class join link) |
| Group | Team (per assignment, holds the roster and the work-repo grant) |
| Work repo | Repository created when an assignment is accepted |

Users sign in with **SWITCH edu-ID** and must **link their GitHub account**:
edu-ID is THE identity inside the app, GitHub the execution surface. On
connect, roster sets the org's base repository permission to **No access**, so
students only see repos they're granted.

Because GitHub is the authority, each class has a **reconcile** page: it audits
the class against GitHub (reads, never writes) and applies only the drift fixes
the teacher accepts. Its *“What does reconcile cover?”* link lists every drift
the subsystem recognises.

## Stack

pnpm monorepo. One Cloudflare **Worker** serves the SPA's static assets and
`/api/*` (same origin, first-party cookies).

| Package | What |
|---|---|
| `apps/api` | Hono on Cloudflare Workers · Better Auth (edu-ID OIDC + GitHub linking) · octokit App |
| `apps/www` | React Router SPA (`ssr:false`) · Tailwind 4 · shadcn/ui (Base UI) |
| `packages/db` | Drizzle schema for D1: schema ONLY, no query layer |

End-to-end type safety with no codegen: Drizzle models → inline queries in
endpoints → responses inferred by the SPA via Hono's `hc<AppType>`.

## Local development

Prereqs: Node ≥ 22.22, pnpm 10.28 (auto-downloaded via `devEngines`), and
`apps/api/.dev.vars` with the secrets (edu-ID client, GitHub App key). Copy
`apps/api/.dev.vars.example` and fill it in; [`DEPLOY.md`](DEPLOY.md) phase 3
says where each value comes from.

```bash
pnpm install                 # pnpm, not npm: `workspace:*` is a protocol npm
                             # cannot resolve

# one-time / after schema changes: apply migrations to the local D1
pnpm --filter @roster/api exec wrangler d1 migrations apply roster-db --local

# run the app (two terminals)
pnpm --filter @roster/api dev        # Worker (API) on :8788
pnpm --filter @roster/www dev        # SPA with HMR → https://localhost:3000
```

`https://localhost:3000` is the ONLY origin where sign-in works (SWITCH
redirect URIs and cookies are registered for it), which is why `vite.config.ts`
pins `port: 3000, strictPort: true` and a dev-only self-signed cert. In dev,
Vite owns that origin and proxies `/api` to the Worker on :8788, so auth flows
work live with no rebuild. Accept the certificate warning once.

To exercise the prod setup (Worker serving the built SPA, no proxy):

```bash
pnpm --filter @roster/www build
pnpm --filter @roster/api preview    # → https://localhost:3000
```

> Windows gotcha: a running `preview` Worker locks `apps/www/build/client`.
> Stop it (and any lingering `workerd` process) before rebuilding the SPA.

### Checks

```bash
pnpm run biome        # lint + format check (Biome; reports, never rewrites)
pnpm typecheck        # tsc across all packages
pnpm test             # vitest; api tests run on a real local D1 (Workers pool)
pnpm build            # SPA build + Worker dry-run
```

### Database

```bash
pnpm --filter @roster/db db:generate --name <what_it_does>                       # new migration from schema
pnpm --filter @roster/api exec wrangler d1 migrations apply roster-db --local    # apply to the local D1
pnpm --filter @roster/api exec wrangler d1 migrations apply roster-db --remote   # apply to the deployed D1
pnpm --filter @roster/api run auth:schema                                        # regenerate Better Auth schema
```

The D1 binding lives at the top level of `apps/api/wrangler.jsonc` (there are no
wrangler environments), so no `--env` is needed. `--local` targets the miniflare
SQLite, `--remote` the deployed `roster-db`. Always pass `--name`: see
[`AGENTS.md`](AGENTS.md) rules 8 and 9 for why, and for what to check in the
generated SQL before applying it.

The local D1 is a plain SQLite file under
`apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`; point DBeaver (or
any SQLite client) at it to browse.

One more generated file: `apps/api/worker-configuration.d.ts` holds the Worker
runtime globals, so rerun `pnpm --filter @roster/api cf-typegen` whenever
`wrangler.jsonc` changes.

## Deploy

Build then ship, two commands (PowerShell 5.1 has no `&&`):

```bash
pnpm --filter @roster/www build
pnpm --filter @roster/api run deploy
```

Production is the top-level config in `apps/api/wrangler.jsonc`: the
`roster-app` Worker over the `roster-db` database, on
[`roster.y-software.ch`](https://roster.y-software.ch). A deploy ships whatever
sits in `apps/www/build/client` at that moment, not your git tree, so always
rebuild first. [`DEPLOY.md`](DEPLOY.md) covers everything else: setting a
deployment up from scratch, the GitHub App, secrets, redeploys with pending
migrations, and operating what's live.

## Documentation

How the system works, in `docs/`:

| Document | What |
|---|---|
| [`architecture.md`](docs/architecture.md) | Monorepo, the single Worker, middleware, the type chain, the SPA |
| [`data-model.md`](docs/data-model.md) | The D1 schema and the invariants it can't express |
| [`identity.md`](docs/identity.md) | edu-ID sign-in, GitHub linking, roles, super admins |
| [`classes-and-assignments.md`](docs/classes-and-assignments.md) | Connecting a class, enrollment, assignments, groups, work repos |
| [`reconcile.md`](docs/reconcile.md) | The drift audit and what each reconciler repairs |
| [`nomenclature.md`](docs/nomenclature.md) | Vocabulary, and how it maps to GitHub's |

[`AGENTS.md`](AGENTS.md) holds the rules code must follow, [`DEPLOY.md`](DEPLOY.md)
the operations. Two folders carry their own conventions next to the code:
[`apps/api/src/lib/github/`](apps/api/src/lib/github/README.md) (every GitHub
call roster makes) and
[`apps/www/app/components/`](apps/www/app/components/README.md) (generated vs
hand-written UI).
