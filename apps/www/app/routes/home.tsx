import { useAuth } from "~/lib/auth-context";
import { HomePage } from "~/pages/home-page";
import { LoginPage } from "~/pages/login-page";

/**
 * Index route. Picks which page to render based on the shared auth state.
 * (The OnboardingGate handles the authed-but-unlinked → onboarding redirect.)
 */
export default function Home() {
  const { isLoading, authed } = useAuth();

  if (isLoading) {
    return null;
  }

  return authed ? <HomePage /> : <LoginPage />;
}
