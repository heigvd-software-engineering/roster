# AGENTS.md

Instructions for any AI agent (Claude Code, Cursor, Codex, …) working in this repo.
Read this before writing or changing code. These rules are enforced in review — follow them, don't rationalize exceptions.

## Architecture (context you must not break)

- pnpm monorepo. `apps/www` = React SPA (Vite, Tailwind, shadcn). `apps/api` = Cloudflare Worker (Hono, Drizzle, D1, R2). `packages/db` = the Drizzle schema, the single source of truth for data shapes.
- Type flow is **Drizzle → `@labs/db` → `@labs/api` (`AppType`) → `apps/www` (`InferResponseType`)**. Types are inferred across this whole chain; nothing is hand-maintained in parallel to it.
- No build step for `@labs/db` — apps import its TypeScript source directly via the package `exports` field.

## Rules

1. **MUST NOT create a `packages/types` package or any shared hand-written type layer.** We use Drizzle inference end-to-end; a parallel type package is exactly what this repo rejects.
2. **MUST derive DB-row types from Drizzle, never hand-write them.** Use `typeof <table>.$inferSelect` / `.$inferInsert`, or the named aliases exported from `@labs/db` (`Class`, `Lab`, `Group`, `User`, `Account`). Add a new alias there when a table is used widely.
3. **API response shapes MUST stay inferred.** Build handler responses as object literals projected from Drizzle query rows — do not annotate them with a hand-written response interface. The frontend gets the shape for free through the Hono RPC client.
4. **Frontend MUST consume API types via the RPC client**, not by re-declaring them. Derive from `InferResponseType<typeof api.…$get, 200>` (see `apps/www/app/lib/api.ts`). `apps/www` must not depend on `@labs/db` directly.
5. **Hand-written `type`/`interface` is only allowed when it does NOT duplicate a DB row** — i.e. external-API shapes (GitHub), config/env bindings, control-flow result unions, and UI-only view-models / component props. When in doubt, ask whether Drizzle already knows the shape; if yes, derive it.
6. **Input-validation schemas (zod) SHOULD stay linked to the schema.** Prefer `drizzle-zod` (`createInsertSchema`) over hand-listing columns when validating writes, so validators can't drift from the table.

## Frontend

7. **Split large components.** A subcomponent used nowhere else lives inline in the same file; extract to its own file only when it's reused.
8. **Keep folders small.** When a component folder grows too large, reorganise into subfolders. Exception: the generated `ui/` folder.
9. **Fetch through the RPC client.** Use the `useApi` hook / `api.…` client — never hand-roll `fetch`. Keeps request and response types inferred end-to-end.

