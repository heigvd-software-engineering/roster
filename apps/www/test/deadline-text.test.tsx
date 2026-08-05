import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeadlineText } from "~/components/custom/classes/labs/deadline-text";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function renderDeadline(offsetMs: number) {
  render(<DeadlineText deadline={new Date(Date.now() + offsetMs)} />);
}

describe("DeadlineText", () => {
  it("counts minutes under an hour, urgent (brand)", () => {
    renderDeadline(42 * MINUTE);
    const el = screen.getByText("in 42 min");
    expect(el.className).toContain("text-brand");
  });

  it("shows hours + minutes under a day", () => {
    renderDeadline(3 * HOUR + 30 * MINUTE);
    const el = screen.getByText("in 3h 30m");
    expect(el.className).toContain("text-brand");
  });

  it("drops the minutes at a whole hour", () => {
    renderDeadline(2 * HOUR);
    expect(screen.getByText("in 2h")).toBeTruthy();
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

  it("reads 'closed' the moment the deadline passes, calm", () => {
    // A single minute past the deadline, with no wait for the next midnight.
    renderDeadline(-1 * MINUTE);
    const el = screen.getByText("closed");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).not.toContain("text-brand");
  });

  it("reads 'closed' at the exact boundary, no longer urgent", () => {
    // A deadline of "now" resolves to a tiny negative delta by render time,
    // so it is already closed, neither "today" nor urgent.
    renderDeadline(0);
    const el = screen.getByText("closed");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).not.toContain("text-brand");
  });
});
