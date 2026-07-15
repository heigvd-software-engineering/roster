# Hybrid Identity + Affiliations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the private SWITCH email from every shared API payload and show hybrid identities (name + GitHub) everywhere, with affiliation emails revealed by a chevron on the identity component.

**Architecture:** `linkedUsers` (the single query feeding every `users` array) switches to an explicit safe shape and decodes each user's affiliation emails from their stored SWITCH `id_token` — no new storage. On the frontend, `PersonIdentity` gains `emails`, and `UserIdentity` renders a `DisclosureToggle` chevron that expands them inline; every call site that spreads `personIdentity(...)` gets the behavior for free.

**Tech Stack:** Hono + Drizzle (D1) on Workers, React Router SPA, vitest (+ vitest-pool-workers for the API), Testing Library, biome.

**Spec:** `docs/superpowers/specs/2026-07-15-hybrid-identity-affiliations-design.md`

## Global Constraints

- Branch: `hybrid-identity-affiliations` (already exists; work on it).
- All www commands run in `apps/www`, API tests in `apps/api`: `pnpm vitest run <file>`.
- Before every commit: `pnpm typecheck` (in the app dir) and `pnpm biome` (repo root) must pass; fix format with `./node_modules/.bin/biome check --write <files>` from the repo root.
- Commit messages follow the repo's conventional style (`feat(api):`, `feat(www):`, `refactor:`) and end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The private email must not appear in ANY response except `/api/me` (`apps/api/src/handlers/me.ts` — untouched).
- The caller's own menu (`apps/www/app/components/custom/shell/main-switch-identity.tsx`) is untouched.

## File Structure

- `apps/api/src/lib/access.ts` — `linkedUsers` safe shape + affiliation decode (only API change; both handlers inherit it).
- `apps/www/app/lib/identity.ts` — `PersonIdentity.emails`.
- `apps/www/app/components/custom/identity/user-identity.tsx` — `emails` prop + chevron + inline expansion.
- `apps/www/app/components/custom/disclosure-toggle.tsx` — gains a `size` prop (`"icon" | "icon-xs"`) so it fits inside small identity rows.
- `apps/www/app/components/custom/classes/hub/people-chip.tsx` — email subtitle → affiliations chevron.
- Tests alongside each.

---

### Task 1: linkedUsers — safe shape + affiliations from the stored id_token

**Files:**
- Modify: `apps/api/src/lib/access.ts:280-294` (the `linkedUsers` function)
- Test: `apps/api/test/classes-list.test.ts`

**Interfaces:**
- Produces: `linkedUsers(db, githubIds)` returns `Array<{ githubId: string; user: { firstName: string | null; lastName: string | null; name: string; affiliations: string[] } }>`. Every later task relies on this exact `user` shape (NO `id`, NO `email`).

- [ ] **Step 1: Write the failing test**

In `apps/api/test/classes-list.test.ts`, add a base64url JWT fixture near the top (after the imports):

```ts
/** A fake SWITCH id_token: only the payload matters (decodeJwtPayload). */
const idTokenWith = (emails: string[]) =>
  `h.${btoa(JSON.stringify({ swissEduIDLinkedAffiliationMail: emails }))}.s`;
```

In the existing test `"lists classes with people + linked users, from live installation data"`, seed a SWITCH account for `u1` right after `seedMembers()`:

```ts
await getDb(env.DB)
  .insert(account)
  .values({
    id: "a-switch",
    userId: "u1",
    providerId: "switch",
    accountId: "edu-1",
    idToken: idTokenWith(["b.prof@heig-vd.ch", "b.prof@unil.ch"]),
    createdAt: now,
    updatedAt: now,
  });
```

Replace the final `users[0]` assertion (the `toMatchObject` that currently expects `user: { id: "u1", firstName: ..., email: ... }`) with an exact-shape assertion:

```ts
expect(body.classes[0]?.users).toHaveLength(1);
// EXACT shape: the private email (and everything else) must not ride along.
expect(body.classes[0]?.users[0]).toEqual({
  githubId: "111",
  user: {
    firstName: "Bob",
    lastName: "Prof",
    name: "Prof Switch",
    affiliations: ["b.prof@heig-vd.ch", "b.prof@unil.ch"],
  },
});
```

Also add a new test for the no-switch-account case:

