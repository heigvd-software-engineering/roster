# Super Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Class creation becomes a granted capability: super admins (config-listed emails) toggle "can create classes" per user from a small `/admin` zone; the GitHub-App setup callback refuses to birth a class for anyone else.

**Architecture:** One app-owned table (`class_creators`, row presence = capability) plus one config var (`SUPER_ADMIN_EMAILS`). Both capabilities ride the `/api/me` boot fetch to the SPA; the only hard gate is server-side in the setup callback's CREATE path — the repair path and everything existing stay untouched.

**Tech Stack:** Drizzle/D1 (SQLite), Hono + zod, React + SWR, vitest (`cloudflare:test` for API, testing-library for www), biome.

**Spec:** `docs/superpowers/specs/2026-07-27-super-admin-design.md` — read it first.

## Global Constraints

- Follow `AGENTS.md`: DB types derive from Drizzle; response shapes stay inferred (hc/AppType); migrations get `--name`; read generated SQL before applying.
- Error vocabulary (exact strings): API guard answers `401 { error: "unauthorized" }` / `403 { error: "forbidden" }`; unknown user on toggle `404 { error: "not_found" }`; setup redirect code `not_class_creator`.
- Fail closed: empty/unset `SUPER_ADMIN_EMAILS` means no admins; with an empty `class_creators` table nobody can create classes.
- Copy strings in tasks are spec — use them verbatim.
- Run commands from the repo root. After every task: `pnpm biome` and `pnpm -r typecheck` must pass.
- Working mode: tasks are built inline and human-gated — pause after each task for the user's go-ahead; commit on their say-so, on branch `feat/super-admin`, **no co-author trailer**.
- Tests come at the END (Tasks 8–9), after the user validates the feature by hand (Task 7). Do not write tests in Tasks 1–6.

---

### Task 1: `class_creators` table + migration

**Files:**
- Modify: `packages/db/src/app-schema.ts` (append after `classMembers`)
- Modify: `packages/db/src/index.ts` (export the inferred type)
- Create: `packages/db/migrations/0016_class_creators.sql` (generated)

**Interfaces:**
- Produces: `classCreators` table (`userId` text PK → `user.id`, `createdAt` timestamp not null), exported from `@roster/db`; entity type `ClassCreator`.

- [ ] **Step 1: Add the table to `app-schema.ts`**

```ts
/**
 * CLASS-CREATION capability — row presence IS the grant (no boolean to
 * drift). Granted/revoked by a super admin (config-listed emails, never
 * stored here — see lib/auth/super-admin.ts in the API). Gates ONLY the
 * setup callback's CREATE path: existing classes and per-class roles are
 * untouched by grant or revoke.
 */
export const classCreators = sqliteTable("class_creators", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 2: Export the type from `packages/db/src/index.ts`**

Mirror the existing inferred entity types (`User`, `Class`, …) in that file:

```ts
export type ClassCreator = typeof schema.classCreators.$inferSelect;
```

(Match the file's actual export style — open it and copy how `Class` is derived.)

- [ ] **Step 3: Generate + inspect + apply the migration**

```bash
pnpm --filter @roster/db db:generate --name class_creators
```

Read the generated `packages/db/migrations/0016_class_creators.sql` — expect a single `CREATE TABLE class_creators (...)` with the FK; no hand-editing should be needed. Then apply locally (from `apps/api`):

```bash
pnpm --filter @roster/api exec wrangler d1 migrations apply roster-db --local
```

(`roster-db` is the binding's `database_name` in `wrangler.jsonc`, which
`wrangler dev` uses; the demo REMOTE db is named `labs` and is migrated in
Task 10 via `--config wrangler.demo.jsonc`.)

- [ ] **Step 4: Typecheck, biome, pause for user gate, commit on approval**

```bash
pnpm -r typecheck
pnpm biome
git add packages/db
git commit -m "feat(db): class_creators capability table"
```

---

### Task 2: `SUPER_ADMIN_EMAILS` config + `super-admin.ts` helpers

**Files:**
- Modify: `apps/api/src/lib/auth/config.ts` (add `SUPER_ADMIN_EMAILS: string` to the `AuthEnv` vars type, next to `GITHUB_APP_SLUG`)
- Create: `apps/api/src/lib/auth/super-admin.ts`
- Modify: `apps/api/wrangler.jsonc` (`vars`), `apps/api/wrangler.demo.jsonc` (`vars`), `apps/api/.dev.vars.example`, `apps/api/.dev.vars` (local only, git-ignored)

**Interfaces:**
- Produces: `isSuperAdmin(env: AuthEnv, email: string | null | undefined): boolean`; `userCanCreateClasses(env: AuthEnv, db: ReturnType<typeof getDb>, user: Pick<User, "id" | "email">): Promise<boolean>`; `requireSuperAdmin` Hono middleware over `AuthedEnv` (401 no session, 403 non-admin, else sets `user`).

- [ ] **Step 1: Create `apps/api/src/lib/auth/super-admin.ts`**

```ts
import { type getDb, type User } from "@roster/db";
import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "./config";
import { createAuth } from "./config";
import type { AuthedEnv } from "./require-auth";

