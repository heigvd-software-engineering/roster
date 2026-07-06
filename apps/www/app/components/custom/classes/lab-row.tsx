import { Link } from "react-router";
import {
  DeadlineText,
  isDeadlineUrgent,
} from "~/components/custom/classes/deadline-text";
import type { LabItem } from "~/lib/api";
import { formatDeadline, labModeLabel } from "~/lib/format";
import { cn } from "~/lib/utils";

/** One shared column template so the header and every row stay aligned:
 *  LAB (flexes) · MODE · DUE (date + relative) · PROGRESS. */
const LAB_GRID =
  "grid grid-cols-[minmax(0,1fr)_100px_215px_80px] items-center gap-4 px-5";

const COLUMNS = ["Lab", "Mode", "Due", "Progress"];

/** The labs table's column header row — quiet mono caps, hairline below. */
export function LabsHeader() {
  return (
    <div className={cn(LAB_GRID, "border-border border-b pt-3 pb-2")}>
      {COLUMNS.map((col) => (
        <span
          key={col}
          className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]"
        >
          {col}
        </span>
      ))}
    </div>
  );
}

/** One lab row: title · mode · due (exact moment + urgency-colored countdown)
 *  · progress. Links to the lab page — the drill-down unit for BOTH roles
 *  (teachers manage, students attach their groups there). Progress shows `—`
 *  until acceptance repos exist (F8). `action` (e.g. the teacher's edit
 *  pencil) overlays the row's right edge, OUTSIDE the link — a button may
 *  not nest in an anchor. */
export function LabRow({
  lab,
  action,
}: {
  lab: LabItem;
  action?: React.ReactNode;
}) {
  const mode = labModeLabel(lab);
  const deadline = new Date(lab.deadline);
  const urgent = isDeadlineUrgent(deadline);
  const cells = (
    <>
      <span className="truncate font-medium text-sm">{lab.title}</span>
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
      <span className="font-mono text-muted-foreground text-xs">—</span>
    </>
  );

  const row = (
    <Link
      to={`/classes/${lab.classId}/labs/${lab.id}`}
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
