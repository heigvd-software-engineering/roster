# AGENTS.md

Instructions for any AI agent (Claude Code, Cursor, Codex, …) working in this repo.
Read this before writing or changing code. Review enforces these rules; follow them, don't rationalize exceptions.

The one escape hatch: when a rule is genuinely unreasonable for a specific piece of code, mark the site with a comment starting `AGENTS EXCEPTION (rule N):`, followed by short reasoning and, when possible, the condition under which to revisit it. A deviation without this marker is a review finding; so is a marker whose reasoning doesn't hold up.

## Architecture (context you must not break)

- pnpm monorepo. `apps/www` = React SPA (Vite, Tailwind, shadcn). `apps/api` = Cloudflare Worker (Hono, Drizzle, D1). `packages/db` = the Drizzle schema, the single source of truth for data shapes.
- Type flow is **Drizzle → `@roster/db` → `@roster/api` (`AppType`) → `apps/www` (`InferResponseType`)**. Types are inferred across this whole chain; nothing is hand-maintained in parallel to it.
- No build step for `@roster/db`: apps import its TypeScript source directly via the package `exports` field.

## Rules

1. **MUST NOT create a `packages/types` package or any shared hand-written type layer.** We use Drizzle inference end-to-end.
2. **MUST derive DB-row types from Drizzle, never hand-write them.** Use `typeof <table>.$inferSelect` / `.$inferInsert`, or the named aliases exported from `@roster/db` (`Class`, `Lab`, `Group`, `User`, `Account`). Add a new alias there when a table is used widely.
3. **API response shapes MUST stay inferred.** Build handler responses as object literals projected from Drizzle query rows; do not annotate them with a hand-written response interface. The frontend gets the shape for free through the Hono RPC client.
4. **Frontend MUST consume API types via the RPC client**, not by re-declaring them. Derive from `InferResponseType<typeof api.…$get, 200>` (see `apps/www/app/lib/api.ts`). `apps/www` must not depend on `@roster/db` directly.
5. **Hand-written `type`/`interface` is only allowed when it does NOT duplicate a DB row**: external-API shapes (GitHub), config/env bindings, control-flow result unions, and UI-only view-models / component props. When in doubt, ask whether Drizzle already knows the shape; if yes, derive it.
6. **Input-validation schemas (zod) SHOULD stay linked to the schema.** Prefer `drizzle-zod` (`createInsertSchema`) over hand-listing columns when validating writes, so validators can't drift from the table.
7. **Calls to external services MUST live in a dedicated integration layer, never inline elsewhere.** Handlers and other lib code orchestrate named operations; they never touch a raw client or `fetch` an external API directly. Example: every GitHub call lives in `apps/api/src/lib/github/`, one call + narrowing per function, no orchestration (see its README). A future external service gets its own `lib/<service>/` on the same pattern.

## Database

8. **Migrations MUST carry a descriptive name.** Always generate with `pnpm --filter @roster/db db:generate --name=<what_it_does>` (e.g. `class_members_invitation_id`). Without `--name`, drizzle-kit invents a random one (`0013_busy_valeria_richards`) that tells you nothing when you read the migration list to work out what shape the DB is in.
9. **Read the generated SQL before applying it.** drizzle-kit is a starting point, not an authority. Two things it reliably gets wrong on SQLite: a table rebuild that also adds a column emits `SELECT "<new_col>" FROM <old_table>`, a column that does not exist yet, so the migration fails; and it never writes the data BACKFILL a semantic change needs. Fix both in the generated file, and note in a comment that it was hand-edited and why.

## API

10. **Routes wire, handlers do, lib shares.** A route file (`apps/api/src/routes/`) contains only paths and middleware (`.use`) mapped to named handlers, no logic. Handlers live in `apps/api/src/handlers/`. A helper may be declared in the handler file that uses it; the moment a second file needs it, move it into `apps/api/src/lib/`. Never import from another handler file.
11. **A `lib/` module is a named unit, not merely shared code.** Sharing is one reason to live there, never the requirement: a single-caller module is fine when you reason about it on its own, with its own name, its own tests, its own reason to change. Each reconciler in `lib/reconcile/` is imported only by the registry, `lib/auth/accepted-invitation-heal.ts` only by the auth config. The test is whether inlining it into its one caller would bury a distinct concern somewhere nobody would look for it.

## Frontend

12. **Split large components.** A subcomponent used nowhere else lives inline in the same file; extract to its own file only when it's reused.
13. **Keep folders small.** When a component folder grows too large, reorganise into subfolders. Exception: the generated `ui/` folder.
14. **Fetch through the RPC client.** Use the `useApi` hook / `api.…` client, never a hand-rolled `fetch`. Keeps request and response types inferred end-to-end.
15. **If you must read an element's classes to know what it is, it needs a name.** Tailwind is low-level; the component name is where the meaning lives. Wrap any element whose purpose its utility string alone doesn't state in a component named for what it RENDERS (`NowLine`, `MonthGrid`, `StarterChip`). When styling branches by state, each state becomes its own named component over one shared shell (`DoneBar` / `RunningBar` / `LockedBar` over `Bar` in `labs-timeline.tsx`), never a `cn()` ladder of `state === …` conditionals with a conditional `style` spread. Long class strings survive only INSIDE leaf components, one per name. Same-file components are the default home (rule 12); `className` stays as the call-site escape hatch.
