import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useApi } from "~/lib/api";
import { useAuth } from "~/lib/auth-context";
import Home from "~/routes/home";

vi.mock("~/lib/auth-context", () => ({ useAuth: vi.fn() }));
vi.mock("~/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api")>();
  return { ...actual, useApi: vi.fn() };
});

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
  it("welcomes the signed-in user by first name and shows connected classes", () => {
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
    vi.mocked(useApi).mockReturnValue({
      data: {
        classes: [
          { id: "c1", orgId: 1, login: "acme", name: "Acme", avatarUrl: "" },
        ],
      },
    } as unknown as ReturnType<typeof useApi>);

    render(<Home />);

    expect(screen.getByText("Welcome, Alice")).toBeInTheDocument();
    expect(
      screen.getByText("Connect a GitHub organization"),
    ).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("shows the sign-in button when signed out", () => {
    vi.mocked(useAuth).mockReturnValue(authValue({ authed: false }));
    vi.mocked(useApi).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useApi>);

    render(<Home />);

    expect(screen.getByText("Sign in with SWITCH edu-ID")).toBeInTheDocument();
  });
});
