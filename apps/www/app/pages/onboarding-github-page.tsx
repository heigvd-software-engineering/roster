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
  const failed = params.get("error") !== null;
  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title="Connect GitHub" />
      <Text variant="subtitle" className="max-w-md">
        labs runs your classes and labs on your own GitHub account. Link it to
        continue.
      </Text>
      {failed ? (
        <Text variant="error" className="max-w-md">
          GitHub didn't share your profile. If the account is brand new, verify
          its email address on GitHub first — then try again.
        </Text>
      ) : null}
      <Button
        size="lg"
        title="Link your GitHub account to labs"
        onClick={() => linkGithub(returnTo)}
      >
        {failed ? "Try connecting again" : "Connect GitHub"}
      </Button>
    </Stack>
  );
}
