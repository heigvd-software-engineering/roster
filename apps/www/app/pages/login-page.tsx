import { BrandHeader } from "~/components/custom/brand-header";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { signIn } from "~/lib/auth";

/** The signed-out landing screen: brand identity + edu-ID sign-in. */
export function LoginPage() {
  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title="labs" size="hero" />
      <Text variant="subtitle" className="max-w-md">
        Course labs, on your own GitHub.
      </Text>
      <Button
        size="lg"
        onClick={() =>
          signIn.oauth2({ providerId: "switch", callbackURL: "/" })
        }
      >
        Sign in with SWITCH edu-ID
      </Button>
    </Stack>
  );
}
