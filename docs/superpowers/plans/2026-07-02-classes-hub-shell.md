# Classes hub — shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Design spec: `docs/superpowers/specs/2026-07-02-classes-hub-design.md`. **Commit per task** (commit-per-milestone mode; NO `Co-Authored-By` trailer). This is the **shell only** — the labs rows/detail/new-lab fill in with F4–F8.

**Goal:** Move the class list off the placeholder home into a dedicated top-aligned **`/classes`** hub (no "Welcome"); `/` redirects there; each class is a shadcn **Card** with an empty "No labs yet" slot ready for F6.

**Architecture:** `apps/www` React Router SPA. A new `/classes` route renders `ClassesPage` (the "Connect org" action + the live class list via `hc<AppType>`). The index route `/` becomes a redirect to `/classes` for signed-in users (login otherwise). `ClassCard` upgrades from a plain row to a shadcn `Card` that will host lab rows later.

**Tech Stack:** React Router 7, shadcn/ui (`card`), Tailwind, `hc<AppType>` client, Vitest + Testing Library, Biome.

## Global Constraints

- **UI:** shadcn/ui + Tailwind; wrap Tailwind into named components under `app/components/custom/` (layout via `Stack`/`Row`/`Container`, text via `Text`). No utility-class soup in pages.
- **Types:** response shapes inferred via `hc<AppType>` (`~/lib/api`) — never hand-declared.
- **SPA:** `ssr:false`; `~` alias → `app/`.
- **Biome:** double quotes, semicolons, 2-space indent, 80 cols.
- **👁 Visual gate:** every viewable change ends by running the dev server (or the same-origin Worker) and reviewing the real screen together.
- **Tests:** logic/branching gets tests (redirect, list rendering); pure layout wrappers do not.
- **Commit per task**, no co-author trailer.

## File Structure

- `apps/www/app/components/ui/card.tsx` — **create** (shadcn `add card`).
- `apps/www/app/components/custom/class-card.tsx` — **modify**: shadcn `Card` + "No labs yet" slot.
- `apps/www/app/pages/classes-page.tsx` — **create**: the `/classes` page (header + Connect + list).
- `apps/www/app/routes/classes.tsx` — **create**: route wrapper for `ClassesPage`.
- `apps/www/app/routes.ts` — **modify**: register `classes` route.
- `apps/www/app/routes/home.tsx` — **modify**: signed-in → redirect to `/classes`.
- `apps/www/app/pages/home-page.tsx` — **delete**: the Welcome is gone.
- `apps/www/app/components/custom/app-header.tsx` — **modify**: wordmark → `Link` to `/classes`.
- `apps/www/test/classes-page.test.tsx` — **create**.
- `apps/www/test/home.test.tsx` — **modify**: redirect + login branches.

---

### Task 1: `/classes` page + `ClassCard` as a shadcn Card

**Files:**
- Create: `apps/www/app/components/ui/card.tsx` (via CLI), `apps/www/app/pages/classes-page.tsx`, `apps/www/app/routes/classes.tsx`, `apps/www/test/classes-page.test.tsx`
- Modify: `apps/www/app/components/custom/class-card.tsx`, `apps/www/app/routes.ts`

**Interfaces produced:** `ClassesPage` (default-exportable page); `ClassCard({ login, name, avatarUrl })`; route `/classes` → `ClassesPage`.

**Consumes:** `useApi(api.api.classes)` → `{ classes: Array<{ id, orgId, login, name, avatarUrl }> }` (F3); `githubAppInstallUrl` (`~/lib/config`); `useAuth()`.

- [ ] **Step 1: Add the shadcn Card** — present then run: `pnpm dlx shadcn@latest add card --cwd apps/www`. Then normalize to house style: `pnpm exec biome check --write apps/www/app/components/ui/card.tsx`.

- [ ] **Step 2: Upgrade `ClassCard`** — replace `apps/www/app/components/custom/class-card.tsx` with:

