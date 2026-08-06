import { Badge } from "~/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { formatDeadline, labStarted } from "~/lib/format";

/**
 * The lab's ONE lifecycle axis, derived from the clock alone. No stored state
 * to flip, so a lab opens and closes on time without anyone touching it. This
 * module is the single home of that vocabulary: the derivation, the three
 * status words, the badge (shared by the hub table and the lab page header),
 * and the hover detail.
 */
export type LabState = "done" | "running" | "locked";

type LabDates = { startAt: string | null; deadline: string };

export const labState = (lab: LabDates): LabState =>
  !labStarted(lab)
    ? "locked"
    : Date.parse(lab.deadline) < Date.now()
      ? "done"
      : "running";

const LABEL: Record<LabState, string> = {
  done: "Done",
  running: "In progress",
  locked: "Not started",
};

/** ONE status slot, one word per state, the same for every role: the lab is
 *  never "hidden", students see it locked. */
export function LabStatus({
  state,
  className,
}: {
  state: LabState;
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
function labStateDetail(lab: LabDates, state: LabState): string {
  if (state === "done") {
    return `The deadline passed on ${formatDeadline(new Date(lab.deadline))}.`;
  }
  if (state === "running") {
    return `Open for students — due ${formatDeadline(new Date(lab.deadline))}.`;
  }
  return (
    `Opens for students on ${lab.startAt ? formatDeadline(new Date(lab.startAt)) : "—"}. ` +
    "Until then students see the lab in their list but cannot form groups or create repositories."
  );
}

/** The lab page's status, next to the title: the SAME badge the hub table
 *  shows, plus the detail on hover. */
export function LabStatusHover({ lab }: { lab: LabDates }) {
  const state = labState(lab);
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-help" />}>
        <LabStatus state={state} />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72">
        {labStateDetail(lab, state)}
      </TooltipContent>
    </Tooltip>
  );
}
