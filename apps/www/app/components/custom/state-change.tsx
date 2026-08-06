import { ArrowRight } from "lucide-react";
import { Row } from "~/components/custom/layout/row";
import { Badge } from "~/components/ui/badge";

/**
 * A state transition read left to right: what stands NOW → what it becomes.
 * The arrow is the verb. The FROM badge is outlined because it is merely the
 * present; the TO badge is filled, because it is the outcome Apply produces.
 */
export function StateChange({ from, to }: { from: string; to: string }) {
  return (
    <Row gap="sm" align="center" wrap className="min-w-0">
      <Badge variant="outline">{from}</Badge>
      <ArrowRight
        aria-label="becomes"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <Badge variant="secondary">{to}</Badge>
    </Row>
  );
}
