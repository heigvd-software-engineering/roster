import { Plus } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

/**
 * The seat bases. Every open slot on a group card builds on one of these two,
 * and each role file names its own NATURES over them (the teacher's
 * AddMemberSeat; the student's JoinSeat / VacantSeat / LockedSeat), so a
 * nature's copy and accent live next to their one consumer.
 *
 * The visual rule across the app: a PLUS in the circle = clicking this seat
 * acts (SeatButton); an EMPTY circle = the seat exists but the verb belongs
 * to someone else (SeatSlot). `required` (still short of the lab's minimum)
 * wears the warning tint in every nature.
 */

/** A filled member row and an open seat must share one height, or the wall's
 *  rhythm breaks. GroupCard applies this to member rows too. */
export const SEAT_ROW_HEIGHT = "min-h-9";

const SEAT = {
  row: cn(
    SEAT_ROW_HEIGHT,
    // foreground/40, not less: a lighter dash all but disappears on the light
    // theme's white card.
    "flex w-full items-center gap-2.5 rounded-md border border-foreground/40 border-dashed px-2 text-left text-muted-foreground text-xs transition",
  ),
  // Every open seat recedes to 70% so it reads as background next to the
  // filled members; an ACTING seat returns to full strength under the
  // pointer. Composed per base below, so each declares its whole opacity
  // story in one place (SeatButton stacks acts + its disabled:opacity-50).
  recedes: "opacity-70",
  acts: "hover:opacity-100",
  rowRequired: "border-warning/55 bg-warning/5 text-warning",
  // border-current: the circle wears the seat's own text color, so a nature
  // that recolors the row (amber required, the student's red locked seat)
  // recolors the circle for free.
  circle:
    "flex size-6 flex-none items-center justify-center rounded-full border border-current border-dashed",
};

type SeatButtonProps = ComponentProps<"button"> & { required?: boolean };

/** Base for the ACTING natures: plus in the circle. A plain button with props
 *  spread, so a nature can be handed to a PopoverTrigger's `render` and anchor
 *  a picker. */
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
        SEAT.row,
        SEAT.recedes,
        SEAT.acts,
        "disabled:pointer-events-none disabled:opacity-50",
        required &&
          cn(
            SEAT.rowRequired,
            "hover:border-warning hover:bg-warning/10 hover:text-warning",
          ),
        className,
      )}
      {...props}
    >
      <span className={SEAT.circle}>
        <Plus className="size-3.5" />
      </span>
      {children}
    </button>
  );
}

type SeatSlotProps = ComponentProps<"div"> & { required?: boolean };

/** Base for the PASSIVE natures: empty circle. A div, not a disabled button,
 *  because it explains itself on hover (`title`) and disabled buttons swallow
 *  pointer events. */
export function SeatSlot({
  required = false,
  className,
  children,
  ...props
}: SeatSlotProps) {
  return (
    <div
      className={cn(
        SEAT.row,
        SEAT.recedes,
        required && SEAT.rowRequired,
        className,
      )}
      {...props}
    >
      <span className={SEAT.circle} />
      {children}
    </div>
  );
}
