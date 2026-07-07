import { CAPS_LABEL } from "~/components/custom/typography/text";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

export type LabStat = {
  value: number;
  /** Renders as a smaller, muted "/total" behind the value. */
  total?: number;
  label: string;
  /** Urgency: a non-zero value lights up brand red (e.g. late groups). */
  alert?: boolean;
};

/**
 * The lab's summary strip — hairline-separated numbers answering "do I need
 * to look closer at all?" before the roster. A solid card surface: the
 * page's graph-paper background must not show through the numbers.
 */
export function LabStats({ stats }: { stats: LabStat[] }) {
  return (
    <Card className="grid w-full auto-cols-fr grid-flow-col gap-0 overflow-hidden p-0">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="border-border border-l px-5 py-3 first:border-l-0"
        >
          <div
            className={cn(
              "font-mono text-xl tabular-nums",
              stat.alert && stat.value > 0 && "text-brand",
            )}
          >
            {stat.value}
            {stat.total !== undefined ? (
              <span className="text-muted-foreground text-sm">
                /{stat.total}
              </span>
            ) : null}
          </div>
          <div className={cn(CAPS_LABEL, "text-muted-foreground")}>
            {stat.label}
          </div>
        </div>
      ))}
    </Card>
  );
}
