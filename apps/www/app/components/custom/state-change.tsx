import { ArrowRight } from "lucide-react";
import { Row } from "~/components/custom/layout/row";
import { cn } from "~/lib/utils";

/**
 * A state transition read left to right: what stands NOW → what it becomes.
 * The join page's "you → class" row at chip scale — the arrow is the verb.
 * The FROM chip is always neutral (it is merely the present); the TO chip
 * carries the outcome's color: brand for a repair, destructive for a removal.
 */
export function StateChange({
  from,
  to,
  destructive = false,
}: {
  from: string;
  to: string;
  destructive?: boolean;
}) {
  return (
    <Row gap="sm" align="center" wrap className="min-w-0">
      <Chip className="bg-muted text-muted-foreground">{from}</Chip>
      <ArrowRight
        aria-label="becomes"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <Chip
        className={
          destructive
            ? "bg-destructive/10 text-destructive"
            : "bg-brand/10 text-brand"
        }
      >
        {to}
      </Chip>
    </Row>
  );
}

function Chip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "min-w-0 break-words rounded-md px-2 py-0.5 font-medium text-xs",
        className,
      )}
    >
      {children}
    </span>
  );
}
