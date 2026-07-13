import type { ReactElement } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

/**
 * A disabled control that still explains itself. Native `title` tooltips are
 * unreliable on disabled elements (they swallow pointer events in several
 * browsers), so when there IS a reason we wrap the child in a focusable span
 * and show a real tooltip; with no reason the child renders untouched.
 */
export function DisabledReason({
  reason,
  children,
}: {
  /** Why the child is disabled — `null` means it isn't, render it plain. */
  reason: string | null;
  children: ReactElement;
}) {
  if (reason === null) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{reason}</TooltipContent>
    </Tooltip>
  );
}
