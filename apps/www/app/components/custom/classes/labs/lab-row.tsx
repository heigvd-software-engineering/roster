import { Link } from "react-router";
import {
  DeadlineText,
  isDeadlineUrgent,
} from "~/components/custom/classes/labs/deadline-text";
import { CAPS_LABEL } from "~/components/custom/typography/text";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { LabItem } from "~/lib/api";
import { formatDeadline, labModeLabel } from "~/lib/format";
import { cn } from "~/lib/utils";

/** One shared column template so the header and every row stay aligned:
 *  LAB (flexes) · MODE · DUE (date + relative). */
const LAB_GRID =
  "grid grid-cols-[minmax(0,1fr)_100px_215px] items-center gap-4 px-5";

const COLUMNS = ["Lab", "Mode", "Due"];

/**
 * The quiet "starter code" badge beside a lab's title (same words as the
 * lab form's field) — HOVER shows the template repository name. The whole
 * row is a LINK, so the trigger renders as a span (a nested <button> is
 * invalid HTML inside an anchor); hovering never navigates.
 */
function TemplateBadge({ fullName }: { fullName: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0 items-center rounded-full bg-foreground/6 px-2 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider" />
        }
      >
        starter code
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        <span className="font-mono">{fullName}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** The labs table's column header row — quiet mono caps, hairline below.
 *  `actions` reserves the same right gutter as rows carrying an action
 *  (the teacher's edit pencil), so the columns stay aligned. */
export function LabsHeader({ actions = false }: { actions?: boolean }) {
  return (
    <div
      className={cn(
        LAB_GRID,
        "border-border border-b pt-3 pb-2",
        actions && "pr-14",
      )}
    >
      {COLUMNS.map((col) => (
        <span key={col} className={cn(CAPS_LABEL, "text-muted-foreground")}>
          {col}
        </span>
      ))}
    </div>
  );
}

/** One lab row: title · mode · due (exact moment + urgency-colored countdown)
 *  · progress. Links to the role's lab page: `manage` (the teaching card)
 *  goes to the teacher's manage page, otherwise the student's accept page.
 *  `action` (e.g. the
 *  teacher's edit pencil) overlays the row's right edge, OUTSIDE the link —
 *  a button may not nest in an anchor. */
export function LabRow({
  lab,
  manage = false,
  action,
}: {
  lab: LabItem;
  manage?: boolean;
  action?: React.ReactNode;
}) {
  const mode = labModeLabel(lab);
  const deadline = new Date(lab.deadline);
  const urgent = isDeadlineUrgent(deadline);
  const cells = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-sm">{lab.title}</span>
        {lab.templateRepoFullName ? (
          <TemplateBadge fullName={lab.templateRepoFullName} />
        ) : null}
      </span>
      <span className="font-mono text-muted-foreground text-xs">{mode}</span>
      {/* Urgent deadlines light up the whole cell — date included. */}
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            urgent ? "font-medium text-brand" : "text-muted-foreground",
          )}
        >
          {formatDeadline(deadline)}
        </span>
        <span
          className={cn(
            "font-mono text-xs",
            urgent ? "text-brand/60" : "text-muted-foreground/60",
          )}
        >
          ·
        </span>
        <DeadlineText deadline={deadline} />
      </span>
    </>
  );

  const row = (
    <Link
      to={`/classes/${lab.classId}/labs/${lab.id}${manage ? "/manage" : ""}`}
      // In-row popover triggers (the template badge) mark themselves
      // data-stop-link: cancel navigation HERE, at the anchor — cancelling
      // on the trigger itself would also abort the popover's own handling.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-stop-link]")) {
          e.preventDefault();
        }
      }}
      className={cn(
        LAB_GRID,
        "border-border border-b py-2.5 transition-colors hover:bg-muted/60",
        action && "pr-14",
      )}
    >
      {cells}
    </Link>
  );
  if (!action) {
    return row;
  }
  return (
    <div className="relative">
      {row}
      <div className="absolute inset-y-0 right-4 flex items-center">
        {action}
      </div>
    </div>
  );
}