```ts
test("linked users without a SWITCH id_token get empty affiliations", async () => {
  await seedClass({ name: "Acme" });
  await seedMembers();
  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as {
    classes: Array<{ users: Array<{ user: Record<string, unknown> }> }>;
  };
  expect(body.classes[0]?.users[0]?.user).toEqual({
    firstName: "Bob",
    lastName: "Prof",
    name: "Prof Switch",
    affiliations: [],
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (in `apps/api`): `pnpm vitest run test/classes-list.test.ts`
Expected: FAIL — the current `user` object contains `id`, `email`, `emailVerified`, etc., and no `affiliations`.

- [ ] **Step 3: Implement the safe shape in linkedUsers**

Replace the `linkedUsers` function in `apps/api/src/lib/access.ts`:

```ts
/** SWITCH users linked to GitHub accounts, in the ONE shape that may leave
 *  the server for other class members: display-name fields + affiliation
 *  (professional) emails, decoded from each user's stored SWITCH id_token.
 *  The private login email NEVER rides here — /api/me alone may show it,
 *  and only to its owner. */
export async function linkedUsers(db: Db, githubIds: string[]) {
  if (githubIds.length === 0) return [];
  const rows = await db
    .select({
      githubId: account.accountId,
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      name: user.name,
    })
    .from(account)
    .innerJoin(user, eq(account.userId, user.id))
    .where(
      and(
        eq(account.providerId, "github"),
        inArray(account.accountId, githubIds),
      ),
    );
  if (rows.length === 0) return [];
  // Affiliations come from the stored SWITCH id_token (as fresh as that
  // user's last sign-in) — decoded here, never persisted separately.
  const switchRows = await db
    .select({ userId: account.userId, idToken: account.idToken })
    .from(account)
    .where(
      and(
        eq(account.providerId, "switch"),
        inArray(
          account.userId,
          rows.map((r) => r.userId),
        ),
      ),
    );
  const tokenByUserId = new Map(switchRows.map((r) => [r.userId, r.idToken]));
  return rows.map(({ githubId, userId, ...names }) => {
    const idToken = tokenByUserId.get(userId);
    return {
      githubId,
      user: {
        ...names,
        affiliations: idToken ? readAffiliationEmails(idToken) : [],
      },
    };
  });
}
```

Add the import at the top of `access.ts` (alongside the existing imports):

```ts
import { readAffiliationEmails } from "./switch/claims";
```

- [ ] **Step 4: Run the API test suite**

Run (in `apps/api`): `pnpm vitest run`
Expected: ALL PASS. If another API test asserted the old full-row shape, update it to the new exact shape from Step 1 — the new shape is the spec; old expectations are what changes.

- [ ] **Step 5: Typecheck + commit**

Run (in `apps/api`): `pnpm typecheck` → clean. Repo root: `pnpm biome` → clean.

```bash
git add apps/api/src/lib/access.ts apps/api/test/classes-list.test.ts
git commit -m "feat(api): linkedUsers ships name + affiliations, never the private email

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: PersonIdentity carries emails

**Files:**
- Modify: `apps/www/app/lib/identity.ts`
- Test: `apps/www/test/identity.test.ts`

**Interfaces:**
- Consumes: the linked-user shape from Task 1 (`affiliations: string[]` on the `user` object; typed end-to-end via `hc<AppType>` inference — no hand-written type).
- Produces: `PersonIdentity` gains `emails: string[]`; `personIdentity(person, linked?)` fills it with `linked?.affiliations ?? []`. The `linked` param type gains `affiliations?: string[]` (optional, so fixtures without it stay valid).

- [ ] **Step 1: Write the failing tests**

Add to `apps/www/test/identity.test.ts`:

