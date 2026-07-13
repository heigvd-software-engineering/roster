# Group Lock on Repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a lab group's work repository exists, students can neither join nor leave it on their own — enforced by the API, mirrored by disabled UI, and warned about at repo-creation time.

**Architecture:** Two one-line 409 guards in the existing membership handlers (`apps/api/src/handlers/groups.ts`), reusing the `has_repo` error that `deleteGroup` already returns for the same condition. The frontend mirrors the guards with the repo's existing disabled-button-plus-`title` pattern and gates the group-mode "Create repository" action behind the existing `ConfirmDialog` component. No schema changes, no new endpoints, no new components.

**Tech Stack:** Hono handlers + Drizzle (apps/api, vitest with `cloudflare:test`), React + shadcn (apps/www, vitest + testing-library).

**Spec:** `docs/superpowers/specs/2026-07-13-group-lock-on-repo-design.md`

## Global Constraints

- Follow `AGENTS.md`: no hand-written types that duplicate DB rows; frontend talks to the API only through the RPC client; response shapes stay inferred.
- Error vocabulary: the lock returns `409 { error: "has_repo" }` — the exact code `deleteGroup` already uses. Do NOT invent a new error code.
- Teacher endpoints (`addGroupMember`, `removeGroupMember`) get NO repo guard — they are the deliberate escape hatch.
- Exact UI copy (verbatim, used in both implementation and tests):
  - Leave tooltip (locked): `The group's work repository exists — ask your teacher to move you.`
  - Join tooltip (locked): `This group's repository exists — only your teacher can add members.`
  - Create-repo dialog title: `Create the work repository?`
  - Create-repo dialog description: `This locks the group: once the repository exists, nobody can join or leave on their own — only your teacher can change the group. Make sure everyone is in before you continue.`
  - Teacher batch dialog title: `Create the missing repositories?`
  - Teacher batch dialog description: `Every complete group that lacks a repository gets one. Creating a repository locks its group: students can no longer join or leave on their own.`
  - `has_repo` error strip copy: `This group already has its work repository — only your teacher can change or delete it.`
- Commands run from the repo root (`/Users/stefanteofanovic/Desktop/HEIG-VD/classroom/labs`). Branch: `milestone-8-security`.
- Comment style: match the file — short, explains WHY, sentence case.

---

### Task 1: Backend 409 guards on join/leave

**Files:**
- Modify: `apps/api/src/handlers/groups.ts:22-48` (joinGroup, leaveGroup)
- Test: `apps/api/test/groups.test.ts`

**Interfaces:**
- Consumes: `groupInClass(access, groupId)` already returns the full group row including `ghRepoId` (see `deleteGroup` at line 89 using `group.ghRepoId`).
- Produces: `PUT/DELETE /api/classes/:id/groups/:groupId/membership` now return `409 { error: "has_repo" }` when `groups.ghRepoId` is not null. Task 2's error copy handles this code on the frontend.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/groups.test.ts`, right after the `"leave removes the CALLER from the team"` test (line ~227). The `seedGroup` helper already supports `repo: true` (seeds `ghRepoId`/`ghRepoFullName`); an empty `state.calls` proves the handler bailed before touching GitHub.

```ts
// --- the repo lock: membership freezes once the work repo exists ---

test("join is refused once the work repo exists (locked group)", async () => {
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true, members: [bob] });

  const res = await join();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "has_repo" });
  expect(state.calls).toEqual([]);
});

test("leave is refused once the work repo exists (locked group)", async () => {
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true, members: [alice] });

  const res = await app.request(
    "/api/classes/c1/groups/g1/membership",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "has_repo" });
  expect(state.calls).toEqual([]);
});

test("a teacher still ADDS members to a locked group (escape hatch)", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true, members: [bob] });

  const res = await app.request(
    "/api/classes/c1/groups/g1/members/carol",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "addTeamMember", args: ["g1-slug", "carol"] },
  ]);
});

test("a teacher still REMOVES members from a locked group (escape hatch)", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true, members: [alice, bob] });

  const res = await app.request(
    "/api/classes/c1/groups/g1/members/bob",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "removeTeamMember", args: ["g1-slug", "bob"] },
  ]);
});
```

- [ ] **Step 2: Run the tests to verify the right ones fail**

