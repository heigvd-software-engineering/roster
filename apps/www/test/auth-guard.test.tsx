import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Auth } from "~/components/custom/shell/auth";
import { useAuth } from "~/lib/auth-context";

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

describe("Auth guard", () => {
  it("renders the login in place when signed out (URL preserved)", () => {
    navigateSpy.mockClear();
    vi.mocked(useAuth).mockReturnValue(authValue({ authed: false }));

    render(<Auth>secret</Auth>);

    expect(screen.getByText("Sign in with SWITCH edu-ID")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("sends an authed-but-unlinked user to onboarding", () => {
    navigateSpy.mockClear();
    vi.mocked(useAuth).mockReturnValue(
      authValue({ authed: true, githubLinked: false }),
    );

    render(<Auth>secret</Auth>);

    expect(navigateSpy).toHaveBeenCalledWith("/onboarding/github");
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("renders children for a signed-in, linked user", () => {
    navigateSpy.mockClear();
    vi.mocked(useAuth).mockReturnValue(
      authValue({ authed: true, githubLinked: true }),
    );

    render(<Auth>secret</Auth>);

    expect(screen.getByText("secret")).toBeInTheDocument();
  });

  it("skips the link requirement when requireGithubLinked is false", () => {
    navigateSpy.mockClear();
    vi.mocked(useAuth).mockReturnValue(
      authValue({ authed: true, githubLinked: false }),
    );

    render(<Auth requireGithubLinked={false}>onboarding</Auth>);

    expect(screen.getByText("onboarding")).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
