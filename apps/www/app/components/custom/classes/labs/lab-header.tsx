import { Link } from "react-router";
import { DeadlineText } from "~/components/custom/classes/labs/deadline-text";
import { LabStatusHover } from "~/components/custom/classes/labs/lab-status";
import { type Role, RoleChip } from "~/components/custom/classes/role-marker";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import type { LabItem } from "~/lib/api";
import { formatDeadline, labModeLabel } from "~/lib/format";

/**
 * The lab page header, shared by the teacher and student pages: breadcrumb,
 * title + mode badge + deadline, and the caller's role chip on the right.
 */
export function LabHeader({
  className,
  lab,
  kind,
}: {
  /** The class's display name for the breadcrumb. */
  className: string;
  lab: LabItem;
  kind: Role;
}) {
  return (
    <Stack gap="sm" className="w-full">
      <Link
        to="/classes"
        className="self-start text-muted-foreground text-sm hover:underline"
      >
        ‹ Classes / {className}
      </Link>
      <Row justify="between" wrap className="w-full">
        <Row gap="sm" wrap>
          <Text variant="heading">{lab.title}</Text>
          <Badge variant="secondary" className="font-normal">
            {labModeLabel(lab)}
          </Badge>
          <DeadlineText deadline={new Date(lab.deadline)} />
          <Text variant="body2" className="tabular-nums">
            {formatDeadline(new Date(lab.deadline))}
          </Text>
          <LabStatusHover lab={lab} />
        </Row>
        <RoleChip kind={kind} />
      </Row>
    </Stack>
  );
}
