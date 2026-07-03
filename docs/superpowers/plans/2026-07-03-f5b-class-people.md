# F5b — Live Class People Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Do NOT `git commit` anywhere in this plan — the user commits manually.**

**Goal:** The class card's dummy "24 students / 2 teachers" badges become live clickable chips whose popovers list the real org people (teachers = Owners, students = Members, plus pending join-link invitees).

**Architecture:** One new `orgPeople` helper (installation token, paginated) returns `{teachers, students, pending}`; `GET /api/classes` carries the arrays and derives the F5a teacher check from the same fetch (replacing the throwaway `isOrgAdmin` call in the list). The card swaps its static Badges for a new `PeopleChip` (Badge-shaped trigger + shadcn Popover). Spec: `docs/superpowers/specs/2026-07-03-f5b-class-people-design.md`.

**Tech Stack:** Hono/Workers, `octokit` App (paginate), React Router SPA, shadcn/Base UI Popover, Vitest.

## Global Constraints

- **NO COMMITS.** Work stays in the working tree; every task ends green but uncommitted. (User instruction 2026-07-03 — overrides any earlier commit-per-task convention.)
- Branch `milestone-3-enrollment` (working tree already has uncommitted F4 polish — do not revert or stash anything).
- Gate = `pnpm run biome && pnpm -r typecheck && pnpm -r test` from the repo ROOT.
- Biome style: double quotes, semicolons, 2-space indent, 80 cols.
- Type safety: response types via `hc<AppType>` inference; component prop types may be declared.
- Org reads via App **installation** token only; pagination `per_page: 100` everywhere a list can exceed a page.
- Per-class error containment in the classes list stays exactly as-is (one failing org skips that class only).
- 👁 visual gate at the end (dev flow: stop Worker, kill lingering `workerd`, `pnpm --filter @labs/www build`, restart `pnpm --filter @labs/api dev`, review on https://localhost:3000).

---

### Task 1: `apps/api` — paginate-capable App client + `orgPeople`

**Files:**
- Modify: `apps/api/src/github/clients.ts` (App import swap)
- Modify: `apps/api/src/github/org.ts` (add `orgPeople` + types)
- Modify: `apps/api/test/github-org.test.ts` (new tests)
- Modify: `apps/api/package.json` (drop `@octokit/app`)

**Interfaces:**
- Consumes: existing `installationOctokit(env, installationId)`.
- Produces (exported from `apps/api/src/github/org.ts`):
  - `type OrgPerson = { id: number; login: string; avatarUrl: string | null }`
  - `orgPeople(env: AuthEnv, installationId: number, org: string): Promise<{ teachers: OrgPerson[]; students: OrgPerson[]; pending: OrgPerson[] }>`

- [ ] **Step 1: Swap the App source so installation clients can paginate.** In `apps/api/src/github/clients.ts` change

```ts
import { App } from "@octokit/app";
```

to

```ts
import { App } from "octokit";
```

(`octokit` is already a dependency and its `App` is preconfigured with the pagination plugin — verified: `new App(...).octokit.paginate` is a function. `@octokit/app`'s default client has none.) Then remove the now-redundant direct dep:

Run: `pnpm --filter @labs/api remove @octokit/app`

Run: `pnpm --filter @labs/api typecheck` — expected green (the `App` surface used — `.octokit`, `.getInstallationOctokit` — is identical).

- [ ] **Step 2: Write the failing tests** — append to `apps/api/test/github-org.test.ts`. First extend the hoisted `state` object:

```ts
  admins: [] as Array<{ id: number; login: string; avatar_url: string }>,
  members: [] as Array<{ id: number; login: string; avatar_url: string }>,
  invitations: [] as Array<{
    id: number;
    login: string | null;
    email: string | null;
  }>,
```

Extend the `installationOctokit` mock object (alongside its existing `request`) with:

```ts
    paginate: async (route: string, params: { role?: string }) => {
      if (route === "GET /orgs/{org}/members") {
        return params.role === "admin" ? state.admins : state.members;
      }
      if (route === "GET /orgs/{org}/invitations") {
        return state.invitations;
      }
      throw new Error(`unexpected paginate ${route}`);
    },
```

Add `orgPeople` to the awaited import, then the tests:

```ts
test("orgPeople splits admins/members and maps pending invitations", async () => {
  state.admins = [{ id: 1, login: "prof", avatar_url: "http://p" }];
  state.members = [{ id: 2, login: "student", avatar_url: "http://s" }];
  state.invitations = [
    { id: 900, login: "invited-user", email: null },
    { id: 901, login: null, email: "ext@heig-vd.ch" },
  ];
  expect(await orgPeople(env, 1, "acme")).toEqual({
    teachers: [{ id: 1, login: "prof", avatarUrl: "http://p" }],
    students: [{ id: 2, login: "student", avatarUrl: "http://s" }],
    pending: [
      { id: 900, login: "invited-user", avatarUrl: null },
      { id: 901, login: "ext@heig-vd.ch", avatarUrl: null },
    ],
  });
});

test("orgPeople returns empty arrays for an empty org", async () => {
  state.admins = [];
  state.members = [];
  state.invitations = [];
  expect(await orgPeople(env, 1, "acme")).toEqual({
    teachers: [],
    students: [],
    pending: [],
  });
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm --filter @labs/api test test/github-org.test.ts` → FAIL (`orgPeople` not exported).

- [ ] **Step 4: Implement** — append to `apps/api/src/github/org.ts`:

```ts
export type OrgPerson = {
  id: number;
  login: string;
  avatarUrl: string | null;
};

/**
 * The class's people, read live with the installation token. Teachers = org
 * Owners (role admin), students = non-owner Members, pending = open
 * invitations (no avatar; login falls back to the invite email — labs only
 * creates username invites, but org owners can invite by email on GitHub).
 * Paginated so orgs beyond one page stay correct.
 */
export async function orgPeople(
  env: AuthEnv,
  installationId: number,
  org: string,
): Promise<{
  teachers: OrgPerson[];
  students: OrgPerson[];
  pending: OrgPerson[];
}> {
  const gh = await installationOctokit(env, installationId);
  const [admins, members, invitations] = await Promise.all([
    gh.paginate("GET /orgs/{org}/members", {
      org,
      role: "admin",
      per_page: 100,
    }),
    gh.paginate("GET /orgs/{org}/members", {
      org,
      role: "member",
      per_page: 100,
    }),
    gh.paginate("GET /orgs/{org}/invitations", { org, per_page: 100 }),
  ]);
  const person = (m: { id: number; login: string; avatar_url: string }) => ({
    id: m.id,
    login: m.login,
    avatarUrl: m.avatar_url,
  });
  return {
    teachers: admins.map(person),
    students: members.map(person),
    pending: invitations.map((i) => ({
      id: i.id,
      login: i.login ?? i.email ?? "invited",
      avatarUrl: null,
    })),
  };
}
```

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @labs/api test` → PASS.
- [ ] **Step 6: Gate** — `pnpm run biome && pnpm -r typecheck && pnpm -r test` → green. **Do not commit.**

---

### Task 2: `apps/api` — classes list carries people, teacher check reuses the fetch

**Files:**
- Modify: `apps/api/src/routes/classes.ts` (list handler only)
- Modify: `apps/api/test/classes-list.test.ts`

**Interfaces:**
- Consumes: `orgPeople`/`OrgPerson` (Task 1); existing `callerGithubId`.
- Produces: `GET /api/classes` items gain `teachers: OrgPerson[]`, `students: OrgPerson[]`, `pending: OrgPerson[]`. The confirm route and `isOrgAdmin` (`github/teacher.ts`) stay untouched — confirm still uses them.

- [ ] **Step 1: Update the tests** — in `apps/api/test/classes-list.test.ts`:

Add to the hoisted `state`:

```ts
  people: {
    teachers: [{ id: 111, login: "prof", avatarUrl: "http://p" }],
    students: [{ id: 2, login: "student", avatarUrl: "http://s" }],
    pending: [{ id: 900, login: "invited", avatarUrl: null }],
  } as {
    teachers: Array<{ id: number; login: string; avatarUrl: string | null }>;
    students: Array<{ id: number; login: string; avatarUrl: string | null }>;
    pending: Array<{ id: number; login: string; avatarUrl: string | null }>;
  },
```

(reset it to the same value in `beforeEach`). Add a module mock (classes.ts will import from `../src/github/org`):

```ts
vi.mock("../src/github/org", () => ({
  orgLogin: async () => "acme",
  orgPeople: vi.fn(async () => state.people),
}));
```

and import it for per-test overrides: `const { orgPeople } = await import("../src/github/org");`

Then: (a) in every expected `classes` body object add `teachers: state.people.teachers, students: state.people.students, pending: state.people.pending` (write the literals out — Biome will keep them stable); (b) REPLACE the F8-guard test that stubbed `isOrgAdmin` with the people-based equivalent:

```ts
test("skips a class when the caller has installation access but is NOT an org owner (F8 guard)", async () => {
  vi.mocked(orgPeople).mockResolvedValueOnce({
    teachers: [{ id: 999, login: "someone-else", avatarUrl: null }],
    students: [],
    pending: [],
  });
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ classes: [] });
});
```

(c) drop `isOrgAdmin` from the `../src/github/teacher` mock ONLY if nothing in this file still references it — `callerGithubId` stays; the failing-enrich test keeps working because `orgPeople` is reached after `GET /orgs/{org}` in the handler (see Step 3 order) — keep the existing `failInstallationIds` mechanism untouched.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @labs/api test test/classes-list.test.ts` → FAIL (missing fields, orgPeople never called).

