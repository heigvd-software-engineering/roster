import { BrandHeader } from "~/components/custom/brand-header";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/lib/auth-context";

/** Onboarding gate: link GitHub before using the app. */
export function OnboardingGitHubPage() {
  const { linkGithub } = useAuth();
  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title="Connect GitHub" />
      <Text variant="subtitle" className="max-w-md">
        labs runs your classes and labs on your own GitHub account. Link it to
        continue.
      </Text>
      <Button size="lg" onClick={() => linkGithub()}>
        Connect GitHub
      </Button>
    </Stack>
  );
}
