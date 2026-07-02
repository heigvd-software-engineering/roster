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

    expect(screen.getByText("Connect an organization")).toBeInTheDocument();
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
