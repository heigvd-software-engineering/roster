import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

/**
 * The seat bases. Every open slot on a group card builds on one of these two,
 * and each role file names its own NATURES over them (the teacher's
 * AddMemberSeat; the student's JoinSeat / VacantSeat / LockedSeat), so a
 * nature's copy lives next to its one consumer.
 *
 * The rule across the app: SeatButton = clicking this seat acts; SeatSlot =
 * the seat exists but the verb belongs to someone else. `required` (still
 * short of the lab's minimum) reads at full strength; an optional seat stays
 * muted.
 */

/** A filled member row and an open seat must share one height, or the wall's
 *  rhythm breaks. GroupCard applies this to member rows too. */
export const SEAT_ROW_HEIGHT = "min-h-9";

const SEAT_ROW = cn(
  SEAT_ROW_HEIGHT,
  "flex w-full items-center gap-2.5 rounded-md border border-dashed border-border px-2 text-left text-muted-foreground text-sm",
);

type SeatButtonProps = ComponentProps<"button"> & { required?: boolean };

/** Base for the ACTING natures. A plain button with props spread, so a nature
 *  can be handed to a PopoverTrigger's `render` and anchor a picker. */
export function SeatButton({
  required = false,
  className,
  children,
  ...props
}: SeatButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        SEAT_ROW,
        "hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
        required && "text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

type SeatSlotProps = ComponentProps<"div"> & { required?: boolean };

/** Base for the PASSIVE natures. A div, not a disabled button, because it
 *  explains itself on hover (`title`) and disabled buttons swallow pointer
 *  events. */
export function SeatSlot({
  required = false,
  className,
  children,
  ...props
}: SeatSlotProps) {
  return (
    <div
      className={cn(SEAT_ROW, required && "text-foreground", className)}
      {...props}
    >
      {children}
    </div>
  );
}
