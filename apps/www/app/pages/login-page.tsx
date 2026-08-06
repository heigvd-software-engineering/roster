import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";

/** The signed-out landing screen: the name of the app + edu-ID sign-in. */
export function LoginPage() {
  const { signIn } = useAuth();
  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <Text variant="title">roster</Text>
      <Text variant="subtitle" className="max-w-md">
        Course assignments, on your own GitHub. HEIG-VD Software Engineering.
      </Text>
      <Button
        size="lg"
        title="Sign in with your SWITCH edu-ID account"
        onClick={() => signIn()}
      >
        Sign in with SWITCH edu-ID
      </Button>
    </Stack>
  );
}
