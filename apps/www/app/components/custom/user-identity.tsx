import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { UserAvatar } from "~/components/custom/user-avatar";

type UserIdentityProps = {
  name: string;
  /** Second line under the name — e.g. an email or a `@handle`. */
  subtitle: string;
  avatarUrl?: string | null;
};

/** Avatar + name over a subtitle — the standard way to show an identity. */
export function UserIdentity({ name, subtitle, avatarUrl }: UserIdentityProps) {
  return (
    <Row gap="sm" align="center">
      <UserAvatar name={name} src={avatarUrl} size="lg" />
      <Stack gap="none">
        <Text variant="body1" className="text-sm">
          {name}
        </Text>
        <Text variant="body2" className="text-xs">
          {subtitle}
        </Text>
      </Stack>
    </Row>
  );
}
