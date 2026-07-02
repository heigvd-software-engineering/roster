import { Stack } from "~/components/custom/layout/stack";
import { BrandHeader } from "~/components/custom/typography/brand-header";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/lib/auth-context";

/** The signed-out landing screen: brand identity + edu-ID sign-in. */
export function LoginPage() {
  const { signIn } = useAuth();
  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title="labs" size="hero" />
      <Text variant="subtitle" className="max-w-md">
        Course labs, on your own GitHub.
      </Text>
      <Button size="lg" onClick={() => signIn()}>
        Sign in with SWITCH edu-ID
      </Button>
    </Stack>
  );
}
