import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "~/lib/auth-context";

const ONBOARDING = "/onboarding/github";

/**
 * App-wide gate: a signed-in user must have a WORKING GitHub link before
 * reaching any other screen. `githubLinked` is liveness (a dead/unusable link
 * reports false), so a broken link bounces the user back to onboarding to
 * re-link — the app self-heals. Redirect logic lives here so routes stay dumb.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { isLoading, authed, githubLinked: linked } = useAuth();
  const { pathname } = useLocation();

  if (isLoading) {
    return null;
  }

  const onOnboarding = pathname === ONBOARDING;

  // Onboarding requires a session.
  if (!authed && onOnboarding) {
    return <Navigate to="/" replace />;
  }
  // Signed in but GitHub not linked → must onboard.
  if (authed && !linked && !onOnboarding) {
    return <Navigate to={ONBOARDING} replace />;
  }
  // Already linked → don't sit on the onboarding screen.
  if (authed && linked && onOnboarding) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