```ts
it("carries the linked user's affiliation emails", () => {
  const p = personIdentity(
    { login: "alice", avatarUrl: null },
    {
      firstName: "Alice",
      lastName: "Ok",
      name: "alice",
      affiliations: ["alice@heig-vd.ch"],
    },
  );
  expect(p.emails).toEqual(["alice@heig-vd.ch"]);
});

it("has no emails when the person is unlinked", () => {
  const p = personIdentity({ login: "bob", avatarUrl: "http://b" });
  expect(p.emails).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run (in `apps/www`): `pnpm vitest run test/identity.test.ts`
Expected: FAIL — `emails` is undefined.

- [ ] **Step 3: Implement**

In `apps/www/app/lib/identity.ts`, extend the type and function:

```ts
/** How one person is shown, wherever they appear. */
export type PersonIdentity = {
  /** The display name: the SWITCH identity when linked, else the login. */
  name: string;
  /** The GitHub login, always — rendered as a mono "@handle". */
  handle: string;
  /** The photo, or null when the avatar should fall back to initials. */
  avatarUrl: string | null;
  /** Affiliation (professional) emails — the ONLY emails the app ever
   *  shows for another person. Empty when unlinked or none on record. */
  emails: string[];
};
```

```ts
export function personIdentity(
  person: { login: string | null; avatarUrl: string | null },
  linked?: {
    firstName: string | null;
    lastName: string | null;
    name: string;
    affiliations?: string[];
  },
): PersonIdentity {
  const handle = person.login ?? "unknown";
  const emails = linked?.affiliations ?? [];
  return linked
    ? { name: switchDisplayName(linked), handle, avatarUrl: null, emails }
    : { name: handle, handle, avatarUrl: person.avatarUrl, emails };
}
```

- [ ] **Step 4: Run www tests**

Run (in `apps/www`): `pnpm vitest run`
Expected: ALL PASS (spread call sites now pass an extra `emails` prop that `UserIdentity` ignores until Task 3 — React tolerates it, TS may not; if `pnpm typecheck` errors on unknown prop `emails`, proceed to Task 3 before committing and commit both together with Task 3's message).

- [ ] **Step 5: Typecheck + commit (if independent)**

Run (in `apps/www`): `pnpm typecheck`. If clean:

```bash
git add apps/www/app/lib/identity.ts apps/www/test/identity.test.ts
git commit -m "feat(www): personIdentity carries affiliation emails

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: UserIdentity chevron — expandable emails

**Files:**
- Modify: `apps/www/app/components/custom/identity/user-identity.tsx`
- Modify: `apps/www/app/components/custom/disclosure-toggle.tsx` (add `size` prop)
- Test: `apps/www/test/user-identity.test.tsx`

**Interfaces:**
- Consumes: `PersonIdentity.emails` (Task 2) — arrives automatically at every `{...personIdentity(...)}` spread site.
- Produces: `UserIdentity` accepts `emails?: string[]`; renders a chevron (accessible name `` `Show ${name}'s emails` `` / `` `Hide ${name}'s emails` ``) only when non-empty. `DisclosureToggle` accepts `size?: "icon" | "icon-xs"` (default `"icon"` — existing call sites unchanged).

- [ ] **Step 1: Write the failing tests**

Add to `apps/www/test/user-identity.test.tsx`:

```tsx
it("hides emails behind a chevron and expands them on click", () => {
  render(
    <UserIdentity
      name="Alice"
      handle="alice"
      emails={["alice@heig-vd.ch", "alice@unil.ch"]}
    />,
  );

  expect(screen.queryByText("alice@heig-vd.ch")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Show Alice's emails" }),
  );
  expect(screen.getByText("alice@heig-vd.ch")).toBeInTheDocument();
  expect(screen.getByText("alice@unil.ch")).toBeInTheDocument();
  // The toggle now offers to hide.
  expect(
    screen.getByRole("button", { name: "Hide Alice's emails" }),
  ).toBeInTheDocument();
});

it("renders no chevron when there are no emails", () => {
  render(<UserIdentity name="Bob" handle="bob" emails={[]} />);
  expect(
    screen.queryByRole("button", { name: "Show Bob's emails" }),
  ).not.toBeInTheDocument();
});
```

