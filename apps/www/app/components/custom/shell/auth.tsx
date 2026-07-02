import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { Loading } from "~/components/custom/loading";
import { useAuth } from "~/lib/auth-context";
import { LoginPage } from "~/pages/login-page";

type AuthProps = {
  /** Set false for routes that need a session but not a linked GitHub. */
  requireGithubLinked?: boolean;
  children: ReactNode;
};

/**
 * Route guard: renders children only for a signed-in user. Signed-out visitors
 * get the login screen IN PLACE — the URL is preserved, so after sign-in they
 * land exactly where they were headed (deep links survive). A signed-in user
 * without a working GitHub link is sent to onboarding — the one real redirect.
 */
export function Auth({ requireGithubLinked = true, children }: AuthProps) {
  const { isLoading, authed, githubLinked } = useAuth();

  if (isLoading) {
    return <Loading loading className="flex-1" />;
  }
  if (!authed) {
    return <LoginPage />;
  }
  if (requireGithubLinked && !githubLinked) {
    return <Navigate to="/onboarding/github" replace />;
  }
  return <>{children}</>;
}