/**
 * Super admins are CONFIG, not data: exactly the emails in
 * `SUPER_ADMIN_EMAILS` (comma-separated, case-insensitive, whitespace
 * tolerated). Empty/unset = no super admins — the app FAILS CLOSED:
 * with an empty `class_creators` table nobody can create classes, so
 * every deployment must set the var (DEPLOY.md).
 */
export function isSuperAdmin(
  env: AuthEnv,
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return (env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/** Class creation = super admin OR a `class_creators` row. Admins are
 *  implicitly creators — they never grant themselves. */
export async function userCanCreateClasses(
  env: AuthEnv,
  db: ReturnType<typeof getDb>,
  user: Pick<User, "id" | "email">,
): Promise<boolean> {
  if (isSuperAdmin(env, user.email)) return true;
  const row = await db.query.classCreators.findFirst({
    where: (t, { eq }) => eq(t.userId, user.id),
    columns: { userId: true },
  });
  return row !== undefined;
}

/** Gate for /api/admin/*: 401 without a session, 403 without admin. The
 *  menu link is convenience; THIS is the security boundary. */
export const requireSuperAdmin = createMiddleware<AuthedEnv>(
  async (c, next) => {
    const session = await createAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    if (!isSuperAdmin(c.env, session.user.email)) {
      return c.json({ error: "forbidden" }, 403);
    }
    c.set("user", session.user as User);
    return next();
  },
);
```

- [ ] **Step 2: Add the var everywhere config lives**

`apps/api/src/lib/auth/config.ts` — in the `AuthEnv` type, after `GITHUB_APP_SLUG: string;`:

```ts
  /** Comma-separated super-admin emails (edu-ID). Empty = no admins —
   *  class creation fails closed. Public config, like the slug. */
  SUPER_ADMIN_EMAILS: string;
```

`apps/api/wrangler.jsonc` `vars` (prod — the owning account fills it):

```jsonc
    // Super admins: comma-separated edu-ID emails. Empty = NOBODY can
    // create classes (fail closed) — set before real use (DEPLOY.md).
    "SUPER_ADMIN_EMAILS": ""
```

`apps/api/wrangler.demo.jsonc` `vars`: same key — ask the user which edu-ID email their demo account signs in with and put it there.

`apps/api/.dev.vars.example` and the user's `.dev.vars`: add `SUPER_ADMIN_EMAILS=<your edu-ID email>` with a one-line comment.

- [ ] **Step 3: Typecheck, biome, pause for user gate, commit on approval**

```bash
pnpm -r typecheck
pnpm biome
git add apps/api/src/lib/auth/super-admin.ts apps/api/src/lib/auth/config.ts apps/api/wrangler.jsonc apps/api/wrangler.demo.jsonc apps/api/.dev.vars.example
git commit -m "feat(api): SUPER_ADMIN_EMAILS config + super-admin helpers"
```

---

### Task 3: `/api/me` carries the two capabilities

**Files:**
- Modify: `apps/api/src/handlers/me.ts`

**Interfaces:**
- Consumes: `isSuperAdmin`, `userCanCreateClasses` (Task 2).
- Produces: both `/api/me` responses gain `isSuperAdmin: boolean` and `canCreateClasses: boolean` (signed-out: both `false`). Types reach the SPA via the existing `InferResponseType` — no client shape to write.

- [ ] **Step 1: Extend the handler**

In `apps/api/src/handlers/me.ts`, import the helpers:

```ts
import { isSuperAdmin, userCanCreateClasses } from "../lib/auth/super-admin";
```

Add to the **signed-out** return (the early `if (!session)` branch):

```ts
      isSuperAdmin: false,
      canCreateClasses: false,
```

In the signed-in path, after `user` is loaded, compute once:

```ts
  const superAdmin = isSuperAdmin(c.env, user?.email);
  const canCreate =
    superAdmin ||
    (user ? await userCanCreateClasses(c.env, db, user) : false);
```

and add to the final return:

```ts
    isSuperAdmin: superAdmin,
    canCreateClasses: canCreate,
```

- [ ] **Step 2: Typecheck, biome, pause for user gate, commit on approval**

```bash
pnpm -r typecheck
pnpm biome
git add apps/api/src/handlers/me.ts
git commit -m "feat(api): /api/me reports isSuperAdmin + canCreateClasses"
```

---

### Task 4: `/api/admin` — list users, toggle class-creator

**Files:**
- Create: `apps/api/src/handlers/admin.ts`
- Create: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/index.ts` (mount)

**Interfaces:**
- Consumes: `requireSuperAdmin` (Task 2), `classCreators` (Task 1).
- Produces: `GET /api/admin/users` → `{ users: { id, name, email, createdAt, canCreateClasses: boolean }[] }` (every user row, name-ordered; `canCreateClasses` here reflects the ROW only — the toggle's state, not the admin's implicit power). `PUT /api/admin/users/:id/class-creator` body `{ enabled: boolean }` → `{ ok: true }`, idempotent both ways, `404 { error: "not_found" }` for an unknown id. RPC path for the SPA: `api.api.admin.users[":id"]["class-creator"].$put`.

- [ ] **Step 1: Create `apps/api/src/handlers/admin.ts`**

```ts
import { zValidator } from "@hono/zod-validator";
import { classCreators, getDb, user } from "@roster/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authedFactory } from "../factory";

/**
 * The super-admin zone's data. Every SWITCH user in the app (the `user`
 * table IS the SWITCH users), with whether they hold the class-creator
 * grant. School-scale: no pagination, keyword filtering is client-side.
 */
export const listUsers = authedFactory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      grant: classCreators.userId,
    })
    .from(user)
    .leftJoin(classCreators, eq(classCreators.userId, user.id))
    .orderBy(user.name);
  return c.json({
    users: rows.map(({ grant, ...u }) => ({
      ...u,
      canCreateClasses: grant !== null,
    })),
  });
});

/** PUT = the desired end state; both directions are idempotent. */
export const setClassCreator = authedFactory.createHandlers(
  zValidator("json", z.object({ enabled: z.boolean() })),
  async (c) => {
    const userId = c.req.param("id");
    const { enabled } = c.req.valid("json");
    const db = getDb(c.env.DB);
    const [target] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId));
    if (!target) return c.json({ error: "not_found" }, 404);
    if (enabled) {
      await db
        .insert(classCreators)
        .values({ userId, createdAt: new Date() })
        .onConflictDoNothing();
    } else {
      await db.delete(classCreators).where(eq(classCreators.userId, userId));
    }
    return c.json({ ok: true });
  },
);
```

- [ ] **Step 2: Create `apps/api/src/routes/admin.ts`**

```ts
import { Hono } from "hono";
import { listUsers, setClassCreator } from "../handlers/admin";
import type { AuthedEnv } from "../lib/auth/require-auth";
import { requireSuperAdmin } from "../lib/auth/super-admin";

export const adminRoutes = new Hono<AuthedEnv>()
  .use("/admin/*", requireSuperAdmin)
  .get("/admin/users", ...listUsers)
  .put("/admin/users/:id/class-creator", ...setClassCreator);
```

- [ ] **Step 3: Mount in `apps/api/src/index.ts`**

Import `adminRoutes` alongside the others and add, after the `meRoutes` line:

```ts
  .route("/api", adminRoutes)
```

- [ ] **Step 4: Typecheck, biome, pause for user gate, commit on approval**

```bash
pnpm -r typecheck
pnpm biome
git add apps/api/src/handlers/admin.ts apps/api/src/routes/admin.ts apps/api/src/index.ts
git commit -m "feat(api): /api/admin — user list + class-creator toggle"
```

---

### Task 5: Setup-callback gate + connect-failed cause

**Files:**
- Modify: `apps/api/src/handlers/setup.ts` (CREATE path only)
- Modify: `apps/www/app/pages/connect-failed-page.tsx` (new `CAUSES` entry)

**Interfaces:**
- Consumes: `userCanCreateClasses` (Task 2).
- Produces: setup redirect `/?error=not_class_creator` (which `routes/home.tsx` already forwards to `/classes/connect-failed?reason=not_class_creator` — no change needed there).

- [ ] **Step 1: Gate the CREATE path in `setup.ts`**

Import:

```ts
import { userCanCreateClasses } from "../lib/auth/super-admin";
```

In `githubSetupCallback`, directly after `if (!session) return c.redirect("/");` (i.e. before the token/installation checks — the cheapest refusal first, and the REPAIR path above stays session-less and ungated):

```ts
  // Class creation is GRANTED, not open: without the capability no class
  // row is born. Everything the user already has is untouched — the
  // repair path above never reaches this line.
  if (!(await userCanCreateClasses(c.env, db, session.user))) {
    return c.redirect("/?error=not_class_creator");
  }
```

(`session.user` carries `id` and `email` — exactly the `Pick<User, "id" | "email">` the helper takes.)

- [ ] **Step 2: Add the cause to `connect-failed-page.tsx`**

Append to the `CAUSES` array (last — it is the rarest cause):

```ts
  {
    key: "not_class_creator",
    title: "Your account isn't allowed to create classes",
    detail:
      "Class creation is restricted to designated accounts. Ask an administrator to allow your account to create classes, then connect the organization again.",
  },
```

- [ ] **Step 3: Typecheck, biome, pause for user gate, commit on approval**

```bash
pnpm -r typecheck
pnpm biome
git add apps/api/src/handlers/setup.ts apps/www/app/pages/connect-failed-page.tsx
git commit -m "feat: setup callback refuses class creation without the grant"
```

---

### Task 6: SPA plumbing — context, hidden "New class", menu link, `/admin` route + page

**Files:**
- Modify: `apps/www/app/contexts/auth-context.tsx`
- Modify: `apps/www/app/pages/classes-page.tsx`
- Modify: `apps/www/app/components/custom/shell/main-switch-identity.tsx`
- Modify: `apps/www/app/routes.ts`
- Create: `apps/www/app/routes/admin.tsx`
- Create: `apps/www/app/pages/admin-page.tsx`

**Interfaces:**
- Consumes: `/api/me` fields (Task 3), `/api/admin` endpoints (Task 4).
- Produces: `useAuth()` gains `isSuperAdmin: boolean` and `canCreateClasses: boolean`.

- [ ] **Step 1: Extend `auth-context.tsx`**

In `AuthValue`, after `githubLinked`:

```ts
  /** Config-listed super admin — shows the admin zone. */
  isSuperAdmin: boolean;
  /** May create classes (admin, or granted) — shows "New class". */
  canCreateClasses: boolean;
```

In the `useMemo` value, after `githubLinked: githubState === "linked",`:

```ts
      isSuperAdmin: data?.isSuperAdmin ?? false,
      canCreateClasses: data?.canCreateClasses ?? false,
```

- [ ] **Step 2: Hide "New class" in `classes-page.tsx`**

Import `useAuth`, read `const { canCreateClasses } = useAuth();` in `ClassesPage`, and change the header row (line ~114):

```tsx
        {canCreateClasses ? <NewClassDialog /> : null}
```

Also guard the empty-hub hint that references the button — replace the `Teaching? Use "New class" above …` paragraph so non-creators don't get pointed at a button they don't have:

```tsx
                  <Text variant="caption">
                    {canCreateClasses
                      ? 'Teaching? Use "New class" above — it walks you through how a class maps onto GitHub. A student? There\'s nothing to create: open the class link your teacher shared and your class appears here.'
                      : "A student? There's nothing to create: open the class link your teacher shared and your class appears here."}
                  </Text>
```

- [ ] **Step 3: Menu item in `main-switch-identity.tsx`**

Import `ShieldCheck` from `lucide-react` and `useNavigate` from `react-router`; read `isSuperAdmin` from `useAuth()` and `const navigate = useNavigate();`. Insert before the sign-out separator (i.e. just above the final `<DropdownMenuSeparator />`):

```tsx
        {isSuperAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/admin")}>
              <ShieldCheck />
              Super admin
            </DropdownMenuItem>
          </>
        )}
```

- [ ] **Step 4: Route — `routes.ts` + `routes/admin.tsx`**

`routes.ts`, after the `classes/connect-failed` line:

```ts
  route("admin", "routes/admin.tsx"),
```

`apps/www/app/routes/admin.tsx` (mirror `routes/connect-failed.tsx`'s structure exactly — open it and copy the export style):

```tsx
import { AdminPage } from "~/pages/admin-page";

export default function Admin() {
  return <AdminPage />;
}
```

- [ ] **Step 5: The page — `apps/www/app/pages/admin-page.tsx`**

If `apps/www/app/components/ui/switch.tsx` does not exist, add it with the project's scaffolder (never hand-author): `pnpm dlx shadcn@latest add switch` from `apps/www`. Same for `input` if missing.

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Page } from "~/components/custom/layout/page";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { useAuth } from "~/contexts/auth-context";
import { api, useAction, useApi } from "~/lib/api";

/**
 * /admin — the SUPER-ADMIN zone (config-listed emails only; the API
 * guard is the boundary, this page just bounces non-admins). One job:
 * grant/revoke "can create classes" per SWITCH user. The list is every
 * user row; filtering is client-side (school scale).
 */
export function AdminPage() {
  const { isLoading: authLoading, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!authLoading && !isSuperAdmin) navigate("/classes", { replace: true });
  }, [authLoading, isSuperAdmin, navigate]);

  const { data, isLoading, mutate } = useApi(api.api.admin.users);
  const { busy, act } = useAction(mutate);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const users = (data?.users ?? []).filter(
    (u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q),
  );

  if (!isSuperAdmin) return null;
  return (
    <Page>
      <Stack gap="lg" className="w-full max-w-2xl">
        <Stack gap="none">
          <Text variant="heading">Super admin</Text>
          <Text variant="subtitle">
            Who may create classes. Everything else is unaffected.
          </Text>
        </Stack>
        <Input
          placeholder="Filter by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Loading loading={isLoading && !data} label="Loading users…">
          <Stack gap="sm" className="w-full">
            {users.map((u) => (
              <Row key={u.id} justify="between" className="w-full">
                <UserIdentity name={u.name} subtitle={u.email} />
                <Row gap="sm">
                  <Text variant="caption">Can create classes</Text>
                  <Switch
                    checked={u.canCreateClasses}
                    disabled={busy}
                    onCheckedChange={(enabled) =>
                      act(() =>
                        api.api.admin.users[":id"]["class-creator"].$put({
                          param: { id: u.id },
                          json: { enabled },
                        }),
                      )
                    }
                  />
                </Row>
              </Row>
            ))}
            {users.length === 0 ? (
              <Text variant="body2">No users match.</Text>
            ) : null}
          </Stack>
        </Loading>
      </Stack>
    </Page>
  );
}
```

Adjust props to the real `UserIdentity` / `Row` / `Loading` signatures if they differ (open the components — `main-switch-identity.tsx` and `classes-page.tsx` show live usage). Eyeball the screen per the project's UI approach; refine spacing/labels then.

- [ ] **Step 6: Typecheck, biome, pause for user gate, commit on approval**

```bash
pnpm -r typecheck
pnpm biome
git add apps/www
git commit -m "feat(www): super-admin zone, gated New class, menu link"
```

---

### Task 7: HUMAN VALIDATION GATE (no code)

- [ ] **Step 1: Run the app and walk the feature with the user**

```bash
pnpm --filter @roster/api run preview
```

(HTTPS dev server on `https://localhost:3000`; ensure `SUPER_ADMIN_EMAILS` in `apps/api/.dev.vars` contains the email the user signs in with.)

