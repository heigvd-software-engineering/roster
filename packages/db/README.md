# @roster/db

The **schema layer** — and deliberately nothing more.

## What lives here

| File | Ownership | Contents |
|---|---|---|
| `src/auth-schema.ts` | **CLI-generated** — never edit | Better Auth tables (`user`, `session`, `account`, `verification`). Regenerate: `pnpm --filter @roster/api run auth:schema` |
| `src/app-schema.ts` | hand-owned | App-domain tables (`classes`, `labs`, `groups`, `group_members`, `class_members`) |
| `src/schema.ts` | hand-owned | Barrel combining both (what `getDb` registers and drizzle-kit reads) |
| `src/index.ts` | hand-owned | `getDb(d1)` + inferred entity types (`User`, `Account`, `Class`, `Lab`, `Group`) |
| `migrations/` | drizzle-kit generated (hand-adjusted when SQLite limits require it) | Applied via `wrangler d1 migrations apply roster-db --local` (or `--remote`) |

## What deliberately does NOT live here

**No query helpers.** Decided 2026-07-03: a function-per-query layer
(`getClassById`, `listClassesByOrgIds`, …) made endpoints harder to follow
for no gain — the database itself is the abstraction. **Endpoints write
their Drizzle queries inline** and return the query results directly;
response types flow to the SPA through Hono's `hc<AppType>` inference, so
the Drizzle models stay the single source of truth end to end.

That rule is about *this package*, which stays pure schema. Shared domain
logic that happens to query does live in `apps/api/src/lib/` — `access.ts`
(`groupInClass`, `labInClass`, `linkedUsers`), `group-members.ts`,
`enrollment.ts`, and the `reconcile/` modules. The line: a helper earns its
place by owning a class-scoped rule several handlers must agree on, not by
wrapping a query.

**No tests.** The package is CLI-generated schema + `getDb` — no logic of our
own. Endpoint behavior (including every query) is tested in `apps/api`
against a real local D1 (Workers pool).

## Workflow

- New app table/column → edit `app-schema.ts` →
  `pnpm --filter @roster/db db:generate --name <what_it_does>` (ALWAYS pass
  `--name` — never ship drizzle-kit's random `flaky_cerebro` names) → apply
  migrations.
- Auth config change (e.g. `user.additionalFields`) → regenerate `auth-schema.ts` via the CLI → `db:generate` → apply.
