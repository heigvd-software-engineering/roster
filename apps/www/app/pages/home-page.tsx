import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { UserIdentity } from "~/components/custom/user-identity";
import { Button } from "~/components/ui/button";
import { api, useApi } from "~/lib/api";
import { signOut } from "~/lib/auth";

/** The signed-in home screen. Gathers its own data — the DB user via /api/me. */
export function HomePage() {
  const { data } = useApi(api.api.me);
  const me = data?.user;
  const github = data?.github;

  if (!me) {
    return null;
  }

  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <Text variant="overline">HEIG-VD — Software Engineering</Text>

      <Stack gap="sm" align="start">
        <Text variant="overline">Account</Text>
        <UserIdentity name={me.name} subtitle={me.email} />
      </Stack>

      {github && (
        <Stack gap="sm" align="start">
          <Text variant="overline">Linked GitHub</Text>
          <UserIdentity
            name={github.name ?? github.login}
            subtitle={`@${github.login}`}
            avatarUrl={github.avatarUrl}
          />
        </Stack>
      )}

      <Button variant="outline" onClick={() => signOut()}>
        Sign out
      </Button>
    </Stack>
  );
}