Walk, in order:
1. Signed in as the admin: account menu shows **Super admin** → `/admin` lists users, filter narrows as you type, toggling a user flips and persists (reload).
2. `/api/me` (browser devtools) shows `isSuperAdmin: true, canCreateClasses: true`.
3. As a NON-admin, NON-creator user (second browser/profile): no menu item; `/admin` bounces to `/classes`; classes hub shows no "New class"; connecting an org anyway (paste the install URL) lands on connect-failed with "Your account isn't allowed to create classes" highlighted.
4. Grant that user from the admin zone → "New class" appears (after reload/revalidate) and connecting an org creates the class.
5. Reconfigure/reinstall on an EXISTING class still works for a non-creator (repair path ungated).

Do not proceed to Tasks 8–9 until the user says the feature is right.

---

### Task 8: API tests

**Files:**
- Create: `apps/api/test/admin.test.ts`
- Modify: `apps/api/test/setup.test.ts` (gate cases)
- Modify: `apps/api/test/me.test.ts` (two new fields)

Open `apps/api/test/me.test.ts` and `apps/api/test/setup.test.ts` FIRST and reuse their harness verbatim (how they build the app, fake the session, seed D1 via `cloudflare:test`). The cases below are the contract; express them in that harness's idiom.

- [ ] **Step 1: Write `admin.test.ts` — the guard**

