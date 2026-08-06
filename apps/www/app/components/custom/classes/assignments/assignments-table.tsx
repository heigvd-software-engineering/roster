import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  type AssignmentState,
  AssignmentStatus,
  assignmentState,
} from "~/components/custom/classes/assignments/assignment-status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { HubAssignmentItem } from "~/lib/api";
import { assignmentModeLabel, formatDay } from "~/lib/format";

/**
 * The class card's assignments, as a plain table: one row per assignment,
 * chronological (top = the first assignment worked on), with the assignment's
 * own fields — title, mode, dates, derived status — and the teacher's edit
 * control at the end.
 *
 * The status is clock math, no GitHub calls: an assignment is locked before its
 * start, running until its deadline, done after it. Push-based standing
 * (late, last push) stays on the assignment pages.
 */

/** An assignment's row order starts when students can act on it. */
const effectiveStart = (assignment: HubAssignmentItem) =>
  new Date(assignment.startAt ?? assignment.createdAt).getTime();

/** The one date statement. Only an EXPLICIT start earns a range: with a null
 *  startAt the earlier date is merely the creation date, and printing it
 *  would read as a chosen start the teacher never set. */
function dates(assignment: HubAssignmentItem) {
  const deadline = formatDay(new Date(assignment.deadline));
  return assignment.startAt
    ? `${formatDay(new Date(assignment.startAt))} → ${deadline}`
    : `due ${deadline}`;
}

export function AssignmentsTable({
  assignments,
  manage = false,
  action,
}: {
  assignments: HubAssignmentItem[];
  /** Teacher framing: rows link to /manage, locked rows stay clickable, and
   *  the starter-code marker survives the lock. */
  manage?: boolean;
  /** Per-row trailing control (the teacher's edit dialog). */
  action?: (assignment: HubAssignmentItem) => ReactNode;
}) {
  // Course order: chronological by effective start, deadline breaking ties.
  // The API already serves this order; sorting here keeps it a component
  // INVARIANT rather than a hope about the caller.
  const rows = [...assignments].sort(
    (a, b) =>
      effectiveStart(a) - effectiveStart(b) ||
      Date.parse(a.deadline) - Date.parse(b.deadline),
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Assignment</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Status</TableHead>
          {action ? <TableHead className="w-10" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((assignment) => (
          <AssignmentRow
            key={assignment.id}
            assignment={assignment}
            manage={manage}
            action={action}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function AssignmentRow({
  assignment,
  manage,
  action,
}: {
  assignment: HubAssignmentItem;
  manage: boolean;
  action?: ((assignment: HubAssignmentItem) => ReactNode) | undefined;
}) {
  const state = assignmentState(assignment);
  return (
    <TableRow>
      <TableCell className="font-medium">
        <AssignmentTitle
          assignment={assignment}
          state={state}
          manage={manage}
        />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {assignmentModeLabel(assignment)}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {dates(assignment)}
      </TableCell>
      <TableCell>
        <AssignmentStatus state={state} />
      </TableCell>
      {action ? (
        <TableCell className="text-right">{action(assignment)}</TableCell>
      ) : null}
    </TableRow>
  );
}

/**
 * The assignment's name, a link to its page unless the reader is a student and
 * the assignment hasn't started — then there is nothing behind it they may act
 * on. The starter-code note hides from students while locked: the template's
 * NAME (e.g. lab1-solution) is the leak the start gate exists to prevent.
 */
function AssignmentTitle({
  assignment,
  state,
  manage,
}: {
  assignment: HubAssignmentItem;
  state: AssignmentState;
  manage: boolean;
}) {
  const starter =
    assignment.templateRepoFullName !== null &&
    (state !== "locked" || manage) ? (
      <span
        className="ml-2 font-normal text-muted-foreground text-xs"
        title={assignment.templateRepoFullName}
      >
        starter code
      </span>
    ) : null;

  if (state === "locked" && !manage) {
    return (
      <span
        aria-disabled="true"
        title="This assignment hasn't started yet"
        className="text-muted-foreground"
      >
        {assignment.title}
        {starter}
      </span>
    );
  }
  return (
    <>
      <Link
        to={`/classes/${assignment.classId}/assignments/${assignment.id}${manage ? "/manage" : ""}`}
        className="hover:underline"
      >
        {assignment.title}
      </Link>
      {starter}
    </>
  );
}
