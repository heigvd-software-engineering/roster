import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { UserAvatar } from "~/components/custom/user-avatar";
import { Card } from "~/components/ui/card";

type ClassCardProps = {
  login: string;
  name: string | null;
  avatarUrl: string;
};

/** One connected class (GitHub org). The labs list fills the slot in F6. */
export function ClassCard({ login, name, avatarUrl }: ClassCardProps) {
  return (
    <Card className="w-full gap-3 p-4">
      <Row gap="sm">
        <UserAvatar name={name ?? login} src={avatarUrl} size="lg" />
        <Stack gap="none">
          <Text variant="body1">{name ?? login}</Text>
          <Text variant="body2">@{login}</Text>
        </Stack>
      </Row>
      <Text variant="body2">No labs yet — add the first one.</Text>
    </Card>
  );
}
