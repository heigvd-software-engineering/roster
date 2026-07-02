import { LabRow } from "~/components/custom/classes/lab-row";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { dummyClassMeta } from "~/lib/dummy";

type ClassCardProps = {
  login: string;
  name: string | null;
  avatarUrl: string;
};

/**
 * One connected class (GitHub org): identity + state + its labs. The card is a
 * solid, slightly-darker-than-white surface so the white inset labs list reads
 * as its own level. Counts / labs / actions are dummy for now (F5/F6/F8).
 */
export function ClassCard({ login, name, avatarUrl }: ClassCardProps) {
  const meta = dummyClassMeta(login);

  return (
    <Card className="w-full gap-4 bg-muted p-5">
      <Row justify="between" wrap>
        <Row gap="sm">
          <UserAvatar name={name ?? login} src={avatarUrl} size="lg" />
          <Stack gap="none">
            <Text variant="body1" className="font-semibold">
              {name ?? login}
            </Text>
            <Text variant="body2">@{login}</Text>
          </Stack>
        </Row>
        <Row gap="sm" wrap>
          <Badge variant="secondary" className="font-normal">
            {meta.students} students
          </Badge>
          <Badge variant="secondary" className="font-normal">
            {meta.teachers} teachers
          </Badge>
          <Button variant="outline" size="sm" type="button">
            Copy join link
          </Button>
          <Button variant="ghost" size="sm" type="button">
            Open ›
          </Button>
        </Row>
      </Row>

      {/* The labs list — a white inset panel against the muted card. */}
      <Stack
        gap="none"
        className="w-full rounded-lg border border-border bg-background px-4 py-1"
      >
        {meta.labs.map((lab) => (
          <LabRow key={lab.id} lab={lab} />
        ))}
      </Stack>

      <Row>
        <Button variant="outline" size="sm" type="button">
          + Add a lab
        </Button>
      </Row>
    </Card>
  );
}
