import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { ClassesPage } from "~/pages/classes-page";

// "New class" is a granted capability. Most tests run with it (the
// pre-gating behavior); the gating tests below flip it off.
const authState = vi.hoisted(() => ({ canCreateClasses: true }));

vi.mock("~/contexts/auth-context", () => ({
  useAuth: () => ({
    githubAppInstallUrl:
      "https://github.com/apps/heigvdroster/installations/new",
    canCreateClasses: authState.canCreateClasses,
  }),
}));

vi.mock("~/contexts/message-context", () => ({
  useMessages: () => ({ push: vi.fn() }),
}));

vi.mock("~/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api")>();
  return { ...actual, useApi: vi.fn() };
});

// Cards link into the class detail page, so a router must be present.
const render = (ui: ReactElement) =>
  rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

describe("ClassesPage", () => {
  beforeEach(() => {
    authState.canCreateClasses = true;
  });

  it("hides the connect action without the class-creator grant", () => {
    authState.canCreateClasses = false;
    vi.mocked(useApi).mockReturnValue({
      data: { classes: [], enrolled: [], hasOlder: false },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    // No button, and the empty-hub copy must not point at one either.
    expect(screen.queryByText("New class")).not.toBeInTheDocument();
    expect(screen.queryByText(/Use "New class" above/)).not.toBeInTheDocument();
    expect(screen.getByText(/open the class link/)).toBeInTheDocument();
  });

  it("shows the connect action and lists classes under their semester", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        classes: [
          {
            id: "c1",
            orgId: 1,
            createdAt: "2026-03-10T00:00:00.000Z",
            login: "acme",
            name: "Acme",
            avatarUrl: "",
            joinToken: "tok123",
            teachers: [],
            students: [],
            pending: [],
            pendingTeachers: [],
            users: [],
            assignments: [],
          },
        ],
      },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(screen.getByText("New class")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    // March 2026 → the Spring 2026 semester group heading, which carries its
    // span and counts beside it as muted metadata.
    expect(
      screen.getByRole("heading", { name: /Spring 2026/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 Feb → 30 Jun · 1 class · 0 assignments"),
    ).toBeInTheDocument();
  });

  it("renders enrolled classes read-only under their semester", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        classes: [],
        enrolled: [
          {
            id: "c2",
            createdAt: "2026-03-10T00:00:00.000Z",
            login: "beta",
            name: "Beta",
            avatarUrl: "",
            state: "active",
            teachers: [
              {
                classId: "c2",
                githubId: "111",
                login: "prof",
                avatarUrl: null,
                user: null,
              },
            ],
            assignments: [
              {
                id: "l1",
                classId: "c2",
                title: "Assignment 1 — Sockets",
                deadline: "2099-08-01T23:59:00.000Z",
                groupMode: "individual",
                minMembers: null,
                maxMembers: null,
                createdByUserId: "u9",
                createdAt: "2026-03-10T00:00:00.000Z",
                updatedAt: "2026-03-10T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("enrolled")).toBeInTheDocument();
    // The class's teachers ride the cache into the people popover chip.
    expect(screen.getByText("1 teacher")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Spring 2026/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 Feb → 30 Jun · 1 class · 1 assignment"),
    ).toBeInTheDocument();
    expect(screen.getByText("Assignment 1 — Sockets")).toBeInTheDocument();
    // Read-only: no teacher actions. Assignment rows still link, because
    // students accept their assignments on the assignment page.
    expect(
      screen.queryByRole("button", { name: "Copy join link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ New assignment" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Assignment 1 — Sockets/ }),
    ).toHaveAttribute("href", "/classes/c2/assignments/l1");
  });

  it("marks a pending invitation distinctly", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        classes: [],
        enrolled: [
          {
            id: "c3",
            createdAt: "2026-03-10T00:00:00.000Z",
            login: "gamma",
            name: null,
            avatarUrl: null,
            state: "pending",
            teachers: [],
            assignments: [],
          },
        ],
      },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(screen.getByText("invitation pending")).toBeInTheDocument();
    expect(screen.getByText("No assignments yet.")).toBeInTheDocument();
  });

  it("shows the empty state when nothing exists in any semester", () => {
    // The ghost connect card is gone (user-decided 2026-07-07): an empty
    // hub explains itself in text, and connecting lives in the header dialog.
    vi.mocked(useApi).mockReturnValue({
      data: { classes: [], enrolled: [], hasOlder: false },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(screen.getByText(/No classes yet/)).toBeInTheDocument();
  });

  it("offers Load more when older semesters exist", () => {
    vi.mocked(useApi).mockReturnValue({
      data: { classes: [], enrolled: [], hasOlder: true },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(screen.getByRole("button", { name: /Load/ })).toBeEnabled();
    expect(screen.queryByText(/No classes yet/)).not.toBeInTheDocument();
  });

  it("keeps Load more visible but disabled when nothing older exists", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        classes: [],
        enrolled: [
          {
            id: "c1",
            createdAt: "2026-07-02T00:00:00.000Z",
            login: "acme",
            name: "Acme",
            avatarUrl: null,
            state: "active",
            teachers: [],
            assignments: [],
          },
        ],
        hasOlder: false,
      },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(screen.getByRole("button", { name: /Load/ })).toBeDisabled();
  });

  it("shows a loading state while classes are being fetched", () => {
    vi.mocked(useApi).mockReturnValue({
      isLoading: true,
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(screen.getByText("Loading classes…")).toBeInTheDocument();
  });

  it("shows an error state when the classes fetch fails", () => {
    vi.mocked(useApi).mockReturnValue({
      error: new Error("x"),
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(
      screen.getByText(/Couldn't load your classes — refresh to retry/),
    ).toBeInTheDocument();
  });
});