```tsx
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { UserAvatar } from "~/components/custom/user-avatar";
import { Card } from "~/components/ui/card";

type ClassCardProps = {
  login: string;
  name: string | null;
  avatarUrl: string;
};

/** One connected class (GitHub org). The labs list fills the slot in F6. */
export function ClassCard({ login, name, avatarUrl }: ClassCardProps) {
  return (
    <Card className="w-full gap-3 p-4">
      <Row gap="sm">
        <UserAvatar name={name ?? login} src={avatarUrl} size="lg" />
        <Stack gap="none">
          <Text variant="body1">{name ?? login}</Text>
          <Text variant="body2">@{login}</Text>
        </Stack>
      </Row>
      <Text variant="body2">No labs yet — add the first one.</Text>
    </Card>
  );
}
```

> The `/classes` list items include `id`/`orgId`; `ClassCard` only needs `login`/`name`/`avatarUrl`. A JSX spread `{...cls}` still type-checks (spread relaxes excess-prop checks) — keep the caller spreading the whole item.

- [ ] **Step 3: Failing test** — `apps/www/test/classes-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { ClassesPage } from "~/pages/classes-page";

vi.mock("~/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api")>();
  return { ...actual, useApi: vi.fn() };
});

describe("ClassesPage", () => {
  it("shows the connect action and lists classes", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        classes: [
          { id: "c1", orgId: 1, login: "acme", name: "Acme", avatarUrl: "" },
        ],
      },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(
      screen.getByText("Connect an organization"),
    ).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("shows an empty state with no classes", () => {
    vi.mocked(useApi).mockReturnValue({
      data: { classes: [] },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(
      screen.getByText(/Connect a GitHub organization to start a class/),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run → fails** — `pnpm --filter @labs/www test` → cannot find `~/pages/classes-page`.

- [ ] **Step 5: Implement `ClassesPage`** — `apps/www/app/pages/classes-page.tsx`:

```tsx
import { ClassCard } from "~/components/custom/class-card";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { api, useApi } from "~/lib/api";
import { githubAppInstallUrl } from "~/lib/config";

/** The teacher hub: connect orgs + the live list of connected classes. */
export function ClassesPage() {
  const { data } = useApi(api.api.classes);
  const classes = data?.classes ?? [];

  return (
    <Stack gap="lg" align="start" className="flex-1 pt-2">
      <Stack gap="sm" align="start">
        <Text variant="title">Classes</Text>
        <div className="h-1 w-16 bg-brand" />
      </Stack>
      <Button
        size="lg"
        onClick={() => {
          window.location.href = githubAppInstallUrl;
        }}
      >
        Connect an organization
      </Button>
      <Stack gap="md" className="w-full">
        {classes.length === 0 ? (
          <Text variant="body2">
            Connect a GitHub organization to start a class.
          </Text>
        ) : (
          classes.map((cls) => <ClassCard key={cls.id} {...cls} />)
        )}
      </Stack>
    </Stack>
  );
}
```

- [ ] **Step 6: Route wrapper** — `apps/www/app/routes/classes.tsx`:

```tsx
import { ClassesPage } from "~/pages/classes-page";

/** /classes — the teacher hub (access gated by the OnboardingGate in root). */
export default function Classes() {
  return <ClassesPage />;
}
```

- [ ] **Step 7: Register the route** — in `apps/www/app/routes.ts`, add a `route("classes", "routes/classes.tsx")` entry next to the existing ones (import `route` from `@react-router/dev/routes` if not already imported). Keep the existing `index("routes/home.tsx")` and `classes/:id/confirm` entries.

- [ ] **Step 8: Run → passes** — `pnpm --filter @labs/www test`.

- [ ] **Step 9: Automated gate** — `pnpm run biome && pnpm --filter @labs/www typecheck && pnpm --filter @labs/www test && pnpm --filter @labs/www build` green.

- [ ] **Step 10: Commit** — `git add apps/www && git commit -m "feat(www): /classes hub page + ClassCard as a Card"`

**Human gate:** 👁 (reviewed together in Task 2 after the redirect wires it up).

---

### Task 2: `/` → `/classes` redirect, remove Welcome, wordmark link

**Files:**
- Modify: `apps/www/app/routes/home.tsx`, `apps/www/app/components/custom/app-header.tsx`, `apps/www/test/home.test.tsx`
- Delete: `apps/www/app/pages/home-page.tsx`

**Interfaces produced:** `/` renders the login screen when signed out and redirects to `/classes` when signed in; the `labs` wordmark links to `/classes`.

**Consumes:** `useAuth()` (`authed`, `isLoading`); `Navigate`/`Link` from `react-router`.

- [ ] **Step 1: Update the failing test** — replace `apps/www/test/home.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "~/lib/auth-context";
import Home from "~/routes/home";

