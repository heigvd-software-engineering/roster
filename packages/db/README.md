# @roster/db

The **schema layer**, and nothing more: no query helpers, no tests. Endpoints
write their Drizzle queries inline, so the models here stay the single source of
truth and their types reach the SPA by inference. Query behavior is tested in
`apps/api` against a real local D1.

| File | Ownership | Contents |
|---|---|---|
| `src/auth-schema.ts` | **CLI-generated**, never edit | Better Auth tables (`user`, `session`, `account`, `verification`). Regenerate: `pnpm --filter @roster/api run auth:schema` |
| `src/app-schema.ts` | hand-owned | App-domain tables (`classes`, `assignments`, `groups`, `group_members`, `class_members`, `class_creators`) |
| `src/schema.ts` | hand-owned | Barrel combining both (what `getDb` registers and drizzle-kit reads) |
| `src/index.ts` | hand-owned | `getDb(d1)` + inferred entity types (`User`, `Account`, `Class`, `Assignment`, `Group`, `ClassCreator`) |
| `migrations/` | drizzle-kit generated (hand-adjusted when SQLite limits require it) | Applied via `wrangler d1 migrations apply roster-db --local` (or `--remote`) |

Changing a table means editing `app-schema.ts` (or regenerating
`auth-schema.ts` after an auth config change), then
`pnpm --filter @roster/db db:generate --name <what_it_does>`, then applying.
Always pass `--name`, and read the generated SQL before it ships:
[`AGENTS.md`](../../AGENTS.md) rules 8 and 9 say what drizzle-kit gets wrong.

What each table holds and why, plus the invariants SQLite can't express, is in
[`docs/data-model.md`](../../docs/data-model.md).
