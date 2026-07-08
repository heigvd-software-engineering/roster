# Reconcile on Demand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop every `GET` route from mutating the database, and give teachers an explicit Reconcile action that owns the roster.

**Architecture:** Six features, each independently shippable and verifiable in a browser. Each owns one thing GitHub is authoritative for, and moves its cache write out of a `GET` and behind an explicit action.

**Tech Stack:** Hono + Cloudflare Workers + D1, Drizzle ORM, Vitest (`@cloudflare/vitest-pool-workers` for the API, jsdom for the SPA), React Router 7, Tailwind v4, Biome.

**Spec:** `docs/superpowers/specs/2026-07-08-reconcile-on-demand-design.md`

## Features

| # | Feature | Owns | Depends on |
|---|---|---|---|
| **F1** | Read-path safety net | the `catch {}` bug; `callerGithub` | — |
| **F2** | Repo-name uniqueness | `labs: unique(classId, title)`; `409 title_taken` | — |
| **F3** | Class reconcile | the `classes` row — `installationId`, `login`, `name`, `avatarUrl` | F1 |
| **F4** | Roster reconcile | `class_members`; `rosterSyncedAt`; the popover button | F1, F3 |
| **F5** | Group team recovery | `teamMissing`; `POST .../groups/:groupId/team` | F2 |
| **F6** | Join confirmation | `POST /join/:token/confirm` | — |

```
F1 ──▶ F3 ──▶ F4      writes leave the hub, one cache at a time
F2 ──▶ F5             the constraint, then the marker that makes it reachable
F6                    independent; ship anywhere
```

**F3 and F4 share one endpoint and one button.** `POST /api/classes/:id/reconcile` is introduced by F3 (class row) and extended by F4 (roster). The teacher sees a single *Reconcile* in the students popover — `login` and `avatarUrl` free-ride off `/user/installations`, so only `name` and the roster need the button. Two buttons would put two chores in front of a teacher who thinks of it as one thing: *make this class right*.

**F2 must precede F5.** Once a missing team stops deleting the group row, a re-created group can adopt an existing repo. Without `unique(classId, title)`, two labs sharing a title let that adoption cross labs — one lab's student work under another lab's group. F5 is what makes that path reachable.

**F1 is a prerequisite, not a feature.** It fixes a live bug: a failing `syncRoster` currently deletes a teacher's class from their own hub. It also extracts `callerGithub`, which F3 and F4 both consume.

**Intermediate states are honest, not broken.** After F3 the hub still calls `orgPeople` and still runs `syncRoster` (fail-open, from F1) — it just no longer writes the `classes` row. After F4 the hub makes one GitHub call per class and writes nothing at all.


## Global Constraints

- **TDD, no exceptions.** Write the failing test, run it, watch it fail *for the right reason*, then implement. A test that has never failed proves nothing.
- **Verify before claiming.** Run the command, read the output. Never report a pass you did not observe.
- API tests: `pnpm --filter @labs/api test`
- SPA tests: `pnpm --filter @labs/www test`
- Typecheck: `pnpm --filter @labs/api exec tsc --noEmit` and `pnpm --filter @labs/www exec tsc --noEmit`
- Lint/format: `pnpm biome` (check), `pnpm biome check --write .` (fix)
- Migrations: generate with `pnpm --filter @labs/db db:generate`, apply with `pnpm --filter @labs/api exec wrangler d1 migrations apply labs --local`
- Drizzle emits `unique()` on SQLite as `CREATE UNIQUE INDEX` — one statement, no table rebuild.
- Every commit message ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- `class_members` is a **display cache**. No endpoint may authorize against it. Authorization always reads live GitHub state.
- Never delete a GitHub repository. Nothing in `apps/api/src` does today; keep it that way.


## F1 — Read-path safety net

`classes.ts:132-198` wraps the teacher check, three cache writes, and the DTO build in one `try { … } catch {}`. A failing `syncRoster` — a best-effort, self-healing, non-authoritative cache write — currently removes the teacher's class from their own hub. This is a live bug, independent of the rest of the spec.

The narrowing must be **structural**: wrap only the GitHub fetches. `classes-list.test.ts:39-45` mocks `orgInfo` to throw a plain `Error` with no `.status`, so any "does the error have a status?" heuristic silently breaks the existing skip-on-GitHub-failure test.

### Task 1.1: Extract `callerGithub`

The caller's GitHub identity is derived twice — `handlers/classes.ts:60-67` and `lib/access.ts:131-137` — each re-deriving the `Number.isFinite` invariant on a TEXT column. `classes.ts` also needs the raw string (`classMembers.githubId` comparisons at `:213`, `:290`), so return both.

**Files:**
- Modify: `apps/api/src/lib/access.ts`
- Modify: `apps/api/src/handlers/classes.ts:60-67`
- Test: `apps/api/test/caller.test.ts` (create)

**Interfaces:**
- Produces: `callerGithub(db: Db, userId: string): Promise<{ ghId: number; githubId: string } | null>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/caller.test.ts`:

```ts
import { env } from "cloudflare:test";
import { account, getDb, user } from "@labs/db";
import { beforeEach, expect, test } from "vitest";
import { callerGithub } from "../src/lib/access";

const db = getDb(env.DB);
const now = new Date();

beforeEach(async () => {
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@x.ch" });
});

const linkGithub = (accountId: string) =>
  db.insert(account).values({
    id: `a-${accountId}`,
    userId: "u1",
    providerId: "github",
    accountId,
    createdAt: now,
    updatedAt: now,
  });

test("returns the numeric id and the raw accountId", async () => {
  await linkGithub("61272178");
  expect(await callerGithub(db, "u1")).toEqual({
    ghId: 61272178,
    githubId: "61272178",
  });
});

test("returns null when no GitHub account is linked", async () => {
  expect(await callerGithub(db, "u1")).toBeNull();
});

test("returns null when accountId is not numeric", async () => {
  // accountId is a TEXT column; a non-numeric value is as good as absent.
  await linkGithub("not-a-number");
  expect(await callerGithub(db, "u1")).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @labs/api exec vitest run test/caller.test.ts
```

Expected: `Failed to resolve import` / `callerGithub is not exported`.

- [ ] **Step 3: Implement**

Add to `apps/api/src/lib/access.ts` (near the top, after the `Db` type):

```ts
/**
 * The caller's GitHub identity, both forms. `account.accountId` is a TEXT
 * column: for the `github` provider it holds a numeric id, and a value that
 * isn't numeric is as good as absent. Callers need the number (GitHub APIs)
 * and the string (`class_members.githubId` comparisons).
 */
export async function callerGithub(
  db: Db,
  userId: string,
): Promise<{ ghId: number; githubId: string } | null> {
  const row = await db.query.account.findFirst({
    where: (a, op) =>
      op.and(op.eq(a.userId, userId), op.eq(a.providerId, "github")),
    columns: { accountId: true },
  });
  if (!row) return null;
  const ghId = Number(row.accountId);
  return Number.isFinite(ghId) ? { ghId, githubId: row.accountId } : null;
}
```

If `access.ts` has no exported `Db` type alias, add `type Db = ReturnType<typeof getDb>;`.

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter @labs/api exec vitest run test/caller.test.ts
```

Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Replace both call sites**

In `apps/api/src/lib/access.ts`, inside `resolveClassAsTeacher`, replace the inline `db.query.account.findFirst` block with:

```ts
  const caller = await callerGithub(db, c.get("user").id);
  if (!caller) return null;
```

and use `caller.ghId` in the `isOrgAdmin` call.

In `apps/api/src/handlers/classes.ts`, replace `:60-69` with:

```ts
  const caller = await callerGithub(db, callerUser.id);
  const token = await githubAccessToken(c.env, callerUser.id);
  if (!caller || !token) {
    return c.json({ classes: [], enrolled: [], hasOlder: false });
  }
