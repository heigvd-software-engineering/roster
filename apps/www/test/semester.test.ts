import { describe, expect, it } from "vitest";
import { semesterLabel, semesterOf } from "~/lib/semester";

describe("semesterOf", () => {
  it("puts February through July in spring of the same year", () => {
    expect(semesterOf(new Date("2026-02-01"))).toEqual({
      season: "spring",
      year: 2026,
    });
    expect(semesterOf(new Date("2026-07-31"))).toEqual({
      season: "spring",
      year: 2026,
    });
  });

  it("puts August through December in autumn of the same year", () => {
    expect(semesterOf(new Date("2026-08-01"))).toEqual({
      season: "autumn",
      year: 2026,
    });
    expect(semesterOf(new Date("2026-12-31"))).toEqual({
      season: "autumn",
      year: 2026,
    });
  });

  it("puts January in the autumn semester that started the previous year", () => {
    expect(semesterOf(new Date("2026-01-15"))).toEqual({
      season: "autumn",
      year: 2025,
    });
  });
});

describe("semesterLabel", () => {
  it("formats season + start year", () => {
    expect(semesterLabel({ season: "spring", year: 2026 })).toBe("Spring 2026");
    expect(semesterLabel({ season: "autumn", year: 2025 })).toBe("Autumn 2025");
  });
});
