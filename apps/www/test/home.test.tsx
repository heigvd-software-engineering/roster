import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useApi } from "~/lib/api";
import { useSession } from "~/lib/auth";
import Home from "~/routes/home";

vi.mock("~/lib/auth", () => ({
  useSession: vi.fn(),
  signIn: { oauth2: vi.fn() },
  signOut: vi.fn(),
}));
vi.mock("~/lib/api", () => ({
  api: { api: { me: {} } },
  useApi: vi.fn(),
}));

describe("Home", () => {
  it("shows the DB user's name and email when signed in", () => {
    // The route only checks the session to gate; the page gathers its own data.
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: "u1" } },
      isPending: false,
    } as ReturnType<typeof useSession>);
    vi.mocked(useApi).mockReturnValue({
      data: { user: { name: "Alice", email: "alice@example.ch" } },
    } as unknown as ReturnType<typeof useApi>);

    render(<Home />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/alice@example\.ch/)).toBeInTheDocument();
  });

  it("shows the sign-in button when signed out", () => {
    vi.mocked(useSession).mockReturnValue({
      data: null,
      isPending: false,
    } as ReturnType<typeof useSession>);

    render(<Home />);

    expect(screen.getByText("Sign in with SWITCH edu-ID")).toBeInTheDocument();
  });
});
