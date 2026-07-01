import { BrandHeader } from "~/components/custom/brand-header";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { api, useApi } from "~/lib/api";
import { signOut } from "~/lib/auth";

/** The signed-in home screen. Gathers its own data — the DB user via /api/me. */
export function HomePage() {
  const { data } = useApi(api.api.me);
  const me = data?.user;

  if (!me) {
    return null;
  }

  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title={me.name} />
      <Text variant="body2">Signed in as {me.email}</Text>
      <Button variant="outline" onClick={() => signOut()}>
        Sign out
      </Button>
    </Stack>
  );
}