- [ ] **Step 3: Implement** — in `apps/api/src/routes/classes.ts` list handler:

Imports: add `orgPeople` (and keep `orgLogin`) from `../github/org`; remove `isOrgAdmin` from the `../github/teacher` import (keep `callerGithubId` — and note `isOrgAdmin` is STILL imported/used by the confirm handler above; only remove it if the confirm handler's usage is also in this file — it is, so keep the import as-is and just stop calling it in the list).

Replace the list handler's per-class body (inside the existing `try`):

```ts
        const live = byOrgId.get(cls.orgId);
        if (!live) continue; // App uninstalled from this org — skip.

        // One people fetch serves both the teacher check (F5a: only live org
        // Owners see the class) and the card's people chips.
        const people = await orgPeople(
          c.env,
          live.installationId,
          live.login,
        );
        if (!people.teachers.some((t) => t.id === ghId)) {
          continue;
        }
        if (live.installationId !== cls.installationId) {
          await refreshInstallationId(
            db,
            cls.orgId,
            live.installationId,
            new Date(),
          );
        }
        const gh = await installationOctokit(c.env, live.installationId);
        const { data: org } = await gh.request("GET /orgs/{org}", {
          org: live.login,
        });
        out.push({
          id: cls.id,
          orgId: cls.orgId,
          joinToken: cls.joinToken,
          login: org.login,
          name: org.name ?? null,
          avatarUrl: org.avatar_url,
          teachers: people.teachers,
          students: people.students,
          pending: people.pending,
        });
```

and extend the `out` array's element type with:

```ts
      teachers: OrgPerson[];
      students: OrgPerson[];
      pending: OrgPerson[];
```

(`import type { OrgPerson } from "../github/org";`)

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @labs/api test` → PASS (list + untouched confirm suites).
- [ ] **Step 5: Gate** — full gate green (`www` typecheck re-infers `AppType`; the www build may now FAIL typecheck if `dummyClassMeta` still supplies `students`/`teachers` numbers that collide — it doesn't; ClassCard still accepts the numbers until Task 4, and the page spreads both. If a collision does surface, note it and proceed to Task 4 which resolves the seam, then run the gate again at Task 4's end). **Do not commit.**

---

### Task 3: `apps/www` — `PeopleChip` (Badge trigger + Popover)

**Files:**
- Create (generated): `apps/www/app/components/ui/popover.tsx`
- Create: `apps/www/app/components/custom/classes/people-chip.tsx`
- Test: `apps/www/test/people-chip.test.tsx`

**Interfaces:**
- Consumes: shadcn Popover (Base UI), `Badge`, `UserAvatar`, `Row`, `Stack`, `Text`.
- Produces: `PeopleChip({ label, people, emptyText })` with `type PersonRow = { login: string; avatarUrl: string | null; pending?: boolean }` (exported).

- [ ] **Step 1: Generate the Popover primitive**

Run: `pnpm dlx shadcn@latest add popover --cwd apps/www`

Then `pnpm run biome` (with `--write` via `pnpm exec biome check --write apps/www/app/components/ui/popover.tsx` if the generated file needs formatting — generated ui files are formatted to house style, never hand-edited otherwise). Inspect the generated exports (`Popover`, `PopoverTrigger`, `PopoverContent` — Base UI styles may also export `PopoverPositioner` etc.; use only the three).

- [ ] **Step 2: Write the failing test** — `apps/www/test/people-chip.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PeopleChip } from "~/components/custom/classes/people-chip";

