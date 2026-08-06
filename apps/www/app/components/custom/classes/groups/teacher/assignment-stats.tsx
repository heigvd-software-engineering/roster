import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

type AssignmentStat = {
  value: number;
  /** Renders as a smaller, muted "/total" behind the value. */
  total?: number;
  label: string;
  /** Urgency: a non-zero value reads destructive (e.g. late groups). */
  alert?: boolean;
};

/**
 * The assignment's summary strip: hairline-separated numbers answering "do I
 * need to look closer at all?" before the roster.
 */
export function AssignmentStats({ stats }: { stats: AssignmentStat[] }) {
  return (
    <Card className="grid w-full auto-cols-fr grid-flow-col gap-0 overflow-hidden p-0">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="border-border border-l px-5 py-3 first:border-l-0"
        >
          <div
            className={cn(
              "text-xl tabular-nums",
              stat.alert && stat.value > 0 && "text-destructive",
            )}
          >
            {stat.value}
            {stat.total !== undefined ? (
              <span className="text-muted-foreground text-sm">
                /{stat.total}
              </span>
            ) : null}
          </div>
          <div className="text-muted-foreground text-xs">{stat.label}</div>
        </div>
      ))}
    </Card>
  );
}
