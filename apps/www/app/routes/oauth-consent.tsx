import { Auth } from "~/components/custom/shell/auth";
import { pageTitle } from "~/lib/title";
import { OAuthConsentPage } from "~/pages/oauth-consent-page";
import type { Route } from "./+types/oauth-consent";

export const meta: Route.MetaFunction = () => [
  { title: pageTitle("Connect an assistant") },
];

export default function OAuthConsent() {
  return (
    // A session is required — the grant is the teacher's to give — but a linked
    // GitHub is not: bouncing to onboarding here would drop the pending
    // authorization, and connecting an assistant does not touch GitHub.
    <Auth requireGithubLinked={false}>
      <OAuthConsentPage />
    </Auth>
  );
}
