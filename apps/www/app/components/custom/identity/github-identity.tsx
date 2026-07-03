import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Text } from "~/components/custom/typography/text";
import { useAuth } from "~/contexts/auth-context";

/**
 * The linked GitHub identity — wraps UserIdentity with the GitHub profile from
 * the auth context (avatar + name + @handle). Falls back to "Not linked".
 */
export function GithubIdentity() {
  const { github } = useAuth();

  if (!github) {
    return <Text variant="body2">Not linked</Text>;
  }

  return (
    <UserIdentity
      name={github.name ?? github.login}
      subtitle={`@${github.login}`}
      avatarUrl={github.avatarUrl}
    />
  );
}
