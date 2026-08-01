import { Plus } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

/**
 * The seat bases — every open slot on a group card builds on one of these
 * two, and each role file names its own NATURES over them (the teacher's
 * AddMemberSeat; the student's JoinSeat / VacantSeat / LockedSeat), so a
 * nature's copy and accent live next to their one consumer.
 *
 * The visual rule across the app: a PLUS in the circle = clicking this seat
 * acts (SeatButton); an EMPTY circle = the seat exists but the verb belongs
 * to someone else (SeatSlot). `required` (still short of the lab's minimum)
 * wears the warning tint in every nature.
 */

/** A filled member row and an open seat must share one height, or the
 *  wall's rhythm breaks — GroupCard applies this to member rows too. */
export const SEAT_ROW_HEIGHT = "min-h-9";

const SEAT = {
  row: cn(
    SEAT_ROW_HEIGHT,
    // foreground/40, not less — a lighter dash all but disappears on the
    // light theme's white card.
    "flex w-full items-center gap-2.5 rounded-md border border-foreground/40 border-dashed px-2 text-left text-muted-foreground text-xs transition-colors",
  ),
  rowRequired: "border-warning/55 bg-warning/5 text-warning",
  // border-current: the circle wears the seat's own text color, so a nature
  // that recolors the row (amber required, the student's red locked seat)
  // recolors the circle for free.
  circle:
    "flex size-6 flex-none items-center justify-center rounded-full border border-current border-dashed",
};

type SeatButtonProps = ComponentProps<"button"> & { required?: boolean };

/** Base for the ACTING natures — plus in the circle. Plain button (props
 *  spread) so a nature can be handed to a PopoverTrigger's `render` and
 *  anchor a picker. */
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

/** Base for the PASSIVE natures — empty circle. A div, not a disabled
 *  button: it should explain itself on hover (`title`), and disabled
 *  buttons swallow pointer events. */
export function SeatSlot({
  required = false,
  className,
  children,
  ...props
}: SeatSlotProps) {
  return (
    <div
      className={cn(SEAT.row, required && SEAT.rowRequired, className)}
      {...props}
    >
      <span className={SEAT.circle} />
      {children}
    </div>
  );
}
