import { cn } from "~/lib/utils";

const DAY = 86_400_000;

/** Whole days until the deadline: negative = past, 0 = today (a same-day
 *  deadline rounds up to 1). */
function daysUntil(deadline: Date) {
  return Math.ceil((deadline.getTime() - Date.now()) / DAY);
}

/**
 * Urgent = a teacher may still have to act: due today or within 7 days.
 * A past deadline is NOT urgent — the lab is simply closed.
 */
export function isDeadlineUrgent(deadline: Date) {
  const days = daysUntil(deadline);
  return days >= 0 && days <= 7;
}

/**
 * A relative deadline label whose color means one thing only: urgency.
 * Brand red when due today or ≤ 7 days out; muted otherwise — including
 * "closed" for past deadlines. No traffic-light palette, so the one accent
 * pops exactly when a teacher must act.
 */
export function DeadlineText({ deadline }: { deadline: Date }) {
  const days = daysUntil(deadline);
  const label =
    days < 0
      ? "closed"
      : days === 0
        ? "today"
        : `in ${days} day${days === 1 ? "" : "s"}`;

  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        isDeadlineUrgent(deadline)
          ? "font-medium text-brand"
          : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
