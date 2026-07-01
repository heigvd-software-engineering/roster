import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useSession } from "~/lib/auth";

const ONBOARDING = "/onboarding/github";

/**
 * App-wide gate: a signed-in user must link GitHub before reaching any other
 * screen. Keeps the redirect logic in one place so routes stay dumb.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { data, isPending } = useSession();
  const { pathname } = useLocation();

  if (isPending) {
    return null;
  }

  const authed = Boolean(data?.user);
  const linked = Boolean(data?.githubLinked);
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
