# Lab Start Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Labs gain an optional `startAt`: students see a scheduled lab but cannot form groups or create repositories (and thus cannot reach the starter code) before it; teachers bypass the gate as an informed escape hatch.

**Architecture:** One nullable timestamp column drives everything. The server derives `labStarted(lab)` per request and refuses student verbs with `409 not_started`; the client derives the same from the `startAt` riding on every lab response (types flow Drizzle → RPC, nothing hand-written). No draft/publish state exists.

**Tech Stack:** Drizzle/D1 (SQLite), Hono + zod, React + SWR, vitest (`cloudflare:test` for API, testing-library for www), biome.

**Spec:** `docs/superpowers/specs/2026-07-23-lab-start-date-design.md` — read it first.

## Global Constraints

- Follow `AGENTS.md`: DB types derive from Drizzle (`Pick<Lab, "startAt">`, never hand-written row shapes); response shapes stay inferred; migrations get `--name`; read generated SQL before applying.
- Error vocabulary (exact strings): `not_started`, `start_after_deadline`.
- Teacher bypass everywhere: every gate is `!access.isTeacher && !labStarted(lab)`.
- Copy strings are part of the spec — use them verbatim as written in each task.
- Run commands from the repo root. After every task: `pnpm biome` must pass (only the pre-existing schema-version info line is tolerated).
- Commit after each task on branch `feat/lab-start-date`; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `startAt` column, migration, input validation

**Files:**
- Modify: `packages/db/src/app-schema.ts:55` (after `deadline`)
- Create: `packages/db/migrations/0015_lab_start_at.sql` (generated)
- Modify: `apps/api/src/handlers/labs.ts` (labInput, createLab, updateLab)
- Test: `apps/api/test/labs.test.ts`

**Interfaces:**
- Produces: `labs.startAt` (`Date | null` via Drizzle, `start_at` integer timestamp column); `labInput` accepts optional `startAt` ISO string; `409 { error: "start_after_deadline" }` when `startAt >= deadline`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/labs.test.ts`:

```ts
test("create persists an explicit start date", async () => {
  const res = await post({ ...validLab, startAt: "2026-07-01T08:00:00.000Z" });
  expect(res.status).toBe(200);
  const [row] = await db.select().from(labs);
  expect(row?.startAt?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
});

test("create without a start leaves it null (starts immediately)", async () => {
  const res = await post(validLab);
  expect(res.status).toBe(200);
  const [row] = await db.select().from(labs);
  expect(row?.startAt).toBeNull();
});

test("a start at or after the deadline is refused", async () => {
  const res = await post({ ...validLab, startAt: validLab.deadline });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "start_after_deadline" });
});

test("two labs with overlapping start–deadline ranges both succeed", async () => {
  const a = await post({ ...validLab, startAt: "2026-07-01T08:00:00.000Z" });
  const b = await post({
    ...validLab,
    title: "Lab 2 — overlapping",
    startAt: "2026-07-15T08:00:00.000Z",
  });
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
});