(`fireEvent` is already imported in this file's sibling tests; add it to the `@testing-library/react` import if missing.)

- [ ] **Step 2: Run to verify failure**

Run (in `apps/www`): `pnpm vitest run test/user-identity.test.tsx`
Expected: FAIL — unknown prop / no chevron rendered.

- [ ] **Step 3: Implement**

`disclosure-toggle.tsx` — add the size prop (default keeps existing call sites identical):

```tsx
export function DisclosureToggle({
  expanded,
  onToggle,
  label,
  title,
  controls,
  size = "icon",
}: {
  expanded: boolean;
  onToggle: () => void;
  /** The accessible name; state-dependent ("Show all 12 students" / "Hide…"). */
  label: string;
  /** Hover text, when the label is too terse to explain the consequence. */
  title?: string;
  /** id of the region this controls — omit while that region is unmounted. */
  controls?: string;
  /** "icon-xs" fits inside compact rows (identity lists). */
  size?: "icon" | "icon-xs";
}) {
  return (
    <Button
      variant="ghost"
      size={size}
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      title={title ?? label}
      onClick={onToggle}
    >
      <ChevronDown
        className={cn(
          "size-4 text-muted-foreground transition-transform",
          size === "icon-xs" && "size-3.5",
          expanded && "rotate-180",
        )}
      />
    </Button>
  );
}
```

`user-identity.tsx` — new prop + state + expansion. New imports:

```tsx
import { type ReactNode, useId, useState } from "react";
import { DisclosureToggle } from "~/components/custom/disclosure-toggle";
```

Add to `UserIdentityProps`:

```tsx
  /** Affiliation emails, revealed by a chevron — `personIdentity` supplies
   *  these for roster people; empty/omitted renders no chevron. */
  emails?: string[];
```

Component body (full replacement):

```tsx
export function UserIdentity({
  name,
  handle,
  subtitle,
  avatarUrl,
  size = "sm",
  action,
  emails,
  className,
}: UserIdentityProps) {
  const large = size === "lg";
  const [open, setOpen] = useState(false);
  const listId = useId();
  const hasEmails = emails !== undefined && emails.length > 0;
  return (
    <Row gap="sm" align="center" className={className}>
      <UserAvatar name={name} src={avatarUrl} size={large ? "lg" : "sm"} />
      <Stack gap="none" className="min-w-0">
        <Text
          variant={large ? "label" : "caption"}
          as="span"
          className={cn("truncate", !large && "font-medium text-foreground")}
        >
          {name}
        </Text>
        {handle !== undefined ? (
          <Text variant="caption" as="span" className="truncate font-mono">
            @{handle}
          </Text>
        ) : null}
        {subtitle !== undefined ? (
          <Text variant="caption" as="span" className="truncate">
            {subtitle}
          </Text>
        ) : null}
        {hasEmails && open ? (
          <Stack gap="none" id={listId}>
            {emails.map((email) => (
              <Text
                key={email}
                variant="caption"
                as="span"
                className="truncate"
              >
                {email}
              </Text>
            ))}
          </Stack>
        ) : null}
      </Stack>
      {hasEmails ? (
        <DisclosureToggle
          expanded={open}
          onToggle={() => setOpen(!open)}
          label={open ? `Hide ${name}'s emails` : `Show ${name}'s emails`}
          controls={open ? listId : undefined}
          size="icon-xs"
        />
      ) : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </Row>
  );
}
```

- [ ] **Step 4: Run www tests + typecheck**

Run (in `apps/www`): `pnpm vitest run && pnpm typecheck`
Expected: ALL PASS (this also resolves Task 2's possible pending typecheck).

- [ ] **Step 5: Commit**

Repo root: `pnpm biome` → fix with `--write` if needed.

```bash
git add apps/www/app/components/custom/identity/user-identity.tsx apps/www/app/components/custom/disclosure-toggle.tsx apps/www/test/user-identity.test.tsx
git commit -m "feat(www): UserIdentity reveals affiliation emails behind a chevron

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(If Task 2 deferred its commit, include `apps/www/app/lib/identity.ts` and `apps/www/test/identity.test.ts` here.)

---

### Task 4: PeopleChip — private email out, affiliations in

**Files:**
- Modify: `apps/www/app/components/custom/classes/hub/people-chip.tsx:75-85`
- Test: `apps/www/test/people-chip.test.tsx`

**Interfaces:**
- Consumes: `UserIdentity`'s `emails` prop (Task 3); the new linked-user shape (Task 1) arrives via the inferred `ClassItem["users"][number]["user"]` type — `LinkedUser` in this file updates itself.

- [ ] **Step 1: Update the fixture and write the failing test**

In `apps/www/test/people-chip.test.tsx`, the linked-user fixture currently carries the full user row (`email`, `emailVerified`, …). Replace it with the new shape:

```ts
const linkedAlice = {
  firstName: "Alice",
  lastName: "Ok",
  name: "alice",
  affiliations: ["alice@heig-vd.ch"],
};
```

(Adapt the variable name to what the file actually uses; keep `firstName`/`lastName` values the existing assertions expect.) Then add:

```tsx
it("never shows a private email; affiliations expand on demand", async () => {
  render(
    <PeopleChip
      label="1 student"
      people={[{ login: "alice", avatarUrl: null, user: linkedAlice }]}
      emptyText="nobody"
    />,
  );
  fireEvent.click(screen.getByText("1 student"));

  // Collapsed: name only — no email in sight.
  expect(screen.queryByText("alice@heig-vd.ch")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Show Alice Ok's emails" }),
  );
  expect(screen.getByText("alice@heig-vd.ch")).toBeInTheDocument();
});
```

(Match the `people` element shape to the existing tests in the file — they may carry extra member fields; keep those.)

- [ ] **Step 2: Run to verify failure**

Run (in `apps/www`): `pnpm vitest run test/people-chip.test.tsx`
Expected: the new test FAILS (email renders immediately as subtitle, no chevron); pre-existing tests may also fail on the fixture change — expected, they're updated next.

- [ ] **Step 3: Implement**

In `people-chip.tsx`, replace the Switch-identity cell (lines ~75-85):

```tsx
<TableCell>
  {p.user ? (
    // SWITCH identity: initials, never a photo. The private email is
    // gone — affiliation emails hide behind the chevron instead.
    <UserIdentity
      name={switchDisplayName(p.user)}
      emails={p.user.affiliations}
    />
  ) : (
    <Text variant="body2">not linked</Text>
  )}
</TableCell>
```

Update any other assertion in `people-chip.test.tsx` that expected the old email subtitle to instead expect its absence.

- [ ] **Step 4: Run www tests**

Run (in `apps/www`): `pnpm vitest run`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/www/app/components/custom/classes/hub/people-chip.tsx apps/www/test/people-chip.test.tsx
git commit -m "feat(www): PeopleChip drops the private email for on-demand affiliations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire-through proof on the rosters + full verification

**Files:**
- Test: `apps/www/test/teacher-lab-page.test.tsx` (fixture + one test)
- No production code expected — the spread sites (`group-tile.tsx:135`, `unassigned-pool.tsx:41`, `teacher-lab-groups.tsx:540`) already forward `emails` via `{...personIdentity(...)}`.

**Interfaces:**
- Consumes: everything above. This task PROVES the drawer roster shows the chevron with zero call-site changes.

- [ ] **Step 1: Write the failing-or-passing wire-through test**

In `apps/www/test/teacher-lab-page.test.tsx`, the `users` fixture entries have shape `{ githubId, user: { firstName, lastName, name } }`. Add `affiliations` to one and a test:

```tsx
it("reveals a member's affiliation emails from the drawer roster", () => {
  mockApi({
    ...groupsData,
    groups: [grp({ members: [alice] })],
    users: [
      {
        githubId: "7",
        user: {
          firstName: "Alice",
          lastName: "Ok",
          name: "alice",
          affiliations: ["alice@heig-vd.ch"],
        },
      },
    ],
  });
  render(<TeacherLabPage />);

  fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
  expect(screen.queryByText("alice@heig-vd.ch")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Show Alice Ok's emails" }),
  );
  expect(screen.getByText("alice@heig-vd.ch")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it**

Run (in `apps/www`): `pnpm vitest run test/teacher-lab-page.test.tsx`
Expected: PASS with no production change (the point of the task). If it fails, the spread chain broke somewhere — fix the actual gap, don't special-case the test.

- [ ] **Step 3: Full verification**

- `apps/www`: `pnpm vitest run && pnpm typecheck` → all green.
- `apps/api`: `pnpm vitest run && pnpm typecheck` → all green.
- Repo root: `pnpm biome` → clean.
- Grep proof the leak is closed: `grep -rn "user\.email" apps/www/app apps/api/src --include=*.ts --include=*.tsx` must show hits ONLY in `main-switch-identity.tsx` (own menu) and auth internals — none in shared payloads or people lists.

- [ ] **Step 4: Commit**

```bash
git add apps/www/test/teacher-lab-page.test.tsx
git commit -m "test(www): prove the roster drawer reveals affiliations end-to-end

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- Spec coverage: API strip + decode (Task 1), PersonIdentity (Task 2), UserIdentity chevron (Task 3), PeopleChip (Task 4), every-surface wire-through + leak grep (Task 5). Own-menu untouched (Global Constraints). Accepted trade needs no code.
- Type ripples flow through `hc<AppType>` inference — no hand-written API types anywhere; if a www type error appears after Task 1, it is a REAL consumer of a stripped field: check the spec before re-adding anything.
- `switchDisplayName` needs `firstName`/`lastName`/`name` — all present in the safe shape (Task 1 produces exactly what Task 2's `linked` param consumes).
