import type { ReactNode } from "react";
import { Link } from "react-router";
import { AssignmentStatusHover } from "~/components/custom/classes/assignments/assignment-status";
import { DeadlineText } from "~/components/custom/classes/assignments/deadline-text";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import type { AssignmentItem } from "~/lib/api";
import { assignmentModeLabel, formatDeadline } from "~/lib/format";

/**
 * The assignment page header, shared by the teacher and student pages:
 * breadcrumb, title + mode badge + deadline, and whatever the page can act on.
 */
export function AssignmentHeader({
  className,
  assignment,
  action,
}: {
  /** The class's display name for the breadcrumb. */
  className: string;
  assignment: AssignmentItem;
  /** Whole-assignment controls, on the right. The teacher page's delete lives
   *  here: the page under it is the one surface that shows what the deletion
   *  would take. The student page passes none, and the row stays bare. */
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
        {action}
      </Row>
    </Stack>
  );
}
