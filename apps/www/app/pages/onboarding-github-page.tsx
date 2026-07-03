import { useSearchParams } from "react-router";
import { Stack } from "~/components/custom/layout/stack";
import { BrandHeader } from "~/components/custom/typography/brand-header";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";

/** Onboarding gate: link GitHub before using the app. */
export function OnboardingGitHubPage() {
  const { linkGithub } = useAuth();
  const [params] = useSearchParams();
  const raw = params.get("returnTo") ?? "/";
  // Same-app absolute paths only — "//host" is scheme-relative, and browsers
  // normalize "\" to "/" (so "/\host" becomes one too): both open redirects.
  const returnTo =
    raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")
      ? raw
      : "/";
  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title="Connect GitHub" />
      <Text variant="subtitle" className="max-w-md">
        labs runs your classes and labs on your own GitHub account. Link it to
        continue.
      </Text>
      <Button size="lg" onClick={() => linkGithub(returnTo)}>
        Connect GitHub
      </Button>
    </Stack>
  );
}
