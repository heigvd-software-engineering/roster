import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAuth } from "~/lib/auth-context";
import Home from "~/routes/home";

vi.mock("~/lib/auth-context", () => ({ useAuth: vi.fn() }));

/** Minimal useAuth value; override per test. */
function authValue(overrides: Partial<ReturnType<typeof useAuth>>) {
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
    ...overrides,
  } as unknown as ReturnType<typeof useAuth>;
}

describe("Home", () => {
  it("welcomes the signed-in user by first name", () => {
    vi.mocked(useAuth).mockReturnValue(
      authValue({
        authed: true,
        account: {
          name: "Alice Example",
          email: "alice@example.ch",
          affiliations: [],
        },
      }),
    );

    render(<Home />);

    expect(screen.getByText("Welcome, Alice")).toBeInTheDocument();
  });

  it("shows the sign-in button when signed out", () => {
    vi.mocked(useAuth).mockReturnValue(authValue({ authed: false }));

    render(<Home />);

    expect(screen.getByText("Sign in with SWITCH edu-ID")).toBeInTheDocument();
  });
});
