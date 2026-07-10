import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { Loading } from "~/components/custom/loading";
import { useAuth } from "~/contexts/auth-context";
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
 * whose GitHub link is PROVEN dead ("unlinked") is sent to onboarding — the
 * one real redirect. "unknown" (GitHub unreachable) fails OPEN: re-linking
 * during an outage would fail too, and the outage is not the user's fault —
 * the AuthProvider's warning strip says what's going on instead.
 */
export function Auth({ requireGithubLinked = true, children }: AuthProps) {
  const { isLoading, authed, githubState } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <Loading loading className="flex-1" />;
  }
  if (!authed) {
    return <LoginPage />;
  }
  if (requireGithubLinked && githubState === "unlinked") {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/onboarding/github?returnTo=${returnTo}`} replace />;
  }
  return <>{children}</>;
}