Cases:
- no session → `GET /api/admin/users` is 401 `{ error: "unauthorized" }`;
- session whose email is NOT in `SUPER_ADMIN_EMAILS` → 403 `{ error: "forbidden" }`;
- email matching case-insensitively with spaces (`" Admin@X.CH ,other@y.ch"` vs `admin@x.ch`) → 200;
- `SUPER_ADMIN_EMAILS` unset/empty → 403 for everyone (fail closed).

- [ ] **Step 2: `admin.test.ts` — list + toggle**

Cases:
- list: two seeded users, one with a `class_creators` row → their `canCreateClasses` are `true`/`false`; shape is `{ users: [{ id, name, email, createdAt, canCreateClasses }] }`.
- toggle on: `PUT …/class-creator` `{ enabled: true }` → 200, row exists; repeat → still 200, one row (idempotent).
- toggle off twice → 200 both times, no row.
- unknown user id → 404 `{ error: "not_found" }`.

- [ ] **Step 3: setup gate cases in `setup.test.ts`**

- new-class path, session user WITHOUT grant → redirect to `/?error=not_class_creator`, `classes` table stays empty;
- WITH a `class_creators` row → class created (existing happy-path assertions);
- with admin email in `SUPER_ADMIN_EMAILS` → class created;
- EXISTING class (repair path) with a caller who has no grant → update still happens (assert unchanged behavior).

