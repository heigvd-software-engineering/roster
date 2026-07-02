import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { UserAvatar } from "~/components/custom/user-avatar";

type ClassCardProps = {
  login: string;
  name: string | null;
  avatarUrl?: string | null;
};

/** A connected class = its org avatar + name over the `@login` handle. */
export function ClassCard({ login, name, avatarUrl }: ClassCardProps) {
  const displayName = name ?? login;
  return (
    <Row gap="sm" align="center">
      <UserAvatar name={displayName} src={avatarUrl} size="lg" />
      <Stack gap="none">
        <Text variant="body1" className="text-sm">
          {displayName}
        </Text>
        <Text variant="body2" className="text-xs">
          @{login}
        </Text>
      </Stack>
    </Row>
  );
}
