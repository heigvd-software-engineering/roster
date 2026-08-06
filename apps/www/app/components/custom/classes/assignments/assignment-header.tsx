import type { ReactNode } from "react";
import { Link } from "react-router";
import { AssignmentStatusHover } from "~/components/custom/classes/assignments/assignment-status";
import { DeadlineText } from "~/components/custom/classes/assignments/deadline-text";
import { type Role, RoleChip } from "~/components/custom/classes/role-marker";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import type { AssignmentItem } from "~/lib/api";
import { assignmentModeLabel, formatDeadline } from "~/lib/format";

/**
 * The assignment page header, shared by the teacher and student pages:
 * breadcrumb, title + mode badge + deadline, and the caller's role chip on the
 * right.
 */
export function AssignmentHeader({
  className,
  assignment,
  kind,
  action,
}: {
  /** The class's display name for the breadcrumb. */
  className: string;
  assignment: AssignmentItem;
  kind: Role;
  /** Whole-assignment controls, alongside the role chip. The teacher page's delete
   *  lives here: the page under it is the one surface that shows what the
   *  deletion would take. */
  action?: ReactNode;
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
          <Text variant="heading">{assignment.title}</Text>
          <Badge variant="secondary" className="font-normal">
            {assignmentModeLabel(assignment)}
          </Badge>
          <DeadlineText deadline={new Date(assignment.deadline)} />
          <Text variant="body2" className="tabular-nums">
            {formatDeadline(new Date(assignment.deadline))}
          </Text>
          <AssignmentStatusHover assignment={assignment} />
        </Row>
        <Row gap="sm" align="center">
          <RoleChip kind={kind} />
          {action}
        </Row>
      </Row>
    </Stack>
  );
}
