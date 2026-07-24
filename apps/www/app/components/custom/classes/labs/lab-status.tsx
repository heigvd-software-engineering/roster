import { Check, Lock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { formatDeadline, labStarted } from "~/lib/format";
import { cn } from "~/lib/utils";

/**
 * The lab's ONE lifecycle axis, derived from the clock alone — no stored
 * state to flip, so a lab opens and closes on time without anyone touching
 * it. This module is the single home of that vocabulary: the derivation,
 * the three status words, the glyph-and-word status line (shared by the
 * hub timeline's labels and the lab page header), and the hover detail.
 */
export type LabState = "done" | "running" | "locked";

type LabDates = { startAt: string | null; deadline: string };

export const labState = (lab: LabDates): LabState =>
  !labStarted(lab)
    ? "locked"
    : Date.parse(lab.deadline) < Date.now()
      ? "done"
      : "running";

/** ONE status slot, one word per state — the same for every role: the lab
 *  is never "hidden", students see it locked. */
export function LabStatus({
  state,
  className,
}: {
  state: LabState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 font-mono text-[11px]",
        state === "done" && "text-muted-foreground",
        state === "running" && "font-semibold text-role-enrolled",
        state === "locked" && "font-semibold text-warning",
        className,
      )}
    >
      {state === "done" ? (
        <>
          <Check className="size-3" /> done
        </>
      ) : state === "running" ? (
        <>
          {/* The status vocabulary's one animation — a calm ping on the
              dot; static under prefers-reduced-motion. */}
          <span className="relative size-[7px] rounded-full bg-role-enrolled">
            <span
              aria-hidden
              className="absolute inset-[-1px] animate-ping rounded-full border border-role-enrolled [animation-duration:2.6s] motion-reduce:hidden"
            />
          </span>{" "}
          in progress
        </>
      ) : (
        <>
          <Lock className="size-3" /> not started
        </>
      )}
    </span>
  );
}

/** The full story behind each word — shown on hover, never as a paragraph
 *  in the page flow. */
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

/** The lab page's status, next to the title: the SAME status line the hub
 *  timeline shows, with the detail on hover. */
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
