import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

/**
 * A tiny icon button that explains itself in a popover ON CLICK — for the
 * middle ground between a tooltip (too easy to miss) and a confirm dialog
 * (too heavy to repeat): an operation that stays fully allowed but deserves
 * a visible, readable caveat right next to it.
 */
const VARIANT = {
  info: {
    icon: Info,
    className: "text-info",
    fallbackLabel: "More information",
  },
  warning: {
    icon: TriangleAlert,
    className: "text-warning",
    fallbackLabel: "Warning",
  },
  error: {
    icon: CircleAlert,
    className: "text-destructive",
    fallbackLabel: "Problem",
  },
} as const;

export function Hint({
  variant = "info",
  label,
  text,
  title,
  children,
}: {
  variant?: keyof typeof VARIANT;
  /** The button's accessible name — defaults to the variant's generic one.
   *  Ignored when `text` is given (the visible text names the button). */
  label?: string;
  /** Visible text beside the icon — for places a bare icon is too subtle. */
  text?: string;
  /** Optional bold first line of the popover. */
  title?: string;
  children: ReactNode;
}) {
  const { icon: Icon, className, fallbackLabel } = VARIANT[variant];
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size={text ? "sm" : "icon-xs"}
            type="button"
            aria-label={text ? undefined : (label ?? fallbackLabel)}
          />
        }
      >
        <Icon className={cn("size-3.5", className)} />
        {text ? <span className={className}>{text}</span> : null}
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          {title ? <PopoverTitle>{title}</PopoverTitle> : null}
          <PopoverDescription>{children}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}
