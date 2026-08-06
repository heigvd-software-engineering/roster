import { Navigate } from "react-router";
import { Auth } from "~/components/custom/shell/auth";
import { useAuth } from "~/contexts/auth-context";
import { pageTitle } from "~/lib/title";
import { OnboardingGitHubPage } from "~/pages/onboarding-github-page";
import type { Route } from "./+types/onboarding";

export const meta: Route.MetaFunction = () => [
  { title: pageTitle("Connect GitHub") },
];

/** /onboarding/github: needs a session, not a linked GitHub. */
export default function Onboarding() {
  return (
    <Auth requireGithubLinked={false}>
      <OnboardingContent />
    </Auth>
  );
}

/** Already-linked users have nothing to do here; send them home. */
function OnboardingContent() {
  const { githubLinked } = useAuth();
  return githubLinked ? <Navigate to="/" replace /> : <OnboardingGitHubPage />;
}
