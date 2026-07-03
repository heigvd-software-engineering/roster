import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { ClassesPage } from "~/pages/classes-page";

vi.mock("~/contexts/auth-context", () => ({
  useAuth: () => ({
    githubAppInstallUrl: "https://github.com/apps/heigvdlabs/installations/new",
  }),
}));

vi.mock("~/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api")>();
  return { ...actual, useApi: vi.fn() };
});

describe("ClassesPage", () => {
  it("shows the connect action and lists classes", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        classes: [
          {
            id: "c1",
            orgId: 1,
            login: "acme",
            name: "Acme",
            avatarUrl: "",
            joinToken: "tok123",
            teachers: [],
            students: [],
            pending: [],
            users: [],
            labs: [],
          },
        ],
      },
    } as unknown as ReturnType<typeof useApi>);

    render(<ClassesPage />);

    expect(screen.getByText("Create a new class")).toBeInTheDocument();
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
