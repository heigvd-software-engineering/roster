import { Link } from "react-router";
import {
  DeadlineText,
  isDeadlineUrgent,
} from "~/components/custom/classes/labs/deadline-text";
import { CAPS_LABEL } from "~/components/custom/typography/text";
import type { LabItem } from "~/lib/api";
import { formatDeadline, labModeLabel } from "~/lib/format";
import { cn } from "~/lib/utils";

/** One shared column template so the header and every row stay aligned:
 *  LAB (flexes) · MODE · DUE (date + relative). */
const LAB_GRID =
  "grid grid-cols-[minmax(0,1fr)_100px_215px] items-center gap-4 px-5";

const COLUMNS = ["Lab", "Mode", "Due"];

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
    </>
  );

  const row = (
    <Link
      to={`/classes/${lab.classId}/labs/${lab.id}${manage ? "/manage" : ""}`}
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
