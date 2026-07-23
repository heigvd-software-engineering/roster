import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { ClassesPage } from "~/pages/classes-page";

vi.mock("~/contexts/auth-context", () => ({
  useAuth: () => ({
    githubAppInstallUrl: "https://github.com/apps/heigvdlabs/installations/new",
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
            labs: [],
          },
        ],
      },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(screen.getByText("New class")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    // March 2026 → the Spring 2026 semester group heading.
    expect(
      screen.getByText("Spring 2026 · 1 Feb → 30 Jun · 1 class · 0 labs"),
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
            labs: [
              {
                id: "l1",
                classId: "c2",
                title: "Lab 1 — Sockets",
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
      screen.getByText("Spring 2026 · 1 Feb → 30 Jun · 1 class · 1 lab"),
    ).toBeInTheDocument();
    expect(screen.getByText("Lab 1 — Sockets")).toBeInTheDocument();
    // Read-only: no teacher actions. Lab rows DO link — students accept
    // their labs on the lab page.
    expect(
      screen.queryByRole("button", { name: "Copy join link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ New lab" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Lab 1 — Sockets/ }),
    ).toHaveAttribute("href", "/classes/c2/labs/l1");
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
            labs: [],
          },
        ],
      },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(screen.getByText("invitation pending")).toBeInTheDocument();
    expect(screen.getByText("No labs yet.")).toBeInTheDocument();
  });

  it("shows the empty state when nothing exists in any semester", () => {
    // The ghost connect card is gone (user-decided 2026-07-07) — an empty
    // hub explains itself in text; connecting lives in the header dialog.
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
            labs: [],
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
