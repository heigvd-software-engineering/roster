import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeadlineChip } from "~/components/custom/classes/deadline-chip";

const HOUR = 3_600_000;
const DAY = 86_400_000;

function renderChip(offsetMs: number) {
  render(<DeadlineChip deadline={new Date(Date.now() + offsetMs)} />);
}

describe("DeadlineChip", () => {
  it("rounds a same-day deadline up to 1 day, red tone", () => {
    // Math.ceil(2h / 24h) = 1.
    renderChip(2 * HOUR);
    const chip = screen.getByText("due in 1d");
    expect(chip.className).toContain("text-red-700");
  });

  it("is red at 2 days out (≤ 7d threshold)", () => {
    renderChip(2 * DAY);
    const chip = screen.getByText("due in 2d");
    expect(chip.className).toContain("text-red-700");
  });

  it("is amber at 20 days out (≤ 30d threshold)", () => {
    renderChip(20 * DAY);
    const chip = screen.getByText("due in 20d");
    expect(chip.className).toContain("text-amber-700");
  });

  it("is green beyond 30 days", () => {
    renderChip(40 * DAY);
    const chip = screen.getByText("due in 40d");
    expect(chip.className).toContain("text-emerald-700");
  });

  it("counts a past deadline as N days overdue, red tone", () => {
    renderChip(-1 * DAY);
    const chip = screen.getByText("1d overdue");
    expect(chip.className).toContain("text-red-700");
  });

  it("shows 'due today' right at the boundary", () => {
    // A deadline set to "now" resolves to a tiny negative delta by render
    // time, so `days` is Math.ceil(-ε / DAY) === -0. Since `-0 === 0` (and
    // `-0 < 0` is false) in JS, the component's `days === 0` branch still
    // matches and renders "due today" — not "0d overdue". Verified via
    // `Math.ceil(-0.0001) === -0` before writing this assertion; no code
    // fix was needed, the -0/0 comparisons already do the right thing.
    renderChip(0);
    expect(screen.getByText("due today")).toBeInTheDocument();
  });
});
