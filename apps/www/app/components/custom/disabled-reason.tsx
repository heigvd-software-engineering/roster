import type { ReactElement } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

/**
 * A disabled control that still explains itself. Disabled elements swallow
 * pointer events in several browsers, so their native `title` tooltip is
 * unreliable: when there IS a reason we wrap the child in a focusable span and
 * show a real tooltip. With no reason the child renders untouched.
 *
 * CALL-SITE CONTRACT (the component can't own these, since the disabled/title
 * props live on the child, sometimes nested inside a dialog trigger):
 *   reason set  ⇔  the child is `disabled`  ⇔  the child's native `title`
 *   is `undefined`, or the browser stacks two tooltips. Derive all three from
 *   ONE `locked` predicate, as the Leave/Join/Delete usages do.
 */
export function DisabledReason({
  reason,
  children,
}: {
  /** Why the child is disabled. `null` means it isn't, so render it plain. */
  reason: string | null;
  children: ReactElement;
}) {
  if (reason === null) return children;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the wrapped button is DISABLED and therefore unfocusable, so the span must take focus or keyboard users never reach the reason.
          <span className="inline-flex" tabIndex={0} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{reason}</TooltipContent>
    </Tooltip>
  );
}
