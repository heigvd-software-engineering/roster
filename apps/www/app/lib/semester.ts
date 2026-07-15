/**
 * The academic calendar as an ORDERED list of terms (by start month,
 * 1-based). Everything else — labels, ranges, paging — derives from this
 * one object, so a calendar shift is a one-line edit here. A date before
 * the first term's start belongs to the LAST term of the previous
 * calendar year.
 *
 * Defaults follow HEIG-VD: spring February–June, summer school July–August,
 * autumn September–January.
 */
const SEMESTER_CONFIG = {
  terms: [
    { season: "spring", startMonth: 2, label: "Spring" },
    { season: "summer", startMonth: 7, label: "Summer" },
    { season: "autumn", startMonth: 9, label: "Autumn" },
  ],
} as const;

type SemesterConfig = typeof SEMESTER_CONFIG;
type Season = SemesterConfig["terms"][number]["season"];

export type Semester = {
  season: Season;
  /** The calendar year the semester started in. */
  year: number;
};

export function semesterOf(
  date: Date,
  config: SemesterConfig = SEMESTER_CONFIG,
): Semester {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const started = [...config.terms]
    .reverse()
    .find((t) => month >= t.startMonth);
  if (started) return { season: started.season, year };
  // Before the year's first term: the previous year's last term.
  const last = config.terms[config.terms.length - 1];
  if (!last) throw new Error("SEMESTER_CONFIG.terms must not be empty");
  return { season: last.season, year: year - 1 };
}

/** e.g. "Spring 2026" — the classes-page group heading. */
export function semesterLabel(
  semester: Semester,
  config: SemesterConfig = SEMESTER_CONFIG,
): string {
  const term = config.terms.find((t) => t.season === semester.season);
  return `${term?.label ?? semester.season} ${semester.year}`;
}

/** The semester we're in right now. */
export function currentSemester(
  now: Date = new Date(),
  config: SemesterConfig = SEMESTER_CONFIG,
): Semester {
  return semesterOf(now, config);
}

/** One step back through the calendar (paging: "Load more"). */
export function previousSemester(
  semester: Semester,
  config: SemesterConfig = SEMESTER_CONFIG,
): Semester {
  const index = config.terms.findIndex((t) => t.season === semester.season);
  const prev = config.terms[index - 1];
  if (prev) return { season: prev.season, year: semester.year };
  const last = config.terms[config.terms.length - 1];
  if (!last) throw new Error("SEMESTER_CONFIG.terms must not be empty");
  return { season: last.season, year: semester.year - 1 };
}

/** The moment the semester begins — the hub's `from` window bound. */
export function semesterStart(
  semester: Semester,
  config: SemesterConfig = SEMESTER_CONFIG,
): Date {
  const term = config.terms.find((t) => t.season === semester.season);
  if (!term) throw new Error(`Unknown season: ${semester.season}`);
  return new Date(semester.year, term.startMonth - 1, 1);
}
