/**
 * Deadline timestamps. Fixed en-GB so every viewer reads the same shape (the
 * app's copy is English; browser locales would reshuffle day/month order and
 * switch to 12-hour clocks). Deadlines are moments, not days, so the time
 * always shows, but the year appears only when it isn't the current one:
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

/** Whether the lab is open to students. Mirrors the API's `labStarted`
 *  (apps/api/src/lib/groups.ts); the server verdict is authoritative, this
 *  only drives rendering. No start date = open since creation. */
export function labStarted(lab: { startAt?: string | null }): boolean {
  return !lab.startAt || new Date(lab.startAt).getTime() <= Date.now();
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

/** "1 Jun": the timeline's compact day. No time, no year, because the axis
 *  and the relative label beside it carry the rest. */
export function formatDay(d: Date): string {
  return DAY_MONTH.format(d);
}

export function formatDeadline(deadline: Date): string {
  const format =
    deadline.getFullYear() === new Date().getFullYear() ? THIS_YEAR : WITH_YEAR;
  return format.format(deadline);
}

/** "3 groups" / "1 group": the one spelling of a pluralized count. */
export function count(
  n: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** One spelling of a lab's mode: "individual" or "group 2–3". */
export function labModeLabel(lab: {
  groupMode: "individual" | "group";
  minMembers: number | null;
  maxMembers: number | null;
}): string {
  return lab.groupMode === "individual"
    ? "individual"
    : `group ${lab.minMembers}–${lab.maxMembers}`;
}

/** A SWITCH user's display name: real first + last when present (the
 *  identity inside the app), else the profile name. */
export function switchDisplayName(user: {
  firstName: string | null;
  lastName: string | null;
  name: string;
}): string {
  return user.firstName && user.lastName
    ? `${user.firstName} ${user.lastName}`
    : user.name;
}

/** Cache for `usersByGithubId`, keyed on the response array itself: SWR
 *  keeps the reference stable between renders, so every call site on a page
 *  (the wall builds the map once per card) shares one Map per fetch. */
const usersMapCache = new WeakMap<object, Map<string, unknown>>();

/** The linked-users rows (riding on class/groups responses) as a lookup by
 *  GitHub id: the one way member rosters correlate to SWITCH identities. */
export function usersByGithubId<U>(
  users?: { githubId: string; user: U }[],
): Map<string, U> {
  if (!users) return new Map();
  const cached = usersMapCache.get(users);
  if (cached) return cached as Map<string, U>;
  const map = new Map(users.map((u) => [u.githubId, u.user]));
  usersMapCache.set(users, map);
  return map;
}