- [ ] **Step 4: me cases in `me.test.ts`**

- signed out → `isSuperAdmin: false, canCreateClasses: false`;
- signed in, granted but not admin → `false` / `true`;
- signed in, admin → `true` / `true`.

- [ ] **Step 5: Run, then commit on approval**

```bash
pnpm --filter @roster/api test
pnpm biome
git add apps/api/test
git commit -m "test(api): super-admin guard, admin zone, setup gate, me fields"
```

---

### Task 9: Frontend tests

**Files:**
- Create: `apps/www/test/admin-page.test.tsx`
- Modify: `apps/www/test/classes-page.test.tsx`

Open `apps/www/test/classes-page.test.tsx` first and reuse its harness (how it mocks `/api/me` and other fetches, providers, router). Express these cases in that idiom:

- [ ] **Step 1: `admin-page.test.tsx`**

- with `isSuperAdmin: true`: users render; typing in the filter narrows the list by name and by email; toggling a row issues `PUT /api/admin/users/<id>/class-creator` with `{ enabled: … }`.
- with `isSuperAdmin: false`: the page renders nothing (navigation stub called with `/classes`).

- [ ] **Step 2: classes hub gating in `classes-page.test.tsx`**

- `canCreateClasses: false` → no "New class" trigger in the document, empty-hub copy has no `"New class"` reference;
- `canCreateClasses: true` → the trigger renders (existing assertions keep passing).