Run: `pnpm --filter @labs/api exec vitest run test/groups.test.ts`
Expected: the two `refused once the work repo exists` tests FAIL (handlers return 200, `state.calls` non-empty). The two teacher escape-hatch tests PASS already (no guard exists on those paths — they pin the invariant). All pre-existing tests PASS.

- [ ] **Step 3: Add the guards**

In `apps/api/src/handlers/groups.ts`, insert the same guard into both handlers, directly after the `if (!group)` check and before any other work (it's the cheapest check — no extra query):

`joinGroup` — replace lines 22-36 with:

```ts
/** Join the group — the caller only ever adds THEMSELVES. Refused when it
 *  would put them in two groups OF THE SAME LAB, or when the group's work
 *  repo exists: a locked group only changes through the teacher. */
export const joinGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  // The repo lock (same vocabulary as delete): joining a team means push on
  // its work repo — once that repo exists, only the teacher moves people.
  if (group.ghRepoId !== null) {
    return c.json({ error: "has_repo" }, 409);
  }
  if (await alreadyInLabGroup(access, group.labId, access.login, group.id)) {
    return c.json({ error: "member_already_participating" }, 409);
  }
  await access.team.add(group.ghTeamSlug, access.login);
  await access.team.syncMembers(group);
  return c.json({ ok: true });
});
```

`leaveGroup` — replace lines 38-48 with:

```ts
/** Leave the group — the caller only ever removes THEMSELVES. Refused once
 *  the work repo exists: the lock keeps students from hopping between
 *  groups after work has started. */
export const leaveGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  if (group.ghRepoId !== null) {
    return c.json({ error: "has_repo" }, 409);
  }
  await access.team.remove(group.ghTeamSlug, access.login);
  await access.team.syncMembers(group);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @labs/api exec vitest run test/groups.test.ts`
Expected: ALL tests PASS (including the pre-existing join/leave tests — their seeded groups have no repo, so the guard lets them through).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @labs/api typecheck
git add apps/api/src/handlers/groups.ts apps/api/test/groups.test.ts
git commit -m "feat(api): lock group membership once the work repo exists

Join and leave return 409 has_repo when groups.ghRepoId is set — a student
could previously leave a repo-having group, join another, and read its work
(push rides on the GitHub team). Teacher add/remove stay unguarded as the
escape hatch.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Student UI — disabled Leave/Join with tooltips, error copy

**Files:**
- Modify: `apps/www/app/components/custom/classes/groups/student/student-lab-groups.tsx:121-204` (Leave and Join buttons)
- Modify: `apps/www/app/components/custom/classes/groups/shared/use-lab-groups.ts:57-58` (`has_repo` copy)
- Test: `apps/www/test/student-lab-page.test.tsx`

**Interfaces:**
- Consumes: Task 1's 409 `has_repo` on join/leave; `GroupItem.repoFullName: string | null` already on every group in the response.
- Produces: nothing downstream — pure view changes.

- [ ] **Step 1: Write the failing tests**

Add to `apps/www/test/student-lab-page.test.tsx`, inside the `"StudentLabPage — group lab"` describe block (after the `"start card turns to the clone instructions..."` test, line ~173):

```tsx
it("locks Leave once your group's repo exists", () => {
  mockApi(
    groupsData({
      groups: [
        grp({ members: [alice, bob], repoFullName: "acme/lab-1-team-alpha" }),
      ],
    }),
  );
  render(<StudentLabPage />);

  const leave = screen.getByRole("button", { name: "Leave" });
  expect(leave).toBeDisabled();
  expect(leave).toHaveAttribute(
    "title",
    "The group's work repository exists — ask your teacher to move you.",
  );
});

it("locks Join on a group whose repo exists", () => {
  // Someone else's group: room left (1/3) but already locked by its repo.
  mockApi(
    groupsData({
      groups: [
        grp({ members: [bob], repoFullName: "acme/lab-1-team-alpha" }),
      ],
    }),
  );
  render(<StudentLabPage />);

  const join = screen.getByRole("button", { name: "Join" });
  expect(join).toBeDisabled();
  expect(join).toHaveAttribute(
    "title",
    "This group's repository exists — only your teacher can add members.",
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @labs/www exec vitest run test/student-lab-page.test.tsx`
Expected: both new tests FAIL (`expect(leave).toBeDisabled()` — the buttons are enabled today). All pre-existing tests PASS.

- [ ] **Step 3: Implement the disabled states**

In `apps/www/app/components/custom/classes/groups/student/student-lab-groups.tsx`:

(a) In the `if (mine)` group-mode branch (line 121), compute the lock before the `return` and use it on the Leave button. Replace lines 121-153's opening with:

```tsx
  if (mine) {
    // Once the work repo exists the group is LOCKED — the server refuses
    // join/leave (409 has_repo); the disabled state just says so up front
    // (same pattern as the teacher's Delete button).
    const locked = mine.repoFullName !== null;
    return (
```

and the Leave button (inside `actions=`) becomes:

```tsx
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={g.busy || locked}
                  title={
                    locked
                      ? "The group's work repository exists — ask your teacher to move you."
                      : "Leave this group"
                  }
                  onClick={() => g.leave(mine.id)}
                >
                  Leave
                </Button>
              }
```

(b) In the browse branch (line ~189), the Join button stays visible while the group has room but disables once its repo exists:

```tsx
              actions={
                group.members.length < g.max ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={g.busy || group.repoFullName !== null}
                    title={
                      group.repoFullName !== null
                        ? "This group's repository exists — only your teacher can add members."
                        : "Join this group for the lab"
                    }
                    onClick={() => g.join(group.id)}
                  >
                    Join
                  </Button>
                ) : null
              }
```

(c) In `apps/www/app/components/custom/classes/groups/shared/use-lab-groups.ts` lines 57-58, the `has_repo` copy no longer only covers delete. Replace:

```ts
      case "has_repo":
        return "This group already has its work repository — only your teacher can change or delete it.";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @labs/www exec vitest run test/student-lab-page.test.tsx`
Expected: ALL tests PASS (the `"collapses to YOUR group"` test's group has no repo, so its Leave button stays enabled).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @labs/www typecheck
git add apps/www/app/components/custom/classes/groups/student/student-lab-groups.tsx apps/www/app/components/custom/classes/groups/shared/use-lab-groups.ts apps/www/test/student-lab-page.test.tsx
git commit -m "feat(www): disable Leave/Join on locked groups with explanatory tooltips

Mirrors the new API repo lock the way the teacher's Delete button already
does: visible, disabled, and the title says why.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Confirm dialog on the group-mode "Create repository"

**Files:**
- Modify: `apps/www/app/components/custom/classes/groups/student/start-lab-card.tsx:91-112` (the `create` state)
- Test: `apps/www/test/student-lab-page.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` from `~/components/custom/confirm-dialog` (props: `trigger: ReactElement`, `title`, `description`, `confirmLabel`, `onConfirm`) — same usage as the teacher's Delete button.
- Produces: nothing downstream. Individual mode keeps the plain button (a solo retry has nothing to warn about).

- [ ] **Step 1: Write the failing test**

In `apps/www/test/student-lab-page.test.tsx`: add `fireEvent` to the testing-library import on line 1:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
```

Then add inside `"StudentLabPage — group lab"`:

```tsx
it("warns that creating the repo locks the group, before creating", () => {
  mockApi(groupsData({ groups: [grp({ members: [alice, bob] })] }));
  render(<StudentLabPage />);

  // The button no longer fires directly — it opens the confirm gate.
  fireEvent.click(screen.getByRole("button", { name: "Create repository" }));
  expect(screen.getByText("Create the work repository?")).toBeInTheDocument();
  expect(screen.getByText(/This locks the group/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @labs/www exec vitest run test/student-lab-page.test.tsx`
Expected: the new test FAILS (`getByText("Create the work repository?")` finds nothing — the click fires `createRepo` directly today). All others PASS.

- [ ] **Step 3: Implement the confirm gate**

In `apps/www/app/components/custom/classes/groups/student/start-lab-card.tsx`:

Add the import:

```tsx
import { ConfirmDialog } from "~/components/custom/confirm-dialog";
```

Replace the `state === "create"` branch (lines 91-112) with — individual keeps the plain retry button, group mode gets the gate:

```tsx
        ) : state === "create" ? (
          <>
            <Text variant="body2">
              {mode === "individual"
                ? "Your repository couldn't be created yet — try again."
                : "Create your group's work repository to begin."}
            </Text>
            {mode === "individual" ? (
              <Button
                size="sm"
                type="button"
                className="self-start"
                disabled={busy}
                title="Create your work repository"
                onClick={onCreate}
              >
                Create repository
              </Button>
            ) : (
              // Creating the repo LOCKS the group (server: 409 has_repo on
              // join/leave) — make the point of no return explicit.
              <ConfirmDialog
                title="Create the work repository?"
                description="This locks the group: once the repository exists, nobody can join or leave on their own — only your teacher can change the group. Make sure everyone is in before you continue."
                confirmLabel="Create repository"
                onConfirm={onCreate}
                trigger={
                  <Button
                    size="sm"
                    type="button"
                    className="self-start"
                    disabled={busy}
                    title="Create your group's work repository — this locks the group"
                  >
                    Create repository
                  </Button>
                }
              />
            )}
          </>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @labs/www exec vitest run test/student-lab-page.test.tsx`
Expected: ALL tests PASS. (The `"collapses to YOUR group"` test only asserts the trigger button exists — unaffected. The individual-lab tests hit the `mode === "individual"` plain button — unaffected.)

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @labs/www typecheck
git add apps/www/app/components/custom/classes/groups/student/start-lab-card.tsx apps/www/test/student-lab-page.test.tsx
git commit -m "feat(www): confirm gate on group repo creation — it locks the group

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Confirm dialog on the teacher's batch "Create N missing repositories"

**Files:**
- Modify: `apps/www/app/components/custom/classes/groups/teacher/teacher-lab-groups.tsx:296-307` (the toolbar batch button — today it fires directly, with no confirm)
- Test: `apps/www/test/teacher-lab-page.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` — already imported in this file (the Delete button uses it).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Add to `apps/www/test/teacher-lab-page.test.tsx` inside the `TeacherLabPage` describe block:

```tsx
it("confirms the batch repo creation and says it locks the groups", () => {
  // Team Alpha is complete (2/2) with no repo → 1 missing repository.
  mockApi({ ...groupsData, groups: [grp({ members: [alice, bob] })] });
  render(<TeacherLabPage />);

  fireEvent.click(
    screen.getByRole("button", { name: "Create 1 missing repository" }),
  );
  expect(
    screen.getByText("Create the missing repositories?"),
  ).toBeInTheDocument();
  expect(screen.getByText(/locks its group/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @labs/www exec vitest run test/teacher-lab-page.test.tsx`
Expected: the new test FAILS (no dialog — the click calls `createMissingRepos` directly today). All others PASS.

- [ ] **Step 3: Wrap the button in the confirm gate**

In `apps/www/app/components/custom/classes/groups/teacher/teacher-lab-groups.tsx`, replace the `missingCount > 0` block (lines 296-307) with:

```tsx
      {missingCount > 0 ? (
        // Repo creation LOCKS each group (students can't join/leave after) —
        // worth an explicit confirm on the batch, like the drawer's Delete.
        <ConfirmDialog
          title="Create the missing repositories?"
          description="Every complete group that lacks a repository gets one. Creating a repository locks its group: students can no longer join or leave on their own."
          confirmLabel="Create repositories"
          onConfirm={() => g.createMissingRepos()}
          trigger={
            <Button
              size="sm"
              type="button"
              disabled={g.busy}
              title="Create the work repository for every complete group that lacks one"
            >
              Create {missingCount} missing{" "}
              {missingCount === 1 ? "repository" : "repositories"}
            </Button>
          }
        />
      ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @labs/www exec vitest run test/teacher-lab-page.test.tsx`
Expected: ALL tests PASS (the default `groupsData` has Team Alpha under min → `missingCount === 0` → no button, so the other tests never see the dialog).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @labs/www typecheck
git add apps/www/app/components/custom/classes/groups/teacher/teacher-lab-groups.tsx apps/www/test/teacher-lab-page.test.tsx
git commit -m "feat(www): confirm gate on the teacher's batch repo creation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm biome`
Expected: no errors (a schema-version notice is known noise).

- [ ] **Step 2: Typecheck everything**

Run: `pnpm typecheck`
Expected: PASS in every package (a Node version warning in apps/www is known noise).

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: ALL suites PASS — was 280 tests across 42 files before this plan; now +8 (4 api, 4 www).

- [ ] **Step 4: Fix anything that surfaced, amend the relevant task's commit**

If a failure traces to one of Tasks 1-4, fix it in that task's files and commit as `fix: <what>` — do not force-push or rewrite earlier commits.
