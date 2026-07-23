import { cn } from "~/lib/utils";

const MINUTE = 60_000;
const MINS_PER_HOUR = 60;
const MINS_PER_DAY = 60 * 24;
const WEEK_MS = 7 * 24 * 60 * MINUTE;

/** Milliseconds until the deadline: negative once it has passed. Read to the
 *  minute — a lab is "closed" the moment its time is reached, not at the next
 *  midnight. */
function msUntil(deadline: Date) {
  return deadline.getTime() - Date.now();
}

/**
 * Urgent = a teacher may still have to act: due within the next 7 days.
 * A passed deadline is NOT urgent — the lab is simply closed.
 */
export function isDeadlineUrgent(deadline: Date) {
  const ms = msUntil(deadline);
  return ms > 0 && ms <= WEEK_MS;
}

/** A precise, glanceable countdown: "closed" once passed, then to the minute
 *  under an hour ("in 42 min"), hours + minutes under a day ("in 3h 30m"),
 *  whole days beyond ("in 3 days"). The exact moment sits beside it. Minutes
 *  are rounded up so a future deadline never reads "in 0 min" and the label
 *  only says "closed" once the time is genuinely reached. Exported for the
 *  locked lab row's "starts …" countdown, which shares the vocabulary. */
export function relativeLabel(date: Date) {
  const ms = msUntil(date);
  if (ms <= 0) return "closed";
  const totalMins = Math.ceil(ms / MINUTE);
  if (totalMins < MINS_PER_HOUR) return `in ${totalMins} min`;
  if (totalMins < MINS_PER_DAY) {
    const hours = Math.floor(totalMins / MINS_PER_HOUR);
    const mins = totalMins % MINS_PER_HOUR;
    return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  }
  const days = Math.ceil(totalMins / MINS_PER_DAY);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * A relative deadline label whose color means one thing only: urgency.
 * Brand red when due within 7 days; muted otherwise — including "closed"
 * for passed deadlines. No traffic-light palette, so the one accent pops
 * exactly when a teacher must act.
 */
export function DeadlineText({ deadline }: { deadline: Date }) {
  const label = relativeLabel(deadline);

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