- [ ] **Step 3: Run everything, commit on approval**

```bash
pnpm --filter @roster/www test
pnpm -r typecheck
pnpm biome
git add apps/www/test
git commit -m "test(www): admin zone + gated New class"
```

---

### Task 10: Docs + demo rollout

**Files:**
- Modify: `DEPLOY.md` (phase 2 `vars` block + a line in "Redeploys": set `SUPER_ADMIN_EMAILS` or class creation is locked)
- Modify: `AGENTS.md` only if it lists env vars (check; skip otherwise)

- [ ] **Step 1: Document the var in `DEPLOY.md`**

Add `"SUPER_ADMIN_EMAILS": "<admin1@…,admin2@…>"` to the phase-2 `vars` example with the fail-closed warning sentence: "Empty means nobody can create classes."

- [ ] **Step 2: Deploy to the demo, smoke-test, commit on approval**

```bash
pnpm --filter @roster/api exec wrangler d1 migrations apply labs --remote --config wrangler.demo.jsonc
pnpm --filter @roster/www build
pnpm --filter @roster/api run deploy:demo
```

Verify on `https://roster.stefan-teofanov.workers.dev`: admin menu item for the user's account, grant/revoke round-trips, non-creator refused. Then:

```bash
git add DEPLOY.md
git commit -m "docs: SUPER_ADMIN_EMAILS in the deploy guide"
```
