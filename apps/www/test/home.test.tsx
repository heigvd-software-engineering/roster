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
    useLocation: () => ({ pathname: "/", search: "" }),
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
  it("redirects to /classes when signed in and linked", () => {
    vi.mocked(useAuth).mockReturnValue(
      authValue({ authed: true, githubLinked: true }),
    );
    render(<Home />);
    expect(navigateSpy).toHaveBeenCalledWith("/classes");
  });

  it("shows the sign-in button when signed out", () => {
    vi.mocked(useAuth).mockReturnValue(authValue({ authed: false }));
    render(<Home />);
    expect(screen.getByText("Sign in with SWITCH edu-ID")).toBeInTheDocument();
  });
});
