import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeadlineText } from "~/components/custom/classes/deadline-text";

const HOUR = 3_600_000;
const DAY = 86_400_000;

function renderDeadline(offsetMs: number) {
  render(<DeadlineText deadline={new Date(Date.now() + offsetMs)} />);
}

describe("DeadlineText", () => {
  it("rounds a same-day deadline up to 1 day, urgent (brand)", () => {
    // Math.ceil(2h / 24h) = 1.
    renderDeadline(2 * HOUR);
    const el = screen.getByText("in 1 day");
    expect(el.className).toContain("text-brand");
  });

  it("is urgent at 2 days out (≤ 7d threshold)", () => {
    renderDeadline(2 * DAY);
    const el = screen.getByText("in 2 days");
    expect(el.className).toContain("text-brand");
  });

  it("is neutral at 20 days out — color means urgency only", () => {
    renderDeadline(20 * DAY);
    const el = screen.getByText("in 20 days");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).not.toContain("text-brand");
  });

  it("is neutral beyond 30 days", () => {
    renderDeadline(40 * DAY);
    const el = screen.getByText("in 40 days");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).not.toContain("text-brand");
  });

  it("reads 'closed' after the deadline, calm — nothing left to act on", () => {
    renderDeadline(-1 * DAY);
    const el = screen.getByText("closed");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).not.toContain("text-brand");
  });

  it("shows 'today' right at the boundary, urgent", () => {
    // A deadline set to "now" resolves to a tiny negative delta by render
    // time, so `days` is Math.ceil(-ε / DAY) === -0. Since `-0 === 0` (and
    // `-0 < 0` is false) in JS, the component's `days === 0` branch still
    // matches and renders "today" — not "closed". Likewise `-0 >= 0` is true,
    // so the urgency check keeps a right-now deadline urgent.
    renderDeadline(0);
    const el = screen.getByText("today");
    expect(el.className).toContain("text-brand");
  });
});
