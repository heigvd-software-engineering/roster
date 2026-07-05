/**
 * Deadline timestamps, e.g. "1 Aug 2099, 23:59". Fixed en-GB so every viewer
 * reads the same shape (the app's copy is English; browser locales would
 * reshuffle day/month order and switch to 12-hour clocks).
 */
const DEADLINE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDeadline(deadline: Date): string {
  return DEADLINE_FORMAT.format(deadline);
}