test("update sets and then clears the start date", async () => {
  await post(validLab);
  const [created] = await db.select().from(labs);
  const put = (body: unknown) =>
    app.request(
      `/api/classes/c1/labs/${created?.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
  const set = await put({ ...validLab, startAt: "2026-07-01T08:00:00.000Z" });
  expect(set.status).toBe(200);
  let [row] = await db.select().from(labs);
  expect(row?.startAt?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
  const cleared = await put(validLab);
  expect(cleared.status).toBe(200);
  [row] = await db.select().from(labs);
  expect(row?.startAt).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @labs/api test -- labs.test`
Expected: FAIL — `startAt` unknown on the row type / values are stripped by zod (row stays null where a date was expected) / 409 tests get 200.

- [ ] **Step 3: Add the column**

In `packages/db/src/app-schema.ts`, directly after the `deadline` line:

```ts
    // Optional start gate: before this moment students see the lab but can't
    // act on it — no groups, no repos, and so no starter code. NULL = starts
    // at creation. Start–deadline ranges of DIFFERENT labs may overlap.
    startAt: integer("start_at", { mode: "timestamp" }),
```

- [ ] **Step 4: Generate and review the migration**

Run: `pnpm --filter @labs/db db:generate --name=lab_start_at`
Then READ the generated `packages/db/migrations/0015_lab_start_at.sql`. Expected content: a single `ALTER TABLE \`labs\` ADD \`start_at\` integer;` — a plain nullable add needs no rebuild and no backfill. If drizzle-kit emitted a table rebuild instead, stop and fix per AGENTS.md rule 9.

- [ ] **Step 5: Wire input + validation + persistence**

In `apps/api/src/handlers/labs.ts`, add to `labInput`'s object (after `deadline`):

```ts
    startAt: z.coerce.date().optional(),
```

In `createLab`, after the `title_taken` clash check and before `const now = new Date();`:

```ts
    // The one date rule: a set start must precede the deadline. Ranges of
    // DIFFERENT labs may overlap freely — lab 2 can open while lab 1 runs.
    if (input.startAt && input.startAt >= input.deadline) {
      return c.json({ error: "start_after_deadline" }, 409);
    }
```

Add to the insert `values`, after `deadline`:

```ts
        startAt: input.startAt ?? null,
```

In `updateLab`, add the identical guard after its `title_taken` check, and add to the update `set` after `deadline`:

```ts
        startAt: input.startAt ?? null,
```

(Absent means null on update too — safe because the lab dialog always submits the complete form.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @labs/api test -- labs.test`
Expected: PASS (all, including the pre-existing ones).

- [ ] **Step 7: Typecheck + biome + commit**

Run: `pnpm --filter @labs/api typecheck && pnpm biome`

```bash
git add packages/db/src/app-schema.ts packages/db/migrations apps/api/src/handlers/labs.ts apps/api/test/labs.test.ts
git commit -m "Add optional startAt to labs with start-before-deadline validation"
```

---

### Task 2: Order labs by effective start

**Files:**
- Modify: `apps/api/src/handlers/classes.ts:239-241` and `:355-357` (the two `orderBy(desc(labs.deadline))` sites)
- Test: `apps/api/test/classes-list.test.ts:412-452` (the existing ordering test)

**Interfaces:**
- Consumes: `labs.startAt` from Task 1.
- Produces: both class-list lab arrays ordered by `coalesce(start_at, created_at)` descending.

- [ ] **Step 1: Rewrite the ordering test to fail**

Replace the body of the existing test `"orders a class's labs by deadline, latest first"` in `apps/api/test/classes-list.test.ts` with:

```ts
test("orders a class's labs by effective start (startAt, else createdAt), newest first", async () => {
  await seedClass();
  // Deadlines deliberately CONTRADICT the expected order: the sort key is
  // the effective start, not the deadline.
  await db.insert(labs).values([
    {
      id: "lab-old",
      classId: "c1",
      title: "Old lab",
      deadline: new Date("2099-12-15T23:59:00Z"),
      createdByUserId: "u1",
      createdAt: new Date("2099-01-01T00:00:00Z"),
      updatedAt: now,
    },
    {
      id: "lab-scheduled",
      classId: "c1",
      title: "Scheduled lab",
      deadline: new Date("2099-07-15T23:59:00Z"),
      startAt: new Date("2099-06-01T08:00:00Z"),
      createdByUserId: "u1",
      createdAt: new Date("2099-01-02T00:00:00Z"),
      updatedAt: now,
    },
    {
      id: "lab-new",
      classId: "c1",
      title: "New lab",
      deadline: new Date("2099-03-15T23:59:00Z"),
      createdByUserId: "u1",
      createdAt: new Date("2099-05-01T00:00:00Z"),
      updatedAt: now,
    },
  ]);
  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as {
    classes: Array<{ labs: Array<{ id: string }> }>;
  };
  expect(body.classes[0]?.labs.map((l) => l.id)).toEqual([
    "lab-scheduled", // effective 2099-06-01 (startAt)
    "lab-new", //       effective 2099-05-01 (createdAt)
    "lab-old", //       effective 2099-01-01 (createdAt) — latest DEADLINE
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @labs/api test -- classes-list`
Expected: FAIL — order comes back `["lab-old", "lab-scheduled", "lab-new"]` (deadline order).

- [ ] **Step 3: Change both orderBy sites**

In `apps/api/src/handlers/classes.ts`, add `sql` to the existing `drizzle-orm` import, then replace **both** `.orderBy(desc(labs.deadline))` occurrences (the teaching query ~line 241 and the enrolled query ~line 357) with:

```ts
          // Effective start, newest first: a lab scheduled for later sits
          // above earlier ones; an unscheduled lab sorts by its creation.
          // The per-class filter below keeps this order in the response.
          .orderBy(desc(sql`coalesce(${labs.startAt}, ${labs.createdAt})`));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @labs/api test -- classes-list`
Expected: PASS.

- [ ] **Step 5: Typecheck + biome + commit**

Run: `pnpm --filter @labs/api typecheck && pnpm biome`

```bash
git add apps/api/src/handlers/classes.ts apps/api/test/classes-list.test.ts
git commit -m "Order class labs by effective start (startAt, else createdAt)"
```

---

### Task 3: `labStarted` + gates on the lab-scoped student verbs

**Files:**
- Modify: `apps/api/src/lib/groups.ts` (new export, near `labMax` at the top)
- Modify: `apps/api/src/handlers/lab-groups.ts` (`createLabGroup`, `createLabRepo`, `acceptIndividualLab`)
- Test: `apps/api/test/lab-groups.test.ts`

**Interfaces:**
- Consumes: `labs.startAt` (Task 1).
- Produces: `labStarted(lab: Pick<Lab, "startAt">): boolean` exported from `apps/api/src/lib/groups.ts`; `409 { error: "not_started" }` from the three handlers for students pre-start. Tasks 4–5 import the same `labStarted`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/lab-groups.test.ts`, extend `seedLab`'s args type with `startAt?: Date;` and its insert values with `startAt: args?.startAt ?? null,`. Then append:

```ts
const FUTURE_START = new Date("2098-01-01T08:00:00Z"); // < the 2099 deadline

test("a student cannot create a group before the lab starts", async () => {
  await seedLab({ id: "l1", startAt: FUTURE_START });
  const res = await app.request(
    "/api/classes/c1/labs/l1/groups",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha" }),
    },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_started" });
});

test("a teacher creates groups before the start (the escape hatch)", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab({ id: "l1", startAt: FUTURE_START });
  const res = await app.request(
    "/api/classes/c1/labs/l1/groups",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha" }),
    },
    env,
  );
  expect(res.status).toBe(200);
});

test("a student cannot reach the repo before the start — even one a teacher pre-created", async () => {
  await seedLab({ id: "l1", startAt: FUTURE_START });
  await seedGroup({ id: "g1", labId: "l1", repo: true, members: [alice] });
  const res = await app.request(
    "/api/classes/c1/labs/l1/groups/g1/repo",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_started" });
});

test("accept refuses an individual lab before the start", async () => {
  await seedLab({ id: "l1", groupMode: "individual", startAt: FUTURE_START });
  const res = await app.request(
    "/api/classes/c1/labs/l1/accept",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_started" });
});

test("a past start behaves exactly like no start", async () => {
  await seedLab({ id: "l1", startAt: new Date("2000-01-01T00:00:00Z") });
  const res = await app.request(
    "/api/classes/c1/labs/l1/groups",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha" }),
    },
    env,
  );
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @labs/api test -- lab-groups`
Expected: FAIL — the `not_started` tests get 200 (or the repo test gets the idempotent repo back).

- [ ] **Step 3: Implement**

In `apps/api/src/lib/groups.ts`, directly under `labMax`:

```ts
/** Whether the lab is OPEN to students: an unset start means "starts at
 *  creation". Teachers bypass every gate built on this — the deliberate
 *  escape hatch (they are warned in the UI, never blocked). */
export const labStarted = (lab: Pick<Lab, "startAt">) =>
  lab.startAt === null || lab.startAt.getTime() <= Date.now();
```

In `apps/api/src/handlers/lab-groups.ts`, add `labStarted` to the existing `../lib/groups` import. Then:

In `createLabGroup`, after `if (!lab) return c.json({ error: "not_found" }, 404);`:

```ts
    // The start gate: before the lab opens, students change nothing — no
    // groups, no repos, no starter code. Teachers pass (escape hatch).
    if (!access.isTeacher && !labStarted(lab)) {
      return c.json({ error: "not_started" }, 409);
    }
```

In `createLabRepo`, after the combined `!lab || !group || group.labId !== lab.id` 404 and **before** the idempotent `if (group.ghRepoFullName)` branch:

```ts
  // The start gate precedes even the idempotent return: a teacher may have
  // pre-created the repo (escape hatch) — that must not open it to students
  // early, so a pre-start student gets not_started, never the repo.
  if (!access.isTeacher && !labStarted(lab)) {
    return c.json({ error: "not_started" }, 409);
  }
```

In `acceptIndividualLab`, after the `group_lab` mode check:

```ts
  if (!access.isTeacher && !labStarted(lab)) {
    return c.json({ error: "not_started" }, 409);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @labs/api test -- lab-groups`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Typecheck + biome + commit**

Run: `pnpm --filter @labs/api typecheck && pnpm biome`

```bash
git add apps/api/src/lib/groups.ts apps/api/src/handlers/lab-groups.ts apps/api/test/lab-groups.test.ts
git commit -m "Gate student group/repo/accept verbs behind the lab start"
```

---

### Task 4: Gate join/leave

**Files:**
- Modify: `apps/api/src/handlers/groups.ts` (`joinGroup`, `leaveGroup`)
- Test: `apps/api/test/groups.test.ts`

**Interfaces:**
- Consumes: `labStarted` from Task 3 (`../lib/groups`).
- Produces: `409 { error: "not_started" }` from join/leave for students pre-start.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/groups.test.ts`:

```ts
// --- the start gate (membership frozen before the lab opens) ---

test("join is refused before the lab starts", async () => {
  await seedLab("l1", { startAt: new Date("2098-01-01T08:00:00Z") });
  await seedGroup({ id: "g1", labId: "l1" });
  const res = await join();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_started" });
});

test("leave is refused before the lab starts", async () => {
  await seedLab("l1", { startAt: new Date("2098-01-01T08:00:00Z") });
  await seedGroup({ id: "g1", labId: "l1", members: [alice] });
  const res = await app.request(
    "/api/classes/c1/groups/g1/membership",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_started" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @labs/api test -- groups.test`
Expected: FAIL — both get 200.

- [ ] **Step 3: Implement**

In `apps/api/src/handlers/groups.ts`, add `labStarted` to the `../lib/groups` import.

In `joinGroup`, **move** the existing lab select (currently fetched later for the size cap) up so it sits right after the group 404, and add the gate. The block after `if (!group) return c.json({ error: "not_found" }, 404);` becomes:

```ts
  const [lab] = await access.db
    .select()
    .from(labs)
    .where(eq(labs.id, group.labId));
  // The start gate comes first: before the lab opens, membership is frozen
  // for students — a teacher may pre-form groups (escape hatch), and
  // students must not reshape them early. Teachers manage top-down.
  if (lab && !access.isTeacher && !labStarted(lab)) {
    return c.json({ error: "not_started" }, 409);
  }
```

Delete the now-duplicate `const [lab] = await access.db.select().from(labs)...` further down (the size-cap check keeps using this earlier `lab`).

In `leaveGroup`, after its group 404, add the identical fetch + gate block (leave currently never fetched the lab).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @labs/api test -- groups.test`
Expected: PASS (all).

- [ ] **Step 5: Typecheck + biome + commit**

Run: `pnpm --filter @labs/api typecheck && pnpm biome`

```bash
git add apps/api/src/handlers/groups.ts apps/api/test/groups.test.ts
git commit -m "Freeze group membership for students before the lab start"
```

---

### Task 5: Head-only list for students pre-start

**Files:**
- Modify: `apps/api/src/handlers/lab-groups.ts` (`listLabGroups`)
- Test: `apps/api/test/lab-groups.test.ts`

**Interfaces:**
- Consumes: `labStarted` (Task 3), the existing `pending` head-only branch as the shape to mirror.
- Produces: student `GET .../groups` pre-start returns `{ ...head, groups: [], users: [], students: [] }`; teacher unchanged.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/lab-groups.test.ts`:

```ts
test("a student's list is head-only before the start; the teacher's is full", async () => {
  await seedLab({ id: "l1", startAt: new Date("2098-01-01T08:00:00Z") });
  await seedGroup({ id: "g1", labId: "l1", name: "A", members: [alice] });

  const student = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  expect(student.status).toBe(200);
  const sBody = (await student.json()) as {
    lab: { startAt: string | null };
    groups: unknown[];
    students: unknown[];
  };
  expect(sBody.groups).toEqual([]);
  expect(sBody.students).toEqual([]);
  expect(sBody.lab.startAt).toBe("2098-01-01T08:00:00.000Z");

  state.membership = { state: "active", role: "admin" };
  const teacher = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  const tBody = (await teacher.json()) as { groups: unknown[] };
  expect(tBody.groups).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @labs/api test -- lab-groups`
Expected: FAIL — the student response carries the seeded group.

- [ ] **Step 3: Implement**

In `listLabGroups`, directly after the existing `membershipState === "pending"` early return:

```ts
  // The start gate, list edition: a student on a not-yet-open lab gets the
  // head (a direct URL renders "starts …", never a 404) and EMPTY lists —
  // pre-formed rosters stay invisible until the start. Teachers see all.
  if (!access.isTeacher && !labStarted(lab)) {
    return c.json({ ...head, groups: [], users: [], students: [] });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @labs/api test -- lab-groups`
Expected: PASS.

- [ ] **Step 5: Typecheck + biome + commit**

Run: `pnpm --filter @labs/api typecheck && pnpm biome`

```bash
git add apps/api/src/handlers/lab-groups.ts apps/api/test/lab-groups.test.ts
git commit -m "Return a head-only lab-groups list to students before the start"
```

---

### Task 6: Locked lab row (www)

**Files:**
- Modify: `apps/www/app/lib/format.ts` (client `labStarted`)
- Modify: `apps/www/app/components/custom/classes/labs/deadline-text.tsx` (export `relativeLabel`)
- Modify: `apps/www/app/components/custom/classes/labs/lab-row.tsx`
- Test (create): `apps/www/test/lab-row.test.tsx`

**Interfaces:**
- Consumes: `startAt: string | null` on `LabItem` (rides automatically via RPC inference after Task 1).
- Produces: `labStarted(lab: { startAt?: string | null }): boolean` in `~/lib/format` (Tasks 7–9 import it); `relativeLabel(date: Date): string` exported from `deadline-text.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `apps/www/test/lab-row.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { LabRow } from "~/components/custom/classes/labs/lab-row";
import type { LabItem } from "~/lib/api";

vi.mock("react-router", () => ({
  Link: ({ to, children, ...props }: PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const base = {
  id: "l1",
  classId: "c1",
  title: "Lab 2 — Streams",
  deadline: "2099-08-01T23:59:00.000Z",
  startAt: null,
  groupMode: "group",
  minMembers: 2,
  maxMembers: 3,
  templateRepoId: 7,
  templateRepoFullName: "acme/lab1-solution",
  createdByUserId: "u1",
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
} as unknown as LabItem;

const scheduled = { ...base, startAt: "2099-07-01T08:00:00.000Z" } as LabItem;

describe("LabRow", () => {
  it("renders a started lab as a link with the starter-code badge", () => {
    render(<LabRow lab={base} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/classes/c1/labs/l1",
    );
    expect(screen.getByText("starter code")).toBeInTheDocument();
  });

  it("locks a pre-start lab for students: no link, a starts date, no badge", () => {
    render(<LabRow lab={scheduled} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/starts/)).toBeInTheDocument();
    // The template's NAME is itself a leak (e.g. lab1-solution).
    expect(screen.queryByText("starter code")).not.toBeInTheDocument();
  });

  it("keeps the teacher's pre-start row clickable, with a starts marker", () => {
    render(<LabRow lab={scheduled} manage />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/classes/c1/labs/l1/manage",
    );
    expect(screen.getByText(/starts/)).toBeInTheDocument();
    expect(screen.getByText("starter code")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @labs/www test -- lab-row`
Expected: FAIL — the pre-start student test finds a link and the badge.

- [ ] **Step 3: Implement the helpers**

In `apps/www/app/lib/format.ts`, append:

```ts
/** Whether the lab is open to students — mirrors the API's `labStarted`
 *  (apps/api/src/lib/groups.ts); the server verdict is authoritative, this
 *  only drives rendering. No start date = open since creation. */
export function labStarted(lab: { startAt?: string | null }): boolean {
  return !lab.startAt || new Date(lab.startAt).getTime() <= Date.now();
}
```

In `deadline-text.tsx`, change `deadlineLabel` to take a `Date` and export it as `relativeLabel` (DeadlineText follows):

```ts
/** The relative part alone ("in 3 days", "in 3h 30m", "closed") for any
 *  moment — the deadline cell and the locked row's "starts …" share it. */
export function relativeLabel(date: Date) {
  const ms = msUntil(date);
  if (ms <= 0) return "closed";
  const totalMins = Math.ceil(ms / MINUTE);
  if (totalMins < MINS_PER_HOUR) return `in ${totalMins} min`;
  if (totalMins < MINS_PER_DAY) {
    const hours = Math.floor(totalMins / MINS_PER_HOUR);
    const mins = totalMins % MINS_PER_HOUR;
    return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  }
  const days = Math.ceil(totalMins / MINS_PER_DAY);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
```

(Delete the old `deadlineLabel`; `DeadlineText` renders `relativeLabel(deadline)`.)

- [ ] **Step 4: Implement the row**

In `lab-row.tsx`: import `relativeLabel` from `deadline-text`, and `labStarted` from `~/lib/format`. Inside `LabRow`:

```tsx
  const started = labStarted(lab);
  const start = lab.startAt ? new Date(lab.startAt) : null;
```

In `cells`, the title span gains (after the existing `TemplateBadge` conditional, whose condition becomes `lab.templateRepoFullName && (started || manage)`):

```tsx
        {manage && !started && start ? (
          <span className="inline-flex shrink-0 items-center rounded-full bg-warning/10 px-2 py-0.5 font-mono text-[10px] text-warning uppercase tracking-wider">
            starts {formatDeadline(start)}
          </span>
        ) : null}
```

The Due cell becomes conditional — pre-start student rows answer "when does it open?", muted (urgency is a deadline concept):

```tsx
      {!started && !manage && start ? (
        <span className="whitespace-nowrap font-mono text-muted-foreground text-xs tabular-nums">
          starts {formatDeadline(start)} · {relativeLabel(start)}
        </span>
      ) : (
        /* the existing deadline cell, unchanged */
      )}
```

And before the existing `const row = (<Link …>)`, the locked branch:

```tsx
  if (!started && !manage) {
    // Nothing behind the row a student may act on — not a link, dimmed.
    return (
      <div
        aria-disabled="true"
        title="This lab hasn't started yet"
        className={cn(LAB_GRID, "border-border border-b py-2.5 opacity-60")}
      >
        {cells}
      </div>
    );
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @labs/www test -- lab-row`
Expected: PASS. Then `pnpm --filter @labs/www test` — the full suite must stay green (hub-card fixtures without `startAt` read as started via `!lab.startAt`).

- [ ] **Step 6: Typecheck + biome + commit**

Run: `pnpm --filter @labs/www typecheck && pnpm biome`

```bash
git add apps/www/app/lib/format.ts apps/www/app/components/custom/classes/labs/deadline-text.tsx apps/www/app/components/custom/classes/labs/lab-row.tsx apps/www/test/lab-row.test.tsx
git commit -m "Render pre-start labs as locked rows for students"
```

---

### Task 7: Start field in the lab dialog

**Files:**
- Modify: `apps/www/app/components/custom/classes/labs/lab-dialog.tsx`
- Test: `apps/www/test/lab-dialog.test.tsx`

**Interfaces:**
- Consumes: `labInput.startAt` (Task 1), `409 start_after_deadline`.
- Produces: the dialog posts `startAt` (ISO) when set; omits it when empty.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("LabDialog")` block:

```tsx
  it("posts the start date and explains what it gates", async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Lab 2" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });
    fireEvent.change(screen.getByLabelText("Start (optional)"), {
      target: { value: "2099-07-01T08:00" },
    });
    expect(
      screen.getByText(/no access to the starter code/),
    ).toBeInTheDocument();
    labsPost.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Create lab" }));
    await waitFor(() => expect(labsPost).toHaveBeenCalled());
    const arg = labsPost.mock.calls[0]?.[0] as { json: { startAt?: string } };
    expect(arg.json.startAt).toBe(new Date("2099-07-01T08:00").toISOString());
  });

  it("omits startAt entirely when the field stays empty", async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Lab 2" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });
    labsPost.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Create lab" }));
    await waitFor(() => expect(labsPost).toHaveBeenCalled());
    const arg = labsPost.mock.calls[0]?.[0] as { json: Record<string, unknown> };
    expect("startAt" in arg.json).toBe(false);
  });

  it("disables Create when the start is not before the deadline", async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Lab 2" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });
    fireEvent.change(screen.getByLabelText("Start (optional)"), {
      target: { value: "2099-09-01T08:00" },
    });
    expect(screen.getByRole("button", { name: "Create lab" })).toBeDisabled();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @labs/www test -- lab-dialog`
Expected: FAIL — no "Start (optional)" field exists.

- [ ] **Step 3: Implement**

In `lab-dialog.tsx`:

State + seeding (in `openChange`, after the deadline line):

```tsx
  const [startAt, setStartAt] = useState("");
  // in openChange:
      setStartAt(lab?.startAt ? toDatetimeLocal(lab.startAt) : "");
```

`valid` gains one clause:

```tsx
    (startAt === "" ||
      deadline === "" ||
      new Date(startAt) < new Date(deadline)) &&
```

`json` gains (after `deadline`):

```tsx
      ...(startAt !== ""
        ? { startAt: new Date(startAt).toISOString() }
        : {}),
```

The 409 handling reads the error code (both codes are 409s now):

```tsx
      if (!res.ok) {
        const code =
          res.status === 409
            ? ((await res.json().catch(() => ({}))) as { error?: string }).error
            : undefined;
        setError(
          code === "start_after_deadline"
            ? "The start must be before the deadline."
            : res.status === 409
              ? "A lab with that title already exists in this class."
              : lab
                ? "Couldn't save the lab — check the fields and try again."
                : "Couldn't create the lab — check the fields and try again.",
        );
        return;
      }
```

The field, between Title and Deadline:

```tsx
          <Stack gap="sm">
            <Label htmlFor="lab-start">Start (optional)</Label>
            <Input
              id="lab-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
            <Text variant="caption">
              Students see the lab but cannot start it — no groups, no
              repositories, and no access to the starter code — until this
              time. Leave empty to open the lab immediately.
            </Text>
          </Stack>
```

The create-mode `DialogDescription` becomes:

```tsx
            {lab
              ? "Changes are visible to students immediately."
              : "The lab is visible to students as soon as it is created; a start date keeps them from beginning — and from the starter code — before it."}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @labs/www test -- lab-dialog`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Typecheck + biome + commit**

Run: `pnpm --filter @labs/www typecheck && pnpm biome`

```bash
git add apps/www/app/components/custom/classes/labs/lab-dialog.tsx apps/www/test/lab-dialog.test.tsx
git commit -m "Add the optional start field to the lab dialog"
```

---

### Task 8: Student lab page pre-start gate

**Files:**
- Modify: `apps/www/app/pages/student-lab-page.tsx`
- Modify: `apps/www/app/components/custom/classes/groups/shared/use-lab-groups.ts` (`CONFLICT_MESSAGE`)
- Test: `apps/www/test/student-lab-page.test.tsx`

**Interfaces:**
- Consumes: `labStarted`, `formatDeadline` from `~/lib/format` (Task 6); the head-only server response (Task 5).
- Produces: the pre-start student page text; `not_started` mapped in `CONFLICT_MESSAGE`.

- [ ] **Step 1: Write the failing test**

Append to the `"StudentLabPage — edges"` describe block:

```tsx
  it("gates a not-yet-started lab with its start date", () => {
    // Mirrors the server: pre-start, a student's response is head-only.
    mockApi(
      groupsData({
        lab: { ...groupLab, startAt: "2099-07-01T08:00:00.000Z" },
        groups: [],
        students: [],
      }),
    );
    render(<StudentLabPage />);
    expect(screen.getByText(/This lab starts/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ New group" }),
    ).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @labs/www test -- student-lab-page`
Expected: FAIL — the page renders the group browse UI instead.

- [ ] **Step 3: Implement**

In `student-lab-page.tsx`, import `{ formatDeadline, labStarted }` from `~/lib/format`. Replace the `{pending ? … : <StudentLabGroups …>}` block's else-branch with a three-way:

```tsx
          {pending ? (
            <Text variant="body2">
              Accept your invitation on GitHub first — then you can accept this
              lab.
            </Text>
          ) : g.lab.startAt && !labStarted(g.lab) ? (
            // The server already answers head-only pre-start; this is the
            // matching face: what's next and when — nothing to act on yet.
            <Text variant="body2">
              This lab starts {formatDeadline(new Date(g.lab.startAt))} —
              you'll be able to form groups and get the starter code then.
            </Text>
          ) : (
            <StudentLabGroups classId={classId} lab={g.lab} />
          )}
```

In `use-lab-groups.ts`, add to `CONFLICT_MESSAGE` (after `name_taken`):

```ts
  // Students only — teachers bypass the start gate entirely.
  not_started:
    "This lab hasn't started yet — groups and repositories open at the start time.",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @labs/www test -- student-lab-page`
Expected: PASS (all).

- [ ] **Step 5: Typecheck + biome + commit**

Run: `pnpm --filter @labs/www typecheck && pnpm biome`

```bash
git add apps/www/app/pages/student-lab-page.tsx apps/www/app/components/custom/classes/groups/shared/use-lab-groups.ts apps/www/test/student-lab-page.test.tsx
git commit -m "Gate the student lab page before the start"
```

---

### Task 9: Teacher note + escape-hatch warnings, final verification

**Files:**
- Modify: `apps/www/app/components/custom/classes/groups/teacher/teacher-lab-groups.tsx`
- Test: `apps/www/test/teacher-lab-page.test.tsx`

**Interfaces:**
- Consumes: `labStarted`, `formatDeadline` from `~/lib/format` (Task 6).
- Produces: the manage-page "Not started" note; the pre-start sentence in both create-repo confirm dialogs.

- [ ] **Step 1: Write the failing tests**

Append to `apps/www/test/teacher-lab-page.test.tsx`:

```tsx
  it("shows the not-started note and warns before pre-start repo creation", () => {
    mockApi({
      ...groupsData,
      lab: { ...groupLab, startAt: "2099-07-01T08:00:00.000Z" },
      groups: [grp({ members: [alice, bob] })],
    });
    render(<TeacherLabPage />);

    expect(
      screen.getByText(/Not started — opens for students on/),
    ).toBeInTheDocument();
    // The per-row create stays ENABLED (the escape hatch) but its confirm
    // names the consequence.
    fireEvent.click(screen.getByRole("button", { name: "Create repository" }));
    expect(screen.getByText(/before the start time/)).toBeInTheDocument();
  });

  it("shows no note and no warning once the lab has started", () => {
    mockApi({
      ...groupsData,
      lab: { ...groupLab, startAt: "2020-01-01T08:00:00.000Z" },
      groups: [grp({ members: [alice, bob] })],
    });
    render(<TeacherLabPage />);

    expect(screen.queryByText(/Not started/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create repository" }));
    expect(screen.queryByText(/before the start time/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @labs/www test -- teacher-lab-page`
Expected: FAIL — no note, no warning sentence.

- [ ] **Step 3: Implement**

In `teacher-lab-groups.tsx`, import `{ labStarted }` alongside the existing `~/lib/format` imports (`formatDeadline` may need adding too). In `TeacherLabGroups`:

```tsx
  const started = labStarted(lab);
```

Directly above `<LabStats`:

```tsx
      {!started && lab.startAt ? (
        <Text variant="body2" className="text-warning">
          Not started — opens for students on{" "}
          {formatDeadline(new Date(lab.startAt))}. Until then students see the
          lab in their list but cannot form groups or create repositories.
        </Text>
      ) : null}
```

Thread `started` down: add `started: boolean` to `RosterToolbar`'s props (pass `started={started}`) and to `GroupRow`'s props (pass `started={started}` where rows are rendered).

Batch confirm (`RosterToolbar`), description becomes:

```tsx
          description={
            "Every complete group that lacks a repository gets one. Creating a repository locks its group: students can no longer join or leave on their own." +
            (started
              ? ""
              : " This lab hasn't started: creating repositories now gives their groups access to the starter code before the start time.")
          }
```

Per-row confirm (`GroupRow`), description becomes:

```tsx
              description={
                "This locks the group: once the repository exists, students can no longer join or leave on their own." +
                (started
                  ? ""
                  : " This lab hasn't started: creating the repository now gives this group access to the starter code before the start time.")
              }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @labs/www test -- teacher-lab-page`
Expected: PASS (all).

- [ ] **Step 5: Full verification**

Run, all must pass:

```bash
pnpm biome
pnpm typecheck
pnpm --filter @labs/api test
pnpm --filter @labs/www test
```

Expected: biome clean (only the pre-existing schema-version info), both suites fully green.

- [ ] **Step 6: Commit and push the branch**

```bash
git add apps/www/app/components/custom/classes/groups/teacher/teacher-lab-groups.tsx apps/www/test/teacher-lab-page.test.tsx
git commit -m "Warn the teacher on pre-start labs and their repo escape hatch"
git push -u origin feat/lab-start-date
```
