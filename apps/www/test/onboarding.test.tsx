import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingGitHubPage } from "~/pages/onboarding-github-page";

const linkGithub = vi.fn();
vi.mock("~/lib/auth-context", () => ({
  useAuth: () => ({ linkGithub }),
}));

const params = vi.hoisted(() => ({ returnTo: null as string | null }));
vi.mock("react-router", () => ({
  useSearchParams: () => [
    { get: (k: string) => (k === "returnTo" ? params.returnTo : null) },
  ],
}));

describe("OnboardingGitHubPage returnTo", () => {
  it("links back to the preserved path", () => {
    linkGithub.mockClear();
    params.returnTo = "/join/tok123";
    render(<OnboardingGitHubPage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    expect(linkGithub).toHaveBeenCalledWith("/join/tok123");
  });

  it("falls back to / when returnTo is absent", () => {
    linkGithub.mockClear();
    params.returnTo = null;
    render(<OnboardingGitHubPage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    expect(linkGithub).toHaveBeenCalledWith("/");
  });

  it("rejects non-path returnTo values (open-redirect guard)", () => {
    linkGithub.mockClear();
    params.returnTo = "//evil.example";
    render(<OnboardingGitHubPage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    expect(linkGithub).toHaveBeenCalledWith("/");
  });
});
