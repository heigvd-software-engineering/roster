/**
 * The academic calendar, expressed as the first month of each semester
 * (1-based: 1 = January). Everything else — labels included — derives from
 * this one object, so a calendar shift is a one-line edit here.
 *
 * Defaults follow HEIG-VD: spring runs February–July, autumn August–January.
 * A month before the spring start (January) belongs to the autumn semester
 * that STARTED the previous calendar year.
 */
export const SEMESTER_CONFIG = {
  springStartMonth: 2,
  autumnStartMonth: 8,
  labels: { spring: "Spring", autumn: "Autumn" },
} as const;

export type Semester = {
  season: "spring" | "autumn";
  /** The calendar year the semester started in. */
  year: number;
};

type SemesterConfig = typeof SEMESTER_CONFIG;

export function semesterOf(
  date: Date,
  config: SemesterConfig = SEMESTER_CONFIG,
): Semester {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month >= config.autumnStartMonth) {
    return { season: "autumn", year };
  }
  if (month >= config.springStartMonth) {
    return { season: "spring", year };
  }
  return { season: "autumn", year: year - 1 };
}

/** e.g. "Spring 2026" — the classes-page group heading. */
export function semesterLabel(
  semester: Semester,
  config: SemesterConfig = SEMESTER_CONFIG,
): string {
  return `${config.labels[semester.season]} ${semester.year}`;
}
