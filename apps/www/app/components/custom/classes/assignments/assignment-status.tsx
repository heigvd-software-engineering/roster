import { Badge } from "~/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { assignmentStarted, formatDeadline } from "~/lib/format";

/**
 * The assignment's ONE lifecycle axis, derived from the clock alone. No stored
 * state to flip, so an assignment opens and closes on time without anyone
 * touching it. This module is the single home of that vocabulary: the
 * derivation, the three status words, the badge (shared by the hub table and
 * the assignment page header), and the hover detail.
 */
export type AssignmentState = "done" | "running" | "locked";

type AssignmentDates = { startAt: string | null; deadline: string };

export const assignmentState = (
  assignment: AssignmentDates,
): AssignmentState =>
  !assignmentStarted(assignment)
    ? "locked"
    : Date.parse(assignment.deadline) < Date.now()
      ? "done"
      : "running";

const LABEL: Record<AssignmentState, string> = {
  done: "Done",
  running: "In progress",
  locked: "Not started",
};

/** ONE status slot, one word per state, the same for every role: the assignment is
 *  never "hidden", students see it locked. */
export function AssignmentStatus({
  state,
  className,
}: {
  state: AssignmentState;
  className?: string;
}) {
  return (
    <Badge
      variant={state === "running" ? "secondary" : "outline"}
      className={className}
    >
      {LABEL[state]}
    </Badge>
  );
}

/** The full story behind each word, shown on hover, never as a paragraph in
 *  the page flow. */
function assignmentStateDetail(
  assignment: AssignmentDates,
  state: AssignmentState,
): string {
  if (state === "done") {
    return `The deadline passed on ${formatDeadline(new Date(assignment.deadline))}.`;
  }
  if (state === "running") {
    return `Open for students, due ${formatDeadline(new Date(assignment.deadline))}.`;
  }
  return (
    `Opens for students on ${assignment.startAt ? formatDeadline(new Date(assignment.startAt)) : "–"}. ` +
    "Until then students see the assignment in their list but cannot form groups or create repositories."
  );
}

/** The assignment page's status, next to the title: the SAME badge the hub table
 *  shows, plus the detail on hover. */
export function AssignmentStatusHover({
  assignment,
}: {
  assignment: AssignmentDates;
}) {
  const state = assignmentState(assignment);
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-help" />}>
        <AssignmentStatus state={state} />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72">
        {assignmentStateDetail(assignment, state)}
      </TooltipContent>
    </Tooltip>
  );
}