describe("PeopleChip", () => {
  it("shows the label and opens a people list with GitHub links", async () => {
    render(
      <PeopleChip
        label="1 student · 1 pending"
        emptyText="No students yet."
        people={[
          { login: "alice", avatarUrl: "http://a" },
          { login: "bob", avatarUrl: null, pending: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("1 student · 1 pending"));

    expect(
      await screen.findByRole("link", { name: /@alice/ }),
    ).toHaveAttribute("href", "https://github.com/alice");
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    // Pending people have no profile row link.
    expect(
      screen.queryByRole("link", { name: /@bob/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the empty text when there is nobody", async () => {
    render(<PeopleChip label="0 students" emptyText="No students yet." people={[]} />);
    fireEvent.click(screen.getByText("0 students"));
    expect(await screen.findByText("No students yet.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm --filter @labs/www test test/people-chip.test.tsx` → FAIL (module missing).

- [ ] **Step 4: Implement** — `apps/www/app/components/custom/classes/people-chip.tsx`:

```tsx
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

export type PersonRow = {
  login: string;
  avatarUrl: string | null;
  /** Open invitation — greyed, badged, not linked (no profile yet). */
  pending?: boolean;
};

type PeopleChipProps = {
  /** e.g. "3 students · 1 pending" */
  label: string;
  people: PersonRow[];
  emptyText: string;
};

/**
 * A class-card state chip that opens the live people list. The trigger keeps
 * the Badge look; rows link to GitHub profiles (pending invitees have none).
 */
export function PeopleChip({ label, people, emptyText }: PeopleChipProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Badge
            variant="secondary"
            className="cursor-pointer font-normal hover:bg-secondary/80"
          />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        {people.length === 0 ? (
          <Text variant="body2" className="px-2 py-1">
            {emptyText}
          </Text>
        ) : (
          <Stack gap="none" className="w-full">
            {people.map((p) => {
              const row = (
                <Row gap="sm" className="w-full px-2 py-1.5">
                  <UserAvatar name={p.login} src={p.avatarUrl ?? undefined} />
                  <Text
                    variant="body2"
                    className={p.pending ? "text-muted-foreground" : undefined}
                  >
                    @{p.login}
                  </Text>
                  {p.pending ? (
                    <Badge variant="outline" className="ml-auto font-normal">
                      pending
                    </Badge>
                  ) : null}
                </Row>
              );
              return p.pending ? (
                <div key={p.login}>{row}</div>
              ) : (
                <a
                  key={p.login}
                  href={`https://github.com/${p.login}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md transition-colors hover:bg-muted"
                >
                  {row}
                </a>
              );
            })}
          </Stack>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

Adaptation notes (resolve against the actually-generated primitives, don't fight them): if the generated `PopoverTrigger` doesn't accept a `render` prop, use its documented composition mechanism (e.g. `asChild`); if `UserAvatar` has no default size that fits, pass its smallest existing size variant — do NOT add new size variants for this.

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @labs/www test` → PASS. (If jsdom doesn't render the popover content on click due to Base UI portal behavior, mount detection may need `await screen.findByText(...)` — already used; if it still fails, check the generated popover for an `open` default and test with the trigger click as shown, mirroring how `dropdown-menu` is tested if such a test exists.)
- [ ] **Step 6: Gate** — full gate green. **Do not commit.**

---

### Task 4: `apps/www` — ClassCard uses live chips; dummy counts die 👁

**Files:**
- Modify: `apps/www/app/components/custom/classes/class-card.tsx`
- Modify: `apps/www/app/lib/dummy.ts`
- Modify: `apps/www/test/class-card.test.tsx`

**Interfaces:**
- Consumes: `PeopleChip`/`PersonRow` (Task 3); `teachers`/`students`/`pending` arriving via the classes-page `{...cls}` spread (Task 2).
- Produces: `ClassCardProps` replaces `students: number; teachers: number` with `teachers: Person[]; students: Person[]; pending: Person[]` where `type Person = { id: number; login: string; avatarUrl: string | null }` (declared locally in class-card.tsx).

- [ ] **Step 1: Update the tests** — in `apps/www/test/class-card.test.tsx`, change `renderCard` to:

```tsx
function renderCard() {
  return render(
    <ClassCard
      login="acme"
      name="Acme"
      avatarUrl="http://a"
      joinToken="tok123"
      teachers={[{ id: 1, login: "prof", avatarUrl: "http://p" }]}
      students={[{ id: 2, login: "alice", avatarUrl: "http://s" }]}
      pending={[{ id: 900, login: "bob", avatarUrl: null }]}
      labs={[]}
    />,
  );
}
```

and add:

```tsx
describe("ClassCard people chips", () => {
  it("shows live counts with the pending suffix", () => {
    renderCard();
    expect(screen.getByText("1 student · 1 pending")).toBeInTheDocument();
    expect(screen.getByText("1 teacher")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @labs/www test test/class-card.test.tsx` → FAIL (prop types + missing chips).

- [ ] **Step 3: Implement** — in `class-card.tsx`:

Props: replace `students: number; teachers: number;` with

```tsx
type Person = { id: number; login: string; avatarUrl: string | null };
```

```tsx
  teachers: Person[];
  students: Person[];
  pending: Person[];
```

Replace the two `<Badge variant="secondary">…</Badge>` chips with:

```tsx
          <PeopleChip
            label={peopleLabel(students.length, "student", pending.length)}
            emptyText="No students yet — share the join link."
            people={[
              ...students.map((p) => ({
                login: p.login,
                avatarUrl: p.avatarUrl,
              })),
              ...pending.map((p) => ({
                login: p.login,
                avatarUrl: p.avatarUrl,
                pending: true,
              })),
            ]}
          />
          <PeopleChip
            label={peopleLabel(teachers.length, "teacher", 0)}
            emptyText="No teachers found."
            people={teachers.map((p) => ({
              login: p.login,
              avatarUrl: p.avatarUrl,
            }))}
          />
```

with the label helper (module scope, above the component):

```tsx
function peopleLabel(count: number, noun: string, pendingCount: number) {
  const base = `${count} ${noun}${count === 1 ? "" : "s"}`;
  return pendingCount > 0 ? `${base} · ${pendingCount} pending` : base;
}
```

Imports: add `PeopleChip` from `~/components/custom/classes/people-chip`; drop the `Badge` import if the card no longer uses it elsewhere (it doesn't). Update the card doc comment: people are now live (F5b); labs/progress remain dummy (F6/F8).

In `apps/www/app/lib/dummy.ts`: delete `students`/`teachers` from `ClassMeta` and from `dummyClassMeta`'s return (keep `labs`); update the file's header comment (member counts line goes away).

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @labs/www test` → PASS (fix any fixture typecheck fallout in `classes-page.test.tsx` by extending its `useApi` mock classes with `teachers: [], students: [], pending: []` if tsc complains — the fixtures are cast, so likely untouched).
- [ ] **Step 5: Gate** — full gate green. **Do not commit.**

---

### Task 5: Full gate, docs, 👁 visual gate

- [ ] **Step 1: Full gate** — `pnpm run biome && pnpm -r typecheck && pnpm -r test` → green.
- [ ] **Step 2: Docs** — tracker `docs/superpowers/plans/2026-06-30-labs-implementation.md`: F5 row → note F5b people-chips DONE (health chip still deferred to the detail page); session-log row. Ledger `.superpowers/sdd/progress.md`: F5b section + any new Minors. **No commit.**
- [ ] **Step 3: 👁 visual gate (user at the screen, https://localhost:3000)** — stop Worker → kill `workerd` → `pnpm --filter @labs/www build` → restart Worker. Review: real counts on *Test TWeb 2026* (1 teacher / 1 student after the F4 walk), chip popovers (rows link to GitHub profiles, new tab), pending row appears if an open invitation exists (re-run a join with a fresh invite to see it), empty-state text on a chip with nobody.

---

## Self-review (done at plan time)

- **Spec coverage:** orgPeople (3 lists, pagination, email fallback) → T1; ride-along + teacher-check reuse + containment → T2; PeopleChip/Popover + pending styling + empty text → T3; card swap + labels + dummy trim → T4; visual gate → T5. Health chip: out of scope per spec.
- **Placeholders:** none; every step carries code/commands. Two explicitly-bounded adaptation points (generated Popover API, UserAvatar size) with resolution rules.
- **Type consistency:** `OrgPerson`/`Person` `{id, login, avatarUrl: string|null}` end-to-end; `PersonRow` drops `id` (www key = login); `orgPeople` name identical in T1 impl, T2 mock/import; label format `"1 student · 1 pending"` matches T3's test and T4's helper.
