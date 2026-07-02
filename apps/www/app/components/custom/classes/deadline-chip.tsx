import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

const DAY = 86_400_000;

/**
 * A deadline countdown chip whose tone signals urgency:
 * red ≤ 7 days / overdue · amber ≤ 30 days · green beyond.
 * (Tone classes are prototype-level; promote to tokens if kept.)
 */
export function DeadlineChip({ deadline }: { deadline: Date }) {
  const days = Math.ceil((deadline.getTime() - Date.now()) / DAY);
  const label =
    days < 0
      ? `${-days}d overdue`
      : days === 0
        ? "due today"
        : `due in ${days}d`;
  const tone =
    days <= 7
      ? "border-red-200 bg-red-50 text-red-700"
      : days <= 30
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <Badge variant="outline" className={cn("font-normal", tone)}>
      {label}
    </Badge>
  );
}
