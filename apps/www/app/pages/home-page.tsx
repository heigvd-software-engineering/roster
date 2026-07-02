import { BrandHeader } from "~/components/custom/brand-header";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { useAuth } from "~/lib/auth-context";

/** The signed-in home. Identity/sign-out live in the top-right AppHeader menu. */
export function HomePage() {
  const { account } = useAuth();

  if (!account) {
    return null;
  }

  const firstName = account.name.split(/\s+/)[0];

  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title={`Welcome, ${firstName}`} />
      <Text variant="subtitle" className="max-w-md">
        Your classes and labs will appear here.
      </Text>
    </Stack>
  );
}
