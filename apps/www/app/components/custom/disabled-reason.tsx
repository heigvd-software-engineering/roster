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
 *
 * CALL-SITE CONTRACT (the component can't own these — the disabled/title
 * props live on the child, sometimes nested inside a dialog trigger):
 *   reason set  ⇔  the child is `disabled`  ⇔  the child's native `title`
 *   is `undefined` (or the browser stacks two tooltips). Derive all three
 *   from ONE `locked` predicate — see the Leave/Join/Delete usages.
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
      <TooltipTrigger
        render={
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the wrapped button is DISABLED and therefore unfocusable — the span must take focus or keyboard users can never reach the reason.
          <span className="inline-flex" tabIndex={0} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{reason}</TooltipContent>
    </Tooltip>
  );
}