```

Then replace every later `ghId` with `caller.ghId`, and every `ghAccount.accountId` (`:213`, `:290`) with `caller.githubId`. Rename the existing `const caller = c.get("user")` to `callerUser` to avoid shadowing.

- [ ] **Step 6: Full suite, typecheck, lint**

```bash
pnpm --filter @labs/api test
pnpm --filter @labs/api exec tsc --noEmit
pnpm biome
```

Expected: all API tests pass, `tsc` exit 0, biome reports no findings.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/access.ts apps/api/src/handlers/classes.ts apps/api/test/caller.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): extract callerGithub

The caller's GitHub identity was derived twice — handlers/classes.ts:60 and
lib/access.ts:131 — each re-deriving the Number.isFinite invariant that exists
because account.accountId is a TEXT column. One function, two call sites.

Returns both forms: the number (GitHub APIs) and the string
(class_members.githubId comparisons).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.2: Fence the per-class loop

**Files:**
- Modify: `apps/api/src/handlers/classes.ts:129-198`
- Test: `apps/api/test/classes-list.test.ts`

**Interfaces:**
- Consumes: `callerGithub` (Task 1.1)
- Produces: nothing new; behavior change only

- [ ] **Step 1: Write the failing test**

`classes-list.test.ts` does not currently mock `../src/lib/enrollment`. Add a mock with a togglable failure, next to the other `vi.mock` calls:

```ts
const syncRosterMock = vi.hoisted(() =>
  vi.fn(async () => {
    if (state.failSyncRoster) throw new Error("simulated D1 failure");
  }),
);
vi.mock("../src/lib/enrollment", () => ({ syncRoster: syncRosterMock }));
```

Add `failSyncRoster: false` to the `state` object, and reset it in `beforeEach`.

Then the test:

```ts
test("a failing roster sync does not hide the teacher's class", async () => {
  // syncRoster writes a DISPLAY CACHE. It is best-effort and self-healing.
  // It must never take down a live, authorized read.
  await seedClass();               // use whatever helper the file already has
  state.failSyncRoster = true;

  const res = await app.request("/api/classes", {}, env);

  expect(res.status).toBe(200);
  const body = (await res.json()) as { classes: Array<{ id: string }> };
  expect(body.classes).toHaveLength(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @labs/api exec vitest run test/classes-list.test.ts -t "failing roster sync"
```

Expected: FAIL — `expected 0 to be 1`. The `catch {}` swallowed the throw and `continue`d past `out.push`.

- [ ] **Step 3: Implement — structural narrowing**

Replace the body of the `for (const cls of rows)` loop in `apps/api/src/handlers/classes.ts` with:

```ts
  for (const cls of rows) {
    const live = byOrgId.get(cls.orgId);
    if (!live) continue; // App uninstalled from this org — skip.

    // ONLY the GitHub fetches are skippable. An org can rate-limit, revoke its
    // installation, or vanish; that is this class's problem, not the request's.
    // Everything below is ours, and a failure there is a bug, not org state.
    let people: Awaited<ReturnType<typeof orgPeople>>;
    let org: Awaited<ReturnType<typeof orgInfo>>;
    try {
      // Independent calls — one round trip instead of two.
      [people, org] = await Promise.all([
        orgPeople(c.env, live.installationId, live.login),
        orgInfo(c.env, live.installationId, live.login),
      ]);
    } catch {
      continue;
    }

    // F5a: only live org Owners see the class. Never the cache.
    if (!people.teachers.some((t) => t.id === caller.ghId)) continue;

    // The reconciliation writes are a BEST-EFFORT cache refresh (data-model
    // spec §2: drift self-heals, and never affects access control). A failure
    // here must not remove a class the caller is demonstrably a teacher of.
    await reconcileClass(db, cls, live, org, people).catch((err) => {
      console.warn("class reconcile failed", { classId: cls.id, err });
    });

    const users = await linkedUsers(
      db,
      [...people.teachers, ...people.students].map((p) => String(p.id)),
    );
    out.push({
      id: cls.id,
      orgId: cls.orgId,
      createdAt: cls.createdAt,
      joinToken: cls.joinToken,
      login: org.login,
      name: org.name,
      avatarUrl: org.avatarUrl,
      teachers: people.teachers,
      students: people.students,
      pending: people.pending,
      users,
      labs: labRows.filter((l) => l.classId === cls.id),
    });
  }
```

And add, above `listClasses`:

```ts
/**
 * The three cache writes a teacher's visit pays for, in one named place: the
 * installation pointer (§backstop), the org identity cache, and the enrollment
 * display cache. All best-effort — the caller's own view does not depend on any
 * of them succeeding. F3 and F4 move these behind the Reconcile button.
 */
async function reconcileClass(
  db: ReturnType<typeof getDb>,
  cls: typeof classes.$inferSelect,
  live: { installationId: number; login: string },
  org: { login: string; name: string | null; avatarUrl: string },
  people: Awaited<ReturnType<typeof orgPeople>>,
) {
  const now = new Date();
  if (live.installationId !== cls.installationId) {
    await db
      .update(classes)
      .set({ installationId: live.installationId, updatedAt: now })
      .where(eq(classes.orgId, cls.orgId));
  }
  const observed = (p: OrgPerson) => ({
    githubId: String(p.id),
    login: p.login,
    avatarUrl: p.avatarUrl,
  });
  await syncRoster(db, cls.id, {
    active: people.students.map(observed),
    pending: people.pending.map(observed),
    teacher: people.teachers.map(observed),
  });
  if (
    org.login !== cls.login ||
    org.name !== cls.name ||
    org.avatarUrl !== cls.avatarUrl
  ) {
    await db
      .update(classes)
      .set({
        login: org.login,
        name: org.name,
        avatarUrl: org.avatarUrl,
        updatedAt: now,
      })
      .where(eq(classes.id, cls.id));
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter @labs/api test
```

Expected: `Tests  113 passed (113)` — 112 existing plus the new one. The pre-existing "skips a class whose GitHub calls fail" test must still pass: `orgInfo` throws a plain `Error`, and it is now inside the narrowed `try`.

- [ ] **Step 5: Verify the red was real**

```bash
git stash push apps/api/src/handlers/classes.ts
pnpm --filter @labs/api exec vitest run test/classes-list.test.ts -t "failing roster sync"
git stash pop
```

Expected while stashed: FAIL. If it passes, the test is not testing the fix.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/handlers/classes.ts apps/api/test/classes-list.test.ts
git commit -m "$(cat <<'EOF'
fix(api): a failing cache write no longer hides a teacher's class

listClasses wrapped the teacher check, three cache writes, and the DTO build in
one bare `catch {}`. Its comment blames "rate limit, revoked install" — but the
try also covered syncRoster and two db.update calls. A D1 hiccup or a constraint
violation was indistinguishable from a revoked installation: the class silently
vanished from the teacher's hub, with no log.

syncRoster writes a DISPLAY CACHE. The data-model spec says its drift
self-heals and never affects access control. It must not take down a live,
authorized read.

Narrowed structurally, not heuristically: only the GitHub fetches sit in the
skippable try. (classes-list.test.ts mocks orgInfo to throw a plain Error with
no .status, so an error-shape heuristic would have silently broken the existing
skip-on-GitHub-failure test.) The cache writes are now a named reconcileClass()
that fails open and logs. Anything else propagates as a 500, which is what a bug
should do.

orgPeople and orgInfo are independent and now run in parallel.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F1 feature test

Automated:

```bash
pnpm --filter @labs/api test        # expect: all pass
pnpm --filter @labs/www test        # expect: all pass (untouched)
pnpm --filter @labs/api exec tsc --noEmit
pnpm biome
```

Manual, in the browser:

1. `pnpm --filter @labs/api dev` and `pnpm --filter @labs/www dev`
2. Sign in as the teacher (`Ovich`). The hub lists your classes as before.
3. Class cards show the same people counts as before this gate.

**Nothing user-visible should change.** This gate only removes a failure mode.

---

## F2 — Repo-name uniqueness

A group's slug — and therefore its repo name — is `` `${slugify(lab.title)}-${slugify(group.name)}` `` (`lib/groups.ts:59`). The DB enforces only `unique(labId, slug)` (`app-schema.ts:101`) — per lab, not per org — and `labs.title` has no constraint at all. Two labs titled "Lab 1", each with a group "Alpha", compute the same repo name in the same org. GitHub's team-name 422 hides this only while the first team lives; once it is gone (F5), the second lab's group **adopts the first lab's repo**.

### Task 2.1: Check production first

- [ ] **Step 1: Run the duplicate check against both databases**

```bash
cd apps/api
pnpm exec wrangler d1 execute DB --local \
  --command "SELECT class_id, title, COUNT(*) AS n FROM labs GROUP BY class_id, title HAVING n > 1;"
pnpm exec wrangler d1 execute DB --remote \
  --command "SELECT class_id, title, COUNT(*) AS n FROM labs GROUP BY class_id, title HAVING n > 1;"
```

Expected: `"results": []` for both. **If production returns rows, STOP** — the migration will fail on apply. Rename the duplicates by hand first, then continue.

### Task 2.2: The constraint

**Files:**
- Modify: `packages/db/src/app-schema.ts:37-59`
- Create: `packages/db/migrations/0011_lab_title_unique.sql` (generated)
- Modify: `apps/api/src/handlers/labs.ts`
- Test: `apps/api/test/labs.test.ts`

**Interfaces:**
- Produces: `409 { error: "title_taken" }` from `createLab` and `updateLab`

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/labs.test.ts`:

```ts
test("two labs in one class cannot share a title", async () => {
  // The repo name is slugify(title)-slugify(groupName). Duplicate titles mean
  // two labs' groups compute the same repo name in the same org.
  const first = await createLab({ title: "Lab 1" });
  expect(first.status).toBe(200);

  const second = await createLab({ title: "Lab 1" });

  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: "title_taken" });
});

test("renaming a lab onto another lab's title is refused", async () => {
  const a = await createLab({ title: "Lab 1" });
  await createLab({ title: "Lab 2" });
  const { id } = (await a.json()) as { id: string };

  const res = await updateLab(id, { title: "Lab 2" });

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "title_taken" });
});

test("a lab keeps its own title on update", async () => {
  const a = await createLab({ title: "Lab 1" });
  const { id } = (await a.json()) as { id: string };

  const res = await updateLab(id, { title: "Lab 1", deadline: "2099-01-01T00:00:00.000Z" });

  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @labs/api exec vitest run test/labs.test.ts
```

Expected: the first two FAIL with `expected 200 to be 409`.

- [ ] **Step 3: Add the constraint to the schema**

In `packages/db/src/app-schema.ts`, convert the `labs` table to the two-argument form:

```ts
export const labs = sqliteTable(
  "labs",
  {
    // …existing columns, unchanged…
  },
  // The group slug — and so the WORK REPO NAME — is
  // slugify(lab.title)-slugify(group.name). Without this, two labs in one class
  // can share a title and their groups compute the same repo name in the same
  // org; repo adoption would then attach one lab's work to another lab's group.
  (t) => [unique().on(t.classId, t.title)],
);
```

- [ ] **Step 4: Generate and apply the migration**

```bash
pnpm --filter @labs/db db:generate
```

Rename the generated file to `packages/db/migrations/0011_lab_title_unique.sql` and update `packages/db/migrations/meta/_journal.json` accordingly. Confirm its contents are a single statement:

```sql
CREATE UNIQUE INDEX `labs_class_id_title_unique` ON `labs` (`class_id`,`title`);
```

Then:

```bash
pnpm --filter @labs/api exec wrangler d1 migrations apply labs --local
```

- [ ] **Step 5: Guard in the handlers**

In `apps/api/src/handlers/labs.ts`, in `createLab`, before the insert:

```ts
  const [clash] = await access.db
    .select({ id: labs.id })
    .from(labs)
    .where(and(eq(labs.classId, access.cls.id), eq(labs.title, input.title)));
  if (clash) return c.json({ error: "title_taken" }, 409);
```

In `updateLab`, the same, excluding the lab being edited:

```ts
  const [clash] = await access.db
    .select({ id: labs.id })
    .from(labs)
    .where(
      and(
        eq(labs.classId, access.cls.id),
        eq(labs.title, input.title),
        ne(labs.id, lab.id),
      ),
    );
  if (clash) return c.json({ error: "title_taken" }, 409);
```

Import `ne` from `drizzle-orm`. The DB index is the backstop; these give a clean 409 instead of a 500.

- [ ] **Step 6: Surface it in the SPA**

In `apps/www/app/components/custom/classes/labs/lab-dialog.tsx`, add to the error map:

```ts
      case "title_taken":
        return "A lab with that title already exists in this class.";
```

And in `apps/www/test/lab-dialog.test.tsx`:

```tsx
it("names a duplicate title", async () => {
  mockSubmitError({ error: "title_taken" }, 409);
  render(<LabDialog classId="c1" />);
  fireEvent.click(screen.getByRole("button", { name: /New lab/ }));
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Lab 1" } });
  fireEvent.click(screen.getByRole("button", { name: "Create lab" }));

  expect(
    await screen.findByText("A lab with that title already exists in this class."),
  ).toBeInTheDocument();
});
```

Match `mockSubmitError` to whatever helper the file already uses; if none exists, drive the error through the existing `useApi` mock the way `new-class-dialog.test.tsx` does.

- [ ] **Step 7: Run everything**

```bash
pnpm --filter @labs/api test
pnpm --filter @labs/www test
pnpm --filter @labs/api exec tsc --noEmit
pnpm --filter @labs/www exec tsc --noEmit
pnpm biome
```

- [ ] **Step 8: Commit**

```bash
git add packages/db apps/api/src/handlers/labs.ts apps/api/test/labs.test.ts apps/www
git commit -m "$(cat <<'EOF'
feat(db): a lab title is unique within its class

A group's slug — and therefore its WORK REPO NAME — is
slugify(lab.title)-slugify(group.name) (lib/groups.ts:59). The database enforced
only unique(labId, slug) and unique(labId, name): per lab, not per org. And
labs.title had no constraint at all.

So two labs in one class both titled "Lab 1", each with a group "Alpha", compute
the same repo name in the same org. GitHub's team-name 422 blocks the second
TEAM today — but only while the first team lives. Once it is gone, the second
lab's group creates its team and then adopts the first lab's repo: one lab's
student work, under another lab's group, silently.

unique(classId, title) makes the slug genuinely org-unique, so repo adoption can
only ever re-attach a repo to the group that owns it. createLab/updateLab return
409 title_taken; the index is the backstop.

Drizzle emits this as CREATE UNIQUE INDEX — one statement, no table rebuild. It
fails on existing duplicates: both local and remote were checked clean first.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F2 feature test

1. Teacher hub → a class → **New lab**, title `Lab 1`. Created.
2. **New lab** again, title `Lab 1`. The dialog shows *"A lab with that title already exists in this class."* and the lab is not created.
3. Edit `Lab 1` → change the deadline, keep the title → saves.
4. Create `Lab 2`, then rename it to `Lab 1` → refused with the same message.

---

## F3 — Class reconcile

`githubSetupCallback` bails on four preconditions before its upsert (`setup.ts:24,27,31,34`). Three are insert-strength checks — session, linked GitHub, `userHasInstallation` — wrongly applied to a *repair*. `installationAccount` runs on the App's own JWT, so **GitHub names the org**, not the caller: the `WHERE` is not attacker-controlled.

### Task 3.1: Session-less repair

**Files:**
- Modify: `apps/api/src/handlers/setup.ts`
- Test: `apps/api/test/setup.test.ts`

**Interfaces:**
- Consumes: `installationAccount(env, installationId): Promise<{ id, login, isOrganization } | null>` (`lib/github/app.ts:11`)

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/setup.test.ts` (match the file's existing mock/seed helpers):

```ts
test("repairs a stale installationId with NO session", async () => {
  await seedClass({ orgId: 42, installationId: 200, status: "active" });
  state.session = null;                       // logged out
  state.githubToken = null;                   // no linked GitHub either
  state.installAccount = { id: 42, login: "acme", isOrganization: true };

  const res = await app.request("/api/github/setup?installation_id=999", {}, env);

  expect(res.status).toBe(302);
  const [row] = await db.select().from(classes).where(eq(classes.orgId, 42));
  expect(row?.installationId).toBe(999);
});

test("a session-less repair never touches status, joinToken or provenance", async () => {
  await seedClass({
    orgId: 42,
    installationId: 200,
    status: "active",
    joinToken: "keep-me",
    connectedByUserId: "u1",
  });
  state.session = null;
  state.installAccount = { id: 42, login: "acme", isOrganization: true };

  await app.request("/api/github/setup?installation_id=999", {}, env);

  const [row] = await db.select().from(classes).where(eq(classes.orgId, 42));
  expect(row).toMatchObject({
    installationId: 999,
    joinToken: "keep-me",
    connectedByUserId: "u1",
    status: "active",
  });
});

test("a session-less callback cannot CREATE a class", async () => {
  state.session = null;
  state.installAccount = { id: 77, login: "other", isOrganization: true };

  const res = await app.request("/api/github/setup?installation_id=999", {}, env);

  expect(res.status).toBe(302);
  expect(await db.select().from(classes)).toHaveLength(0);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @labs/api exec vitest run test/setup.test.ts
```

Expected: the first two FAIL (`installationId` still `200` — the handler redirected at `if (!session)`).

- [ ] **Step 3: Implement**

Rewrite `apps/api/src/handlers/setup.ts`'s handler body:

```ts
export const githubSetupCallback = factory.createHandlers(async (c) => {
  const installationId = Number(c.req.query("installation_id"));
  if (!installationId) return c.redirect("/?error=no_installation");

  // The App's own JWT answers "which account owns this installation?". GitHub,
  // not the caller, names the org — so nothing below is attacker-controlled.
  const acct = await installationAccount(c.env, installationId);
  if (!acct?.isOrganization) return c.redirect("/?error=not_an_org");

  const db = getDb(c.env.DB);
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  const [existing] = await db
    .select()
    .from(classes)
    .where(eq(classes.orgId, acct.id));

  if (existing) {
    // REPAIR. A reinstall mints a new installation id, and the Setup URL fires
    // in whatever browser performed it — possibly with no labs cookie (org
    // settings page; a second org owner who never signed in here). The repair
    // needs no session because the org id came from GitHub.
    //
    // Pointer ONLY. `status` is excluded so a session-less call can never
    // resurrect a deactivated class; joinToken and provenance are never touched.
    if (existing.installationId !== installationId) {
      await db
        .update(classes)
        .set({ installationId, updatedAt: new Date() })
        .where(eq(classes.orgId, acct.id));
    }
    return c.redirect(session ? `/classes/${existing.id}/confirm` : "/");
  }

  // CREATE. Now provenance matters: attribute the class, and prove the caller
  // really holds this installation (ids are small enumerable ints, so a signed-in
  // user could otherwise claim any org's installation as their own class).
  if (!session) return c.redirect("/");
  const token = await githubAccessToken(c.env, session.user.id);
  if (!token) return c.redirect("/?error=github_not_linked");
  if (!(await userHasInstallation(token, installationId))) {
    return c.redirect("/?error=not_your_installation");
  }

  const now = new Date();
  const [cls] = await db
    .insert(classes)
    .values({
      id: crypto.randomUUID(),
      orgId: acct.id,
      installationId,
      connectedByUserId: session.user.id,
      joinToken: mintJoinToken(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!cls) throw new Error("class insert returned no row");
  return c.redirect(`/classes/${cls.id}/confirm`);
});
```

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm --filter @labs/api test
```

Expected: all pass, including the pre-existing "upsert is keyed on orgId (reinstall updates, no duplicate)" and "reinstall must not rotate the join token" tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handlers/setup.ts apps/api/test/setup.test.ts
git commit -m "$(cat <<'EOF'
fix(api): repair a stale installationId without a session

A reinstall mints a new installation id. githubSetupCallback recorded it, but
bailed on four preconditions first — no labs session, no linked GitHub, the
caller doesn't hold the installation, not an org. A teacher reinstalling from
GitHub's org-settings page without a labs cookie, or a second org owner who has
never signed in here, trips them: GitHub fires the Setup URL, the callback
redirects, and the row keeps the dead id.

Three of those four are insert-strength checks applied to a repair.
installationAccount() runs on the App's own JWT, so GitHub — not the caller —
names the org that owns the installation. An attacker passing an arbitrary
installation_id cannot choose the WHERE: GitHub resolves it to that
installation's true org, and an App has exactly one installation per org. The
worst achievable write is the correct value, or a no-op.

Repair now runs before any session check, and writes the pointer ONLY: `status`
is excluded so a session-less call can never resurrect a deactivated class;
joinToken and connectedByUserId are never touched. Create still requires a
session and userHasInstallation.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.2: The class-reconcile endpoint

**Files:**
- Create: `apps/api/src/handlers/reconcile.ts`
- Modify: `apps/api/src/routes/classes.ts`
- Test: `apps/api/test/reconcile.test.ts` (create)

**Interfaces:**
- Consumes: `callerGithub` (Task 1.1)
- Produces: `POST /api/classes/:id/reconcile` → `200 { login, name, avatarUrl, installationId }`. F4 extends this response with the roster counts.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/reconcile.test.ts`. Mock `../src/lib/github/org` with `isOrgAdmin: async () => state.isOrgAdmin` and `orgInfo`, and `../src/lib/github/user` with `userInstallationsByOrgId` — copy the mock shapes from `classes-list.test.ts:37-66`.

```ts
test("reconcile refreshes the class row and returns it", async () => {
  await seedClass({ orgId: 42, installationId: 200, login: "stale", name: "Stale" });
  state.org = { login: "acme", name: "Acme", avatarUrl: "http://a" };

  const res = await app.request("/api/classes/c1/reconcile", { method: "POST" }, env);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ login: "acme", name: "Acme" });
  const [row] = await db.select().from(classes);
  expect(row).toMatchObject({ login: "acme", name: "Acme", avatarUrl: "http://a" });
});

test("reconcile repairs a stale installationId it needed to authorize", async () => {
  // resolveClassAsTeacher authorizes via orgLogin(cls.installationId) — the
  // STORED pointer. If reconcile used it, the button advertised by
  // `class_needs_reconcile` could never fix the class it names. Reconcile
  // derives the live id from /user/installations first, then authorizes.
  await seedClass({ orgId: 42, installationId: 111 });   // live is 200

  const res = await app.request("/api/classes/c1/reconcile", { method: "POST" }, env);

  expect(res.status).toBe(200);
  const [row] = await db.select().from(classes);
  expect(row?.installationId).toBe(200);
});

test("reconcile is teacher-only", async () => {
  await seedClass({ orgId: 42, installationId: 200 });
  state.isOrgAdmin = false;

  const res = await app.request("/api/classes/c1/reconcile", { method: "POST" }, env);

  expect(res.status).toBe(404);
});

test("reconcile reports no_installation when the App is gone from the org", async () => {
  await seedClass({ orgId: 42, installationId: 200 });
  state.installations = [];   // /user/installations no longer lists it

  const res = await app.request("/api/classes/c1/reconcile", { method: "POST" }, env);

  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "no_installation" });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @labs/api exec vitest run test/reconcile.test.ts
```

Expected: all four 404 — the route does not exist.

- [ ] **Step 3: Implement**

Create `apps/api/src/handlers/reconcile.ts`:

```ts
/**
 * Teacher-only: make this class right. Refreshes everything GitHub owns about
 * the class row — the installation pointer and the org identity cache — that a
 * GET is no longer allowed to touch.
 *
 * Derives the installation id LIVE before authorizing. `resolveClassAsTeacher`
 * authorizes via `orgLogin(cls.installationId)` — the stored pointer — so a
 * stale one would make the button advertised by `class_needs_reconcile` unable
 * to fix the class it names.
 *
 * F4 extends this with the roster sync.
 */
export const reconcileClass = authedFactory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const userId = c.get("user").id;
  const caller = await callerGithub(db, userId);
  const token = await githubAccessToken(c.env, userId);
  if (!caller || !token) return c.json({ error: "not_found" }, 404);

  const [cls] = await db
    .select()
    .from(classes)
    .where(eq(classes.id, c.req.param("id")));
  if (!cls) return c.json({ error: "not_found" }, 404);

  // NOT cls.installationId — that is the value we may be here to repair.
  const live = (await userInstallationsByOrgId(token)).get(cls.orgId);
  if (!live) return c.json({ error: "no_installation" }, 403);

  // Live org Owner check. `class_members` may never authorize.
  if (!(await isOrgAdmin(c.env, live.installationId, live.login, caller.ghId))) {
    return c.json({ error: "not_found" }, 404);
  }

  const org = await orgInfo(c.env, live.installationId, live.login);
  const now = new Date();
  await db
    .update(classes)
    .set({
      installationId: live.installationId,
      login: org.login,
      name: org.name,
      avatarUrl: org.avatarUrl,
      updatedAt: now,
    })
    .where(eq(classes.id, cls.id));

  return c.json({
    installationId: live.installationId,
    login: org.login,
    name: org.name,
    avatarUrl: org.avatarUrl,
  });
});
```

Register in `apps/api/src/routes/classes.ts`:

```ts
  .post("/classes/:id/reconcile", ...reconcileClass)
```

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm --filter @labs/api test
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handlers/reconcile.ts apps/api/src/routes/classes.ts apps/api/test/reconcile.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /classes/:id/reconcile — refresh the class row

The teacher's explicit "make this class right" action. Refreshes the
installation pointer and the org identity cache — the two things a GET is about
to stop writing.

It derives the installation id live from /user/installations BEFORE authorizing.
resolveClassAsTeacher authorizes via orgLogin(cls.installationId), the stored
pointer, so a stale one would make this endpoint unable to fix the very class
that a `class_needs_reconcile` error pointed the user at.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.3: The hub stops writing the `classes` row

**Files:**
- Modify: `apps/api/src/handlers/classes.ts` (`reconcileClass` helper from Task 1.2 — rename it to `syncRosterCache`, since the class-row writes leave)
- Modify: `apps/api/src/lib/github/user.ts:51-73`
- Test: `apps/api/test/classes-list.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("the hub does not repair a stale installationId", async () => {
  // Repair belongs to the install callback (setup.ts) and to Reconcile.
  // A GET returns what it sees.
  await seedClass({ orgId: 42, installationId: 111 });  // live is 200
  await app.request("/api/classes", {}, env);

  const [row] = await db.select().from(classes).where(eq(classes.orgId, 42));
  expect(row?.installationId).toBe(111);
});

test("the hub does not refresh the org identity cache", async () => {
  await seedClass({ orgId: 42, installationId: 200, login: "stale", name: "Stale" });
  await app.request("/api/classes", {}, env);

  const [row] = await db.select().from(classes);
  expect(row).toMatchObject({ login: "stale", name: "Stale" });
});

test("the hub still renders a stale class correctly", async () => {
  // login and avatarUrl free-ride off /user/installations, which is already
  // fetched. `name` is optional on that payload, so it comes from the row.
  await seedClass({ orgId: 42, installationId: 200, login: "stale", name: "Stale" });
  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as { classes: Array<{ login: string; name: string | null }> };
  expect(body.classes[0]).toMatchObject({ login: "acme", name: "Stale" });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @labs/api exec vitest run test/classes-list.test.ts -t "hub does not"
```

Expected: `expected 200 to be 111` and `expected "acme" to be "stale"`.

- [ ] **Step 3: Widen `UserInstallation`**

`inst.account.avatar_url` is a **required `string`** on `GET /user/installations` (typechecked). `inst.account.name` is `string | null | undefined` there — optional, and therefore not trustworthy. Read the first two; never the third.

```ts
type UserInstallation = {
  installationId: number;
  login: string;
  avatarUrl: string;
};
```

and in `userInstallationsByOrgId`, add `avatarUrl: inst.account.avatar_url`.

- [ ] **Step 4: Implement**

In `apps/api/src/handlers/classes.ts`:

- Delete both `db.update(classes)` blocks from the `reconcileClass` helper, and rename it `syncRosterCache` — it now writes only `class_members`. (F4 deletes it entirely.)
- Delete the `orgInfo` call from the loop. `org.login`/`org.avatarUrl` become `live.login`/`live.avatarUrl`; `org.name` becomes `cls.name`.
- The `try` now wraps only `orgPeople`.

- [ ] **Step 5: Run and watch them pass**

```bash
pnpm --filter @labs/api test
pnpm --filter @labs/api exec tsc --noEmit
pnpm biome
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/handlers/classes.ts apps/api/src/lib/github/user.ts apps/api/test/classes-list.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): the hub stops writing the classes row

Two writes leave the GET. The installationId backstop is redundant now that
setup.ts repairs without a session, and Reconcile owns the org identity cache.

The card still renders correctly against a stale row: GET /user/installations is
already fetched to find the caller's orgs, and its payload carries each org's
login and avatar_url — userInstallationsByOrgId was throwing the avatar away.
`name` is optional on that payload (string | null | undefined), so it is NOT
trusted there and comes from the cached row until Reconcile refreshes it.

This also deletes one GitHub call per class from the hub: orgInfo existed only
to refresh a cache the GET no longer writes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F3 feature test

Automated: `pnpm --filter @labs/api test`, `tsc`, `pnpm biome`.

**A. The install callback repairs without a session** — the case `setup.ts` used to miss.

1. In GitHub, **uninstall** the `HeigVdLabs` App from `Test-TWeb-2026`.
2. Open a **private/incognito window** (no labs cookie).
3. Reinstall the App from `https://github.com/organizations/Test-TWeb-2026/settings/installations`.
4. GitHub redirects to `/api/github/setup?installation_id=<new>`. You land on `/`, not signed in.
5. Check the row:
   ```bash
   cd apps/api && pnpm exec wrangler d1 execute DB --local \
     --command "SELECT org_id, installation_id, join_token, connected_by_user_id, status FROM classes;"
   ```
   `installation_id` is the **new** id. `join_token`, `connected_by_user_id`, `status` are **unchanged**.
6. Sign in as the teacher. The hub loads and the class works.

**B. The hub no longer writes the class row.**

7. Corrupt it by hand:
   ```bash
   pnpm exec wrangler d1 execute DB --local \
     --command "UPDATE classes SET login='stale', name='Stale', installation_id=1;"
   ```
8. Reload the teacher hub. **The card still renders correctly** — `login` and the avatar come from `/user/installations`, which the hub already fetches. The class *name* shows `Stale`, because `name` is not on that payload.
9. Re-query. **All three columns are unchanged.** The GET read and wrote nothing.

**C. Reconcile fixes it.** In the browser console, on the app's origin (so the session cookie rides along):

```js
await fetch(`/api/classes/${classId}/reconcile`, { method: "POST" }).then(r => r.json())
```

10. Re-query: `login`, `name`, `installation_id` are all corrected. Note that step 7 set `installation_id=1` — a dead pointer — and Reconcile still authorized and fixed it, because it derives the live id before checking your role.

---

## F4 — Roster reconcile

### Task 4.1: `rosterSyncedAt`

**Files:**
- Modify: `packages/db/src/app-schema.ts` (`classes`)
- Create: `packages/db/migrations/0012_roster_synced_at.sql` (generated)

- [ ] **Step 1: Add the column**

```ts
  // NULL = never reconciled. Cannot be inferred from class_members row count:
  // the join POSTs insert rows into a class that has never been reconciled, and
  // a reconciled class with no students still has teacher rows.
  rosterSyncedAt: integer("roster_synced_at", { mode: "timestamp" }),
```

- [ ] **Step 2: Generate and apply**

```bash
pnpm --filter @labs/db db:generate
pnpm --filter @labs/api exec wrangler d1 migrations apply labs --local
```

Confirm the generated SQL is `ALTER TABLE \`classes\` ADD \`roster_synced_at\` integer;`

- [ ] **Step 3: Commit**

```bash
git add packages/db
git commit -m "$(cat <<'EOF'
feat(db): classes.rosterSyncedAt

NULL means the class roster has never been reconciled. It cannot be inferred
from class_members row count: the join POSTs insert rows into a class that has
never been reconciled, and a reconciled class with no students still has teacher
rows. The column states the fact directly, and doubles as the "Synced 2 days
ago" label.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.2: `syncRoster` reports what it did

**Files:**
- Modify: `apps/api/src/lib/enrollment.ts:68-117`
- Test: `apps/api/test/enrollment.test.ts` (create)

**Interfaces:**
- Produces: `syncRoster(...): Promise<{ added: number; removed: number }>`

- [ ] **Step 1: Write the failing test**

```ts
test("syncRoster reports what it added and removed", async () => {
  await observeMember(db, "c1", { githubId: "1", login: "old", avatarUrl: null }, "active");

  const result = await syncRoster(db, "c1", {
    active: [{ githubId: "2", login: "new", avatarUrl: null }],
    pending: [],
    teacher: [],
  });

  expect(result).toEqual({ added: 1, removed: 1 });
});

test("syncRoster promotes a member who became an org Owner", async () => {
  await observeMember(db, "c1", { githubId: "1", login: "prof", avatarUrl: null }, "active");

  const result = await syncRoster(db, "c1", {
    active: [],
    pending: [],
    teacher: [{ githubId: "1", login: "prof", avatarUrl: null }],
  });

  expect(result).toEqual({ added: 0, removed: 0 });
  const [row] = await db.select().from(classMembers);
  expect(row?.state).toBe("teacher");
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @labs/api exec vitest run test/enrollment.test.ts
```

Expected: `expected undefined to deeply equal { added: 1, removed: 1 }`.

- [ ] **Step 3: Implement**

In `apps/api/src/lib/enrollment.ts`, change `syncRoster`'s signature to
`Promise<{ added: number; removed: number }>`. Read the cached ids **before**
the delete, then diff. Every existing statement stays:

```ts
  const keep = [...roster.active, ...roster.pending, ...roster.teacher].map(
    (p) => p.githubId,
  );
  // Read before the delete: the counts describe what this sync changed, and the
  // button reports them. A silent destructive sync is how a teacher fails to
  // notice a student vanished.
  const before = await db
    .select({ githubId: classMembers.githubId })
    .from(classMembers)
    .where(eq(classMembers.classId, classId));
  const had = new Set(before.map((r) => r.githubId));
  const added = keep.filter((id) => !had.has(id)).length;
  const removed = before.filter((r) => !keep.includes(r.githubId)).length;

  // …existing delete + insert/onConflictDoUpdate, unchanged…

  return { added, removed };
```

A member who merely changes `state` (active → teacher) counts as neither: they
were there before and after. The second test pins that.

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm --filter @labs/api test
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/enrollment.ts apps/api/test/enrollment.test.ts
git commit -m "$(cat <<'EOF'
feat(api): syncRoster reports what it added and removed

The Reconcile button must say what it did. syncRoster returned nothing, so a
destructive sync — it deletes everyone no longer on the org roster — was silent.

Counts are taken before the delete and diffed against the live roster. A member
who only changes state (active -> teacher) counts as neither added nor removed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.3: Extend reconcile with the roster

`POST /api/classes/:id/reconcile` already exists (Task 3.2) and refreshes the
class row. This adds the roster sync and the `rosterSyncedAt` stamp to the same
endpoint, so the teacher keeps one button.

**Files:**
- Modify: `apps/api/src/handlers/reconcile.ts`
- Test: `apps/api/test/reconcile.test.ts`

**Interfaces:**
- Consumes: `syncRoster(...) -> { added, removed }` (Task 4.2), `rosterSyncedAt` (Task 4.1)
- Produces: `POST /api/classes/:id/reconcile` -> `200 { installationId, login, name, avatarUrl, students, pending, teachers, added, removed, syncedAt }`

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/reconcile.test.ts`:

```ts
test("reconcile syncs the roster and reports both directions", async () => {
  await seedClass({ orgId: 42, installationId: 200 });
  // A cached student who has since left the org.
  await observeMember(db, "c1", { githubId: "9", login: "gone", avatarUrl: null }, "active");
  state.people = {
    teachers: [{ id: 111, login: "prof", avatarUrl: null }],
    students: [{ id: 2, login: "student", avatarUrl: null }],
    pending: [],
  };

  const res = await app.request("/api/classes/c1/reconcile", { method: "POST" }, env);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    students: 1, pending: 0, teachers: 1, added: 2, removed: 1,
  });
  const rows = await db.select().from(classMembers);
  expect(rows.map((r) => r.githubId).sort()).toEqual(["111", "2"]);
});

test("reconcile stamps rosterSyncedAt", async () => {
  await seedClass({ orgId: 42, installationId: 200 });
  await app.request("/api/classes/c1/reconcile", { method: "POST" }, env);

  const [cls] = await db.select().from(classes);
  expect(cls?.rosterSyncedAt).not.toBeNull();
});

test("reconcile discovers a member who never used the join link", async () => {
  // Every OTHER write point observes exactly one person: the caller. Reconcile
  // is the only whole-roster operation, so it is the only thing that can find
  // someone a teacher invited directly on GitHub.
  await seedClass({ orgId: 42, installationId: 200 });
  state.people = {
    teachers: [],
    students: [{ id: 2, login: "walkin", avatarUrl: null }],
    pending: [],
  };

  const res = await app.request("/api/classes/c1/reconcile", { method: "POST" }, env);

  expect(await res.json()).toMatchObject({ added: 1, removed: 0 });
  const [row] = await db.select().from(classMembers);
  expect(row).toMatchObject({ githubId: "2", state: "active" });
});

test("reconcile promotes a member who became an org Owner", async () => {
  await seedClass({ orgId: 42, installationId: 200 });
  await observeMember(db, "c1", { githubId: "1", login: "prof", avatarUrl: null }, "active");
  state.people = {
    teachers: [{ id: 1, login: "prof", avatarUrl: null }],
    students: [], pending: [],
  };

  await app.request("/api/classes/c1/reconcile", { method: "POST" }, env);

  const [row] = await db.select().from(classMembers);
  expect(row?.state).toBe("teacher");
});

test("reconcile refuses to wipe the cache when GitHub fails", async () => {
  // syncRoster deletes EVERY row when the roster is empty (enrollment.ts:84-85).
  // orgPeople throws rather than returning empty, and that throw must propagate:
  // swallowing it would turn a rate limit into a roster wipe.
  await seedClass({ orgId: 42, installationId: 200 });
  await observeMember(db, "c1", { githubId: "7", login: "alice", avatarUrl: null }, "active");
  state.orgPeopleThrows = true;

  const res = await app.request("/api/classes/c1/reconcile", { method: "POST" }, env);

  expect(res.status).toBe(500);
  expect(await db.select().from(classMembers)).toHaveLength(1);
  const [cls] = await db.select().from(classes);
  expect(cls?.rosterSyncedAt).toBeNull();
});
```

Add `orgPeopleThrows: false` to `state`, reset it in `beforeEach`, and make the
`orgPeople` mock throw when it is set.

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @labs/api exec vitest run test/reconcile.test.ts
```

Expected: `expected {...} to match object { students: 1, ... }` — the response
has no roster fields yet, and `class_members` is untouched.

- [ ] **Step 3: Implement**

In `apps/api/src/handlers/reconcile.ts`, fetch the people alongside the org info,
sync, and stamp. `orgPeople` is NOT wrapped in a try: if GitHub fails, the whole
request must fail, or an empty roster would delete every cached member.

```ts
  const [people, org] = await Promise.all([
    orgPeople(c.env, live.installationId, live.login),
    orgInfo(c.env, live.installationId, live.login),
  ]);

  const observed = (p: OrgPerson) => ({
    githubId: String(p.id),
    login: p.login,
    avatarUrl: p.avatarUrl,
  });
  const { added, removed } = await syncRoster(db, cls.id, {
    active: people.students.map(observed),
    pending: people.pending.map(observed),
    teacher: people.teachers.map(observed),
  });

  const syncedAt = new Date();
  await db
    .update(classes)
    .set({
      installationId: live.installationId,
      login: org.login,
      name: org.name,
      avatarUrl: org.avatarUrl,
      rosterSyncedAt: syncedAt,
      updatedAt: syncedAt,
    })
    .where(eq(classes.id, cls.id));

  return c.json({
    installationId: live.installationId,
    login: org.login,
    name: org.name,
    avatarUrl: org.avatarUrl,
    students: people.students.length,
    pending: people.pending.length,
    teachers: people.teachers.length,
    added,
    removed,
    syncedAt: syncedAt.toISOString(),
  });
```

Update the docstring: this is now THE roster's only CRUD authority.

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm --filter @labs/api test
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handlers/reconcile.ts apps/api/test/reconcile.test.ts
git commit -m "$(cat <<'EOF'
feat(api): reconcile syncs the roster

Extends POST /classes/:id/reconcile with syncRoster and the rosterSyncedAt stamp.
One endpoint, one button: the teacher thinks "make this class right", not "which
of these two refreshes do I need".

This is the roster's only CRUD authority. Every other write point observes
exactly one person -- the caller -- so reconcile is the only operation that can
add a member who joined the org out of band, promote a new org Owner, refresh a
changed login, or remove a departed student. Tests pin all four.

orgPeople is deliberately NOT wrapped in a try. syncRoster deletes every row when
the roster is empty (enrollment.ts:84-85), and orgPeople throws rather than
returning empty -- so swallowing that throw would turn a rate limit into a roster
wipe. A test pins it: the cache survives and rosterSyncedAt stays null.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.4: The hub reads the roster from the cache

F3 already stopped the hub writing the `classes` row. This removes the last
write — `syncRoster` — and, because the people no longer need to come from
GitHub, drops the hub from four GitHub calls per class to one.

**Files:**
- Modify: `apps/api/src/handlers/classes.ts`
- Test: `apps/api/test/classes-list.test.ts`

**Interfaces:**
- Consumes: `class_members` rows; `callerGithub` (Task 1.1)
- Produces: each class in `GET /api/classes` gains `rosterSyncedAt: string | null`

- [ ] **Step 1: Write the failing tests**

```ts
test("the hub writes nothing at all", async () => {
  await seedClass({ orgId: 42, installationId: 111, login: "stale", name: "Stale" });

  await app.request("/api/classes", {}, env);

  const [row] = await db.select().from(classes);
  expect(row).toMatchObject({ installationId: 111, login: "stale", name: "Stale" });
  expect(await db.select().from(classMembers)).toHaveLength(0);
});

test("the hub reads people from class_members, not from GitHub", async () => {
  await seedClass({ orgId: 42, installationId: 200 });
  await observeMember(db, "c1", { githubId: "7", login: "alice", avatarUrl: "http://a" }, "active");
  await observeMember(db, "c1", { githubId: "111", login: "prof", avatarUrl: null }, "teacher");

  const res = await app.request("/api/classes", {}, env);

  const body = (await res.json()) as {
    classes: Array<{ students: Array<{ id: number; login: string }>; rosterSyncedAt: string | null }>;
  };
  expect(body.classes[0]?.students).toEqual([
    { id: 7, login: "alice", avatarUrl: "http://a" },
  ]);
  expect(body.classes[0]?.rosterSyncedAt).toBeNull();
  // orgPeople is three paginated calls. It must not be made.
  expect(orgPeople).not.toHaveBeenCalled();
});

test("the teacher check stays live", async () => {
  // class_members may NEVER authorize. A cached `teacher` row is not a role.
  await seedClass({ orgId: 42, installationId: 200 });
  await observeMember(db, "c1", { githubId: "111", login: "prof", avatarUrl: null }, "teacher");
  state.membershipRole = "member";   // GitHub says: not an Owner

  const res = await app.request("/api/classes", {}, env);

  const body = (await res.json()) as { classes: unknown[] };
  expect(body.classes).toHaveLength(0);
});
```

Add an `orgMembership` mock returning `{ state: "active", role: state.membershipRole }`
and a `fetchGithubProfile` mock returning `{ login: "prof" }`.

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @labs/api exec vitest run test/classes-list.test.ts
```

Expected: `class_members` has 0 rows written but `orgPeople` *was* called, and
`students` came from GitHub rather than the cache.

- [ ] **Step 3: Implement**

In `apps/api/src/handlers/classes.ts`:

- Delete the `syncRosterCache` helper and its call. The hub now writes nothing.
- Fetch the caller's login **once** for the whole request: `const profile = await fetchGithubProfile(token)`.
- Replace the per-class `orgPeople` call with one `orgMembership`:

```ts
    // F5a: only live org Owners see the class. class_members may never
    // authorize — a cached `teacher` row is a display fact, not a role.
    let membership: Awaited<ReturnType<typeof orgMembership>>;
    try {
      membership = await orgMembership(
        c.env,
        live.installationId,
        live.login,
        profile.login,
      );
    } catch {
      continue; // this org's problem, not the request's
    }
    if (membership?.role !== "admin") continue;
```

- Read the people from `class_members` in ONE query for all candidate classes
  (mirroring how `labRows` is fetched), and map each row back to the client's
  existing `OrgPerson` shape so the SPA needs no change:

```ts
const person = (m: typeof classMembers.$inferSelect) => ({
  id: Number(m.githubId),
  login: m.login ?? "unknown",
  avatarUrl: m.avatarUrl,
});
```

  `teachers` = rows with `state === "teacher"`, `students` = `"active"`,
  `pending` = `"pending"`.

- Add `rosterSyncedAt: cls.rosterSyncedAt` to each class in the response.

> `/user/installations` returns installations the caller can **access**, not ones
> they own — a student with push on a work repo can appear there. The live
> `orgMembership` check is therefore not optional, and the third test pins it.

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm --filter @labs/api test
pnpm --filter @labs/api exec tsc --noEmit
pnpm biome
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handlers/classes.ts apps/api/test/classes-list.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): the teacher hub writes nothing, and reads the roster from cache

The last write leaves the GET: syncRoster now belongs to the Reconcile button.
The card's people chips read class_members -- which is what an enrollment DISPLAY
cache is for.

Authorization stays live, and must: /user/installations returns installations the
caller can ACCESS, not ones they own (a student with push on a work repo can
appear there), and a cached `teacher` row is a display fact, not a role. The
per-class check is now one orgMembership call instead of orgPeople's three
paginated ones.

Hub cost: ~4N GitHub calls -> N+1 (one profile fetch, one membership check per
class), and zero writes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.5: The Reconcile button

**Files:**
- Modify: `apps/www/app/components/custom/classes/hub/people-chip.tsx`
- Modify: `apps/www/app/components/custom/classes/hub/class-card.tsx`
- Test: `apps/www/test/people-chip.test.tsx`, `apps/www/test/class-card.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("offers Reconcile in the students popover, with the last sync", () => {
  render(<PeopleChip … syncedAt="2026-07-06T10:00:00.000Z" onReconcile={spy} />);
  fireEvent.click(screen.getByRole("button", { name: /students/ }));
  expect(screen.getByText(/Synced 2 days ago/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reconcile" }));
  expect(spy).toHaveBeenCalled();
});

it("says the roster was never synced", () => {
  render(<ClassCard … rosterSyncedAt={null} />);
  expect(screen.getByText("Roster not synced")).toBeInTheDocument();
  expect(screen.queryByText(/0 students/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @labs/www exec vitest run test/people-chip.test.tsx test/class-card.test.tsx
```

Expected: `Unable to find an accessible element with the role "button" and name "Reconcile"`.

- [ ] **Step 3: Implement**

`PeopleChip` gains two props and a footer:

```tsx
  /** null = the roster has never been reconciled. */
  syncedAt?: string | null;
  onReconcile?: () => Promise<unknown>;
```

```tsx
      <div className="mt-2 flex items-center justify-between border-border border-t pt-2">
        <Text variant="caption">
          {syncedAt ? `Synced ${formatRelative(syncedAt)}` : "Roster not synced"}
        </Text>
        <Button size="sm" variant="outline" type="button"
                disabled={busy} onClick={reconcile}>
          {busy ? "Reconciling…" : "Reconcile"}
        </Button>
      </div>
```

On success, surface both directions on the global message strip:
`"+2 added, 3 removed · 12 students, 1 pending"`. A silent destructive sync is
how a teacher fails to notice a student vanished.

`ClassCard` renders `"Roster not synced"` in place of the people chips when
`rosterSyncedAt === null` — never `"0 students"`, which is indistinguishable
from a real empty class.

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm --filter @labs/www test
pnpm --filter @labs/www exec tsc --noEmit
pnpm biome
```

- [ ] **Step 5: Commit**

```bash
git add apps/www
git commit -m "$(cat <<'EOF'
feat(www): Reconcile button in the students popover

The teacher hub no longer sweeps the org roster on every card read. The popover
footer shows when the roster was last reconciled and offers to do it now,
reporting both directions ("+2 added, 3 removed").

A class whose roster has never been reconciled reads "Roster not synced" rather
than "0 students" — which is indistinguishable from a class nobody has joined.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F4 feature test

F3's test already proved the hub does not write the `classes` row. This proves it
does not write the roster either, and that the button is the only thing that can.

**A. Cold start is honest.**

1. ```bash
   cd apps/api && pnpm exec wrangler d1 execute DB --local \
     --command "UPDATE classes SET roster_synced_at = NULL; DELETE FROM class_members;"
   ```
2. Reload the teacher hub. Every card reads **"Roster not synced"** — *not* `0 students`, which is indistinguishable from a class nobody joined.
3. Open the students popover → **Reconcile**. It reports `+N added, 0 removed · N students…`.
4. The card shows real counts; the popover footer reads **"Synced just now"**.

**B. The GET writes nothing.**

5. Delete a student's cache row by hand:
   ```bash
   pnpm exec wrangler d1 execute DB --local \
     --command "DELETE FROM class_members WHERE state='active' LIMIT 1;"
   ```
6. Reload the hub. The count drops by one — the card is reading the cache. Re-query `class_members`: **still one row short.** The GET did not re-sync it.
7. Press **Reconcile**. The row is back, counted in `added`.

**C. Reconcile is the roster's only CRUD authority.** This is the whole point of the button — nothing else can do any of it:

8. **Add** — add a student to the org **directly on github.com** (not via the join link). Reload the hub: absent. Reconcile: present, in `added`.
9. **Promote** — make a student an org **Owner** on github.com. Reconcile: they move from the students chip to the teachers chip.
10. **Remove** — remove them from the org. Reconcile: `removed: 1`, and they are gone from the cache.
11. **Refresh** — rename that GitHub account. Reconcile: the popover shows the new `@login`.

**D. The cache survives a GitHub failure.** With `syncRoster` deleting everyone absent from the roster, a swallowed error would be a roster wipe.

12. Stop your network (or point `GITHUB_API_URL` at a dead host) and press **Reconcile**. It fails visibly. Re-query `class_members`: **every row survives**, and `roster_synced_at` is unchanged.

---

## F5 — Group team recovery

`groupsWithRosters` (`lib/groups.ts:261-273`) deletes the group row when `teamMembers` returns `null` (the team 404s). It does so **regardless of the work repo**, contradicting `deleteGroup`'s own invariant (`handlers/groups.ts:79-81`, *"refuse rather than orphan it"*) and the UI that enforces it (`teacher-lab-groups.tsx:487-491`).

Worse: repo access is granted **to the team** (`grantTeamRepo`). When the team dies, the students lose push on their own work repo. Today that is hidden by the silent delete.

### Task 5.1: Surface `teamMissing` instead of deleting

**Files:**
- Modify: `apps/api/src/lib/groups.ts:261-273`
- Test: `apps/api/test/lab-groups.test.ts`

**Interfaces:**
- Produces: each group in `GET /classes/:id/labs/:labId/groups` gains `teamMissing: boolean`

- [ ] **Step 1: Write the failing test**

```ts
test("a group whose GitHub team is gone is marked, not deleted", async () => {
  await seedLab();
  await seedGroup({ id: "g1", name: "Alpha", slug: "lab-l1-alpha",
                    ghRepoFullName: "acme/lab-l1-alpha", ghRepoId: 500 });
  delete state.rosters["lab-l1-alpha"];   // the team 404s on GitHub

  const res = await listGroups("l1");

  expect(res.status).toBe(200);
  const body = (await res.json()) as { groups: Array<Record<string, unknown>> };
  expect(body.groups).toMatchObject([
    { id: "g1", teamMissing: true, members: [], repoFullName: "acme/lab-l1-alpha" },
  ]);
  // The row — and the student work it points at — survives the GET.
  expect(await db.select().from(groups)).toHaveLength(1);
});

test("a healthy group is not marked", async () => {
  await seedLab();
  await seedGroup({ id: "g1", name: "Alpha", slug: "lab-l1-alpha" });
  state.rosters["lab-l1-alpha"] = [{ id: 7, login: "alice", avatarUrl: null }];

  const res = await listGroups("l1");
  const body = (await res.json()) as { groups: Array<{ teamMissing: boolean }> };
  expect(body.groups[0]?.teamMissing).toBe(false);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @labs/api exec vitest run test/lab-groups.test.ts -t "team is gone"
```

Expected: FAIL — the group array is empty and `groups` has 0 rows. Today's code deleted it.

- [ ] **Step 3: Implement**

Replace `groupsWithRosters` in `apps/api/src/lib/groups.ts`:

```ts
/**
 * Live rosters for group rows — one GitHub call per team, in PARALLEL.
 *
 * A team gone on GitHub is REPORTED, never repaired: a GET returns what it
 * sees. The row survives (its work repo is a deliverable — see deleteGroup's
 * has_repo guard), and `teamMissing` tells the teacher their students have lost
 * push on that repo, because the grant lived on the team.
 */
export async function groupsWithRosters(access: ClassAccess, rows: Group[]) {
  const rosters = await Promise.all(
    rows.map((row) => access.team.roster(row.ghTeamSlug)),
  );
  return rows.map((row, i) => {
    const members = rosters[i];
    return {
      id: row.id,
      name: row.name,
      slug: row.ghTeamSlug,
      members: members ?? [],
      teamMissing: members === null,
      repoFullName: row.ghRepoFullName,
    };
  });
}
```

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm --filter @labs/api test
```

Any existing test that asserted the orphan row was deleted must be **rewritten**, not deleted — it now asserts the row survives and is marked.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/groups.ts apps/api/test/lab-groups.test.ts
git commit -m "$(cat <<'EOF'
fix(api): a GET no longer deletes group rows

groupsWithRosters dropped the group row whenever its GitHub team 404'd. A
teacher loading their lab page destroyed database rows — and orphaned the work
repo, contradicting the invariant deleteGroup exists to protect ("a group whose
WORK REPO exists is a deliverable — refuse rather than orphan it",
handlers/groups.ts:79-81) and that the UI enforces
(teacher-lab-groups.tsx:487-491). Two code paths, opposite rules; the silent one
won on page load.

The group is now returned with teamMissing: true and an empty roster. That state
matters: repo access is granted TO the team (grantTeamRepo), so when the team
dies the students lose push on their own work repo. Silently deleting the row
hid the breakage.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5.2: Recreate the team

**Files:**
- Create: `apps/api/src/handlers/…` — add `recreateGroupTeam` to `apps/api/src/handlers/groups.ts`
- Modify: `apps/api/src/routes/groups.ts`
- Test: `apps/api/test/groups.test.ts`

**Interfaces:**
- Produces: `POST /api/classes/:id/groups/:groupId/team` → `200 { ok: true, teamSlug: string }`

- [ ] **Step 1: Write the failing test**

```ts
test("recreate team restores push and empties the roster", async () => {
  await seedGroupWithRepo({ id: "g1", slug: "lab-l1-alpha",
                            ghTeamId: 1, ghTeamSlug: "lab-l1-alpha",
                            ghRepoFullName: "acme/lab-l1-alpha", ghRepoId: 500 });
  delete state.rosters["lab-l1-alpha"];   // team gone

  const res = await app.request(
    "/api/classes/c1/groups/g1/team", { method: "POST" }, env,
  );

  expect(res.status).toBe(200);
  expect(grantTeamRepoMock).toHaveBeenCalledWith(
    expect.anything(), expect.anything(), "acme",
    "lab-l1-alpha", "acme/lab-l1-alpha",
  );
  const [row] = await db.select().from(groups).where(eq(groups.id, "g1"));
  expect(row?.ghTeamSlug).toBe("lab-l1-alpha");
});

test("recreate team is teacher-only", async () => {
  state.admin = false;
  const res = await app.request(
    "/api/classes/c1/groups/g1/team", { method: "POST" }, env,
  );
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run and watch them fail**

Expected: `404` on the first (route does not exist).

- [ ] **Step 3: Implement**

Add to `apps/api/src/handlers/groups.ts`:

```ts
/**
 * Teacher-only: recreate a group's GitHub team after it was deleted out of
 * band, and re-grant it push on the existing work repo. The roster died with
 * the team — it only ever lived in GitHub — so the group comes back EMPTY and
 * the teacher re-adds from the pool. The repo, and the student work in it, is
 * never touched.
 */
export const recreateGroupTeam = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access?.admin) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  // Idempotent: a live team needs nothing.
  if ((await access.team.roster(group.ghTeamSlug)) !== null) {
    return c.json({ ok: true, teamSlug: group.ghTeamSlug });
  }

  let team: Awaited<ReturnType<typeof createTeam>>;
  try {
    team = await createTeam(
      c.env,
      access.cls.installationId,
      access.org,
      group.slug,
    );
  } catch (err) {
    if ((err as { status?: number }).status === 422) {
      return c.json({ error: "name_taken" }, 409);
    }
    throw err;
  }

  if (group.ghRepoFullName) {
    await grantTeamRepo(
      c.env,
      access.cls.installationId,
      access.org,
      team.slug,
      group.ghRepoFullName,
    );
  }
  await access.db
    .update(groups)
    .set({ ghTeamId: team.id, ghTeamSlug: team.slug, updatedAt: new Date() })
    .where(eq(groups.id, group.id));

  return c.json({ ok: true, teamSlug: team.slug });
});
```

Register in `apps/api/src/routes/groups.ts`:

```ts
  .post("/classes/:id/groups/:groupId/team", ...recreateGroupTeam)
```

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm --filter @labs/api test
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handlers/groups.ts apps/api/src/routes/groups.ts apps/api/test/groups.test.ts
git commit -m "$(cat <<'EOF'
feat(api): recreate a group's GitHub team

A group whose team was deleted on GitHub is stuck: it cannot be deleted
(has_repo), cannot be worked in (repo access was granted TO the team, so the
students lost push), and nothing recreated a team.

POST /classes/:id/groups/:groupId/team recreates the secret team under the
group's stored slug and re-runs grantTeamRepo on the existing repo. Students get
push back; their work is untouched. The roster died with the team — it only ever
lived in GitHub — so the group returns empty and the teacher re-adds from the
pool. Idempotent: a live team returns 200 unchanged.

deleteGroup's has_repo guard is unchanged. The repo is the durable thing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5.3: The marker in the SPA

**Files:**
- Modify: `apps/www/app/components/custom/classes/groups/shared/use-lab-groups.ts`
- Modify: `apps/www/app/components/custom/classes/groups/teacher/roster.tsx:11-60`
- Modify: `apps/www/app/components/custom/classes/groups/teacher/teacher-lab-groups.tsx`
- Test: `apps/www/test/teacher-lab-page.test.tsx`

**Interfaces:**
- Consumes: `GroupItem.teamMissing: boolean` (Task 5.1)
- Produces: `GroupLabStatus` gains `"team_missing"`

- [ ] **Step 1: Write the failing test**

Add to `apps/www/test/teacher-lab-page.test.tsx`:

```tsx
it("marks a group whose GitHub team is gone, and offers to recreate it", () => {
  mockApi(
    { classes: [teachingClass], enrolled: [] },
    {
      ...groupsData,
      groups: [
        grp({ members: [], teamMissing: true, repoFullName: "acme/lab1-team-alpha" }),
      ],
    },
  );
  render(<TeacherLabPage />);

  expect(screen.getByText("team missing")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
  expect(
    screen.getByRole("button", { name: "Recreate team" }),
  ).toBeInTheDocument();
  // Deleting is still refused while a repo exists.
  expect(screen.getByRole("button", { name: "Delete group" })).toBeDisabled();
});
```

Add `teamMissing: false` to the `grp()` fixture's defaults.

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @labs/www exec vitest run test/teacher-lab-page.test.tsx -t "team is gone"
```

Expected: `Unable to find an element with the text: team missing`.

- [ ] **Step 3: Widen the status union**

In `use-lab-groups.ts`, add `"team_missing"` to `GroupLabStatus` and rank it **first** in `statusFor`:

```ts
  const statusFor = (group: GroupItem): GroupLabStatus => {
    // The roster is unknowable — size and activity mean nothing.
    if (group.teamMissing) return "team_missing";
    if (!group.repoFullName) { … }   // unchanged below
```

Also add `team_missing` to the `useAction` error map:

```ts
      case "name_taken":
        return "A group with that name already exists in this lab.";
```

and expose the action:

```ts
    recreateTeam: (groupId: string) =>
      act(() => classGroupsApi[":groupId"].team.$post(groupParam(groupId))),
```

- [ ] **Step 4: Implement the marker**

In `roster.tsx`, add the tone and the two map entries. Both maps are `Record<GroupLabStatus, …>`, so `tsc` will refuse to compile until you do.

```ts
const TONE = {
  good: "bg-role-enrolled/10 text-role-enrolled",
  warn: "bg-warning/12 text-warning",
  bad: "bg-brand/10 text-brand",
  muted: "bg-foreground/6 text-muted-foreground",
  // Broken infrastructure, not late work: scanning the spine column, a teacher
  // must tell "this group is behind" from "this group is broken".
  broken: "bg-destructive/10 text-destructive",
} as const;

export const STATUS_SPINE: Record<GroupLabStatus, string> = {
  // …existing…
  team_missing: "border-l-destructive",
};

const CHIP: Record<GroupLabStatus, { label: string; tone: PillTone }> = {
  // …existing…
  team_missing: { label: "team missing", tone: "broken" },
};
```

In `teacher-lab-groups.tsx`, add `"team_missing"` to nothing in `GOOD_STATUSES` (so it counts as "needs attention"), and add the drawer action:

```tsx
        {group.teamMissing ? (
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={g.busy}
            title="Recreate the group's GitHub team and restore its repository access"
            onClick={() => g.recreateTeam(group.id)}
          >
            Recreate team
          </Button>
        ) : null}
```

Also render the `Members` cell as an em dash when `teamMissing` — an `AvatarCluster` of zero members reads as "empty group", which is a different thing.

- [ ] **Step 5: Run and watch it pass**

```bash
pnpm --filter @labs/www test
pnpm --filter @labs/www exec tsc --noEmit
pnpm biome
```

- [ ] **Step 6: Commit**

```bash
git add apps/www
git commit -m "$(cat <<'EOF'
feat(www): mark a group whose GitHub team is gone

GroupLabStatus gains team_missing, ranked first in statusFor — a group whose
roster is unknowable has no meaningful size or activity. STATUS_SPINE and CHIP
are both Record<GroupLabStatus, ...>, so the type checker forced the marker into
existence.

A fifth Pill tone, `broken`, on the destructive token: distinct from `bad`
(brand red = late work). Scanning the spine column, a teacher must tell "behind"
from "broken" without reading — they are different actions.

The drawer offers Recreate team. Delete stays disabled while a repo exists.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F5 feature test

1. Teacher hub → a class → a lab with a group that has a work repo.
2. On **github.com**, delete that group's team (`Test-TWeb-2026` → Teams → the group's team → Delete).
3. Reload the lab page. The row shows a **red spine** and a **`team missing`** chip. Its Members cell is `—`. The group row **still exists**.
4. Confirm the repo survived:
   ```bash
   gh repo view Test-TWeb-2026/<slug> --json name
   ```
5. Confirm a student in that group can no longer push (this is the breakage the marker now names).
6. Open the row's drawer → **Recreate team** → the chip clears, the team exists again on GitHub, and the team has push on the repo (`Settings → Collaborators and teams`).
7. The group is empty; add a student from the pool. They can push again.

---

## F6 — Join confirmation

`GET /join/:token` calls `observeMembership` (`join.ts:126`) and refreshes the org identity cache (`join.ts:135`). Both are writes on a `GET`.

### Task 6.1: `POST /join/:token/confirm`

**Files:**
- Modify: `apps/api/src/handlers/join.ts`
- Modify: `apps/api/src/routes/join.ts`
- Test: `apps/api/test/join.test.ts`

**Interfaces:**
- Produces: `POST /api/join/:token/confirm` → `200 { membership: "active" | "pending", role: string }`

- [ ] **Step 1: Write the failing tests**

```ts
test("the join preview writes nothing", async () => {
  await seedClass();
  state.membership = { state: "active", role: "member" };

  const res = await app.request("/api/join/tok", {}, env);

  expect(res.status).toBe(200);
  expect(await db.select().from(classMembers)).toHaveLength(0);
});

test("confirm records the acceptance", async () => {
  await seedClass();
  await observeMember(db, "c1", { githubId: "7", login: "alice", avatarUrl: null }, "pending");
  state.membership = { state: "active", role: "member" };

  const res = await app.request("/api/join/tok/confirm", { method: "POST" }, env);

  expect(res.status).toBe(200);
  const [row] = await db.select().from(classMembers);
  expect(row?.state).toBe("active");
});

test("confirm forgets a member GitHub no longer knows", async () => {
  await seedClass();
  await observeMember(db, "c1", { githubId: "7", login: "alice", avatarUrl: null }, "active");
  state.membership = null;   // removed from the org

  await app.request("/api/join/tok/confirm", { method: "POST" }, env);

  expect(await db.select().from(classMembers)).toHaveLength(0);
});
```

- [ ] **Step 2: Run and watch them fail**

Expected: the first FAILs (`expected 1 to be 0`), the others 404.

- [ ] **Step 3: Implement**

In `apps/api/src/handlers/join.ts`, delete the `observeMembership(...)` call and the `db.update(classes)` identity refresh from `previewJoin`, leaving it a pure read. Then add:

```ts
/**
 * Records what the preview observed. The preview is a GET and writes nothing;
 * the student's page POSTs here ("Finish joining") once it reports they are
 * already a member. Re-reads live membership rather than trusting the client.
 */
export const confirmJoin = authedFactory.createHandlers(async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ error: "invalid_link" }, 404);
  const r = await resolveJoin(c.env, c.get("user").id, token);
  if (!r.ok) return c.json({ error: r.error }, r.status);
  const { cls, login, username } = r.ctx;

  const membership = await orgMembership(
    c.env,
    cls.installationId,
    login,
    username,
  );
  const db = getDb(c.env.DB);
  await observeMembership(db, cls, r.ctx, membership);

  return c.json({
    membership: membership?.state ?? null,
    role: membership?.role ?? null,
  });
});
```

Register it:

```ts
  .post("/join/:token/confirm", ...confirmJoin);
```

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm --filter @labs/api test
```

Existing `join.test.ts` tests that asserted the preview upserts must be **moved** to `confirm`, not deleted.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handlers/join.ts apps/api/src/routes/join.ts apps/api/test/join.test.ts
git commit -m "$(cat <<'EOF'
fix(api): the join preview stops writing

GET /join/:token upserted class_members and refreshed the org identity cache.
Both are writes on a GET, and the upsert was the only thing that recorded a
student's acceptance of the invite (there are no webhooks).

POST /join/:token/confirm now records it, re-reading live membership rather than
trusting the client. It reuses observeMembership, so the teacher and
forgetMember branches come along for free. The identity refresh is deleted
rather than moved: the join page already fetches orgInfo live for its own
render, and Reconcile owns that write now.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 6.2: "Finish joining"

**Files:**
- Modify: `apps/www/app/pages/join-page.tsx`
- Test: `apps/www/test/join-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("records the acceptance when the student finishes joining", async () => {
  mockPreview({ membership: "active", role: "member" });
  render(<JoinPage />);

  expect(screen.getByText(/You've accepted the invite/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Finish joining" }));

  expect(confirmSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Implement** — when the preview reports `membership === "active"` and the caller is not a teacher, render the copy and the button; on click, POST `/join/:token/confirm`, then navigate to `/classes/:id`.

Explicit rather than auto-fired on load: a mutation triggered by navigation is exactly the pattern this gate removes, and a silent failure would leave the row `pending` with nothing on screen to retry.

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @labs/www test
pnpm biome
```

- [ ] **Step 5: Commit**

```bash
git add apps/www
git commit -m "$(cat <<'EOF'
feat(www): "Finish joining" records the acceptance

The join page's GET is now a pure preview. When it reports the student has
already accepted the GitHub invite, they press Finish joining, which POSTs
/join/:token/confirm. Explicit rather than auto-fired: a failure is visible and
retryable, where an effect on page load fails silently.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F6 feature test

Use the two GitHub accounts (`Ovich` = teacher, `OvichHeigVD` = student).

1. As the teacher, copy the class join link.
2. Sign in to labs as the student. Open the link. Press **Join**.
3. Verify a `pending` row exists:
   ```bash
   cd apps/api && pnpm exec wrangler d1 execute DB --local \
     --command "SELECT github_id, state FROM class_members;"
   ```
4. Accept the org invite on **github.com**.
5. Return to the join link and **reload**. The page reads *"You've accepted the invite on GitHub."*
6. **Before clicking**, re-run the query: the row is still `pending`. *The GET wrote nothing.*
7. Press **Finish joining**. Re-run the query: the row is `active`.
8. The student's hub shows the class.

---

## Self-review

**Spec coverage.** §1 audit → F1-F6. §2 (`class_members` write points, CRUD authority) → 4.2, 4.3. §3.1 reconcile → 3.2 (class row) + 4.3 (roster). §3.2 confirm → 6.1, 6.2. §3.3 session-less repair → 3.1, 3.3. §3.4 `teamMissing` + marker + recreate → 5.1, 5.2, 5.3. §4 reads → 3.3 (class row) + 4.4 (roster, authorization). §5 schema → 2.2 (`unique(classId, title)`), 4.1 (`rosterSyncedAt`). §6 UI → 4.5. §8 testing → each task's tests. §9 follow-ups: `callerGithubId` → 1.1 ✅; `catch {}` → 1.2 ✅; `enrolledTeachers` inline join → **not covered, deliberately deferred** (a duplication, not a defect).

**Deviations from the spec.**

1. §5 specifies one migration (`0011`) carrying both schema changes. This plan splits them — `0011` lab-title uniqueness (F2), `0012` `rosterSyncedAt` (F4) — so each feature ships alone. **If F4 lands before F2 the numbers swap**, and the SQL filenames must swap with them. Update §5 when F2 lands.
2. §3.1 names the endpoint `POST /api/classes/:id/roster/reconcile`. It is `POST /api/classes/:id/reconcile` here: F3 introduces it for the class row, F4 extends it with the roster, and the teacher gets one button. Update §3.1 when F3 lands.

**Intermediate states.** After F3 the hub still calls `orgPeople` and still runs `syncRoster` (fail-open, from F1) — it just no longer writes the `classes` row. That is a coherent shipping state, not a half-migration. After F4 the hub makes one GitHub call per class and writes nothing.

**Not covered by any feature, still open:** the `listClasses` decomposition into `teachingClass` / `enrolledClasses` / `hasOlderThan`, and parallelizing the per-class fan-out. F4 shrinks the loop to one GitHub call and no writes, so this may no longer earn its keep; re-assess after it lands.

**Type consistency.** `callerGithub` returns `{ ghId, githubId }` in 1.1, consumed with those names in 1.2, 3.2, 3.3, 4.4. `syncRoster` returns `{ added, removed }` in 4.2, destructured with those names in 4.3. `teamMissing: boolean` is produced in 5.1 and consumed in 5.3. `UserInstallation.avatarUrl` is added in 3.3 and consumed there and in 4.4. `rosterSyncedAt` is added in 4.1, written in 4.3, read in 4.4, rendered in 4.5.