vi.mock("~/lib/auth-context", () => ({ useAuth: vi.fn() }));
const navigateSpy = vi.fn();
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    Navigate: (props: { to: string }) => {
      navigateSpy(props.to);
      return null;
    },
  };
});

function authValue(o: Partial<ReturnType<typeof useAuth>>) {
  return {
    isLoading: false,
    authed: false,
    account: null,
    github: null,
    githubLinked: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    linkGithub: vi.fn(),
    unlinkGithub: vi.fn(),
    ...o,
  } as unknown as ReturnType<typeof useAuth>;
}

describe("Home (index)", () => {
  it("redirects to /classes when signed in", () => {
    vi.mocked(useAuth).mockReturnValue(authValue({ authed: true }));
    render(<Home />);
    expect(navigateSpy).toHaveBeenCalledWith("/classes");
  });

  it("shows the sign-in button when signed out", () => {
    vi.mocked(useAuth).mockReturnValue(authValue({ authed: false }));
    render(<Home />);
    expect(screen.getByText("Sign in with SWITCH edu-ID")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fails** — `pnpm --filter @labs/www test` (Home still renders the old HomePage).

- [ ] **Step 3: Implement the redirect** — replace `apps/www/app/routes/home.tsx`:

```tsx
import { Navigate } from "react-router";
import { LoginPage } from "~/pages/login-page";
import { useAuth } from "~/lib/auth-context";

/** Index route: login when signed out, else send to the classes hub. */
export default function Home() {
  const { isLoading, authed } = useAuth();

  if (isLoading) {
    return null;
  }
  return authed ? <Navigate to="/classes" replace /> : <LoginPage />;
}
```

- [ ] **Step 4: Delete the Welcome page** — `git rm apps/www/app/pages/home-page.tsx` (the Welcome is gone; its class-list logic now lives in `ClassesPage`). Verify nothing else imports it: `grep -r "home-page" apps/www/app` returns nothing.

- [ ] **Step 5: Wordmark link** — in `apps/www/app/components/custom/app-header.tsx`, import `Link` from `react-router` and replace the wordmark span:

```tsx
<Link to="/classes" className="font-bold tracking-tight">
  labs
</Link>
```

- [ ] **Step 6: Run → passes** — `pnpm --filter @labs/www test` (both home tests + the classes-page tests).

- [ ] **Step 7: Automated gate** — `pnpm run biome && pnpm --filter @labs/www typecheck && pnpm --filter @labs/www test && pnpm --filter @labs/www build` green.

- [ ] **Step 8: 👁 Visual gate** — rebuild + run the same-origin Worker (or `pnpm --filter @labs/www dev`) and review together: signing in lands on **`/classes`** (top-aligned "Classes" + red rule, "Connect an organization", the **Test TWeb 2026** card with "No labs yet"); the `labs` wordmark returns to `/classes`; no "Welcome" anywhere. Note: the Worker locks `build/client` — stop it before `build`.

- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat(www): / redirects to /classes; drop Welcome; wordmark links to hub"`

**Human gate:** 👁 + 🟢.

---

## Self-review (coverage)

`/classes` hub + no Welcome + top-aligned → Tasks 1+2. `/` redirect + wordmark link → Task 2. Class card as a shadcn Card with "No labs yet" slot → Task 1. Uses only today's `GET /api/classes` (F3) — no new backend. Deferred per spec: labs rows/Add-lab (F6), Copy-join-link/Settings (F4), People counts (F5), the `/classes/:id` detail page + New-lab Dialog + Progress (F6/F8) — none built here. Onboarding gate unchanged (still wraps all routes via root).
