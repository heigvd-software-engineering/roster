/**
 * Deadline timestamps. Fixed en-GB so every viewer reads the same shape (the
 * app's copy is English; browser locales would reshuffle day/month order and
 * switch to 12-hour clocks). The time always shows — deadlines are moments,
 * not days — but the year only appears when it isn't the current one:
 * "10 Jul, 23:59" vs "1 Aug 2099, 23:59".
 */
const WITH_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const THIS_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDeadline(deadline: Date): string {
  const format =
    deadline.getFullYear() === new Date().getFullYear() ? THIS_YEAR : WITH_YEAR;
  return format.format(deadline);
}
