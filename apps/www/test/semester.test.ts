import { describe, expect, it } from "vitest";
import {
  previousSemester,
  semesterEnd,
  semesterLabel,
  semesterOf,
  semesterStart,
  timelineSpan,
} from "~/lib/semester";

describe("semesterOf", () => {
  it("puts February through June in spring of the same year", () => {
    expect(semesterOf(new Date("2026-02-01"))).toEqual({
      season: "spring",
      year: 2026,
    });
    expect(semesterOf(new Date("2026-06-30"))).toEqual({
      season: "spring",
      year: 2026,
    });
  });

  it("puts July and August in the summer school", () => {
    expect(semesterOf(new Date("2026-07-01"))).toEqual({
      season: "summer",
      year: 2026,
    });
    expect(semesterOf(new Date("2026-08-31"))).toEqual({
      season: "summer",
      year: 2026,
    });
  });

  it("puts September through December in autumn of the same year", () => {
    expect(semesterOf(new Date("2026-09-01"))).toEqual({
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
    expect(semesterLabel({ season: "summer", year: 2026 })).toBe("Summer 2026");
    expect(semesterLabel({ season: "autumn", year: 2025 })).toBe("Autumn 2025");
  });
});

describe("previousSemester", () => {
  it("steps back through the year's terms", () => {
    expect(previousSemester({ season: "autumn", year: 2026 })).toEqual({
      season: "summer",
      year: 2026,
    });
    expect(previousSemester({ season: "summer", year: 2026 })).toEqual({
      season: "spring",
      year: 2026,
    });
  });

  it("wraps the year's first term to the previous year's last", () => {
    expect(previousSemester({ season: "spring", year: 2026 })).toEqual({
      season: "autumn",
      year: 2025,
    });
  });
});

describe("semesterStart", () => {
  it("returns the first moment of the term", () => {
    expect(semesterStart({ season: "spring", year: 2026 })).toEqual(
      new Date(2026, 1, 1),
    );
    expect(semesterStart({ season: "autumn", year: 2025 })).toEqual(
      new Date(2025, 8, 1),
    );
  });
});

describe("semesterEnd", () => {
  it("ends where the next term starts (exclusive)", () => {
    expect(semesterEnd({ season: "spring", year: 2026 })).toEqual(
      new Date(2026, 6, 1), // summer starts in July
    );
  });

  it("rolls autumn into the next year's first term", () => {
    expect(semesterEnd({ season: "autumn", year: 2025 })).toEqual(
      new Date(2026, 1, 1), // spring starts in February
    );
  });
});

describe("timelineSpan", () => {
  const semester = { season: "spring", year: 2026 } as const;

  it("falls back to the semester when no lab has an explicit start", () => {
    const labs = [
      { startAt: null, deadline: "2026-03-15T23:59:00.000Z" },
      { startAt: null, deadline: "2026-05-15T23:59:00.000Z" },
    ];
    expect(timelineSpan(labs, semester)).toEqual({
      start: new Date(2026, 1, 1),
      end: new Date(2026, 6, 1),
    });
  });

  it("spans earliest explicit start to latest deadline, ignoring the semester", () => {
    const labs = [
      // Runs past the semester's end — the span follows the labs.
      {
        startAt: "2026-03-01T08:00:00.000Z",
        deadline: "2026-09-15T23:59:00.000Z",
      },
      { startAt: null, deadline: "2026-04-01T23:59:00.000Z" },
    ];
    expect(timelineSpan(labs, semester)).toEqual({
      start: new Date("2026-03-01T08:00:00.000Z"),
      end: new Date("2026-09-15T23:59:00.000Z"),
    });
  });
});
