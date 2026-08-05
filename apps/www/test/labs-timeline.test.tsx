import { render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { LabsTimeline } from "~/components/custom/classes/labs/labs-timeline";
import type { HubLabItem } from "~/lib/api";

vi.mock("react-router", () => ({
  Link: ({ to, children, ...props }: PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const base = {
  classId: "c1",
  templateRepoId: null,
  templateRepoFullName: null,
  minMembers: 2,
  maxMembers: 3,
  groupMode: "group",
  createdByUserId: "u1",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// Anchored around "today" so states derive live from the clock, like the app.
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const doneLab = {
  ...base,
  id: "l1",
  title: "Lab 1 — TCP sockets",
  createdAt: at(-60),
  startAt: at(-58),
  deadline: at(-30),
} as HubLabItem;
const runningLab = {
  ...base,
  id: "l2",
  title: "Lab 2 — Threads",
  createdAt: at(-20),
  startAt: at(-10),
  deadline: at(20),
  templateRepoId: 7,
  templateRepoFullName: "acme/lab1-solution",
} as HubLabItem;
const lockedLab = {
  ...base,
  id: "l3",
  title: "Lab 3 — Final project",
  createdAt: at(-5),
  startAt: at(12),
  deadline: at(50),
  templateRepoId: 8,
  templateRepoFullName: "acme/lab2-solution",
} as HubLabItem;

// Passed out of order on purpose: the timeline must re-sort by start.
const labs = [lockedLab, doneLab, runningLab];
// The span the caller would compute (labs carry explicit starts): earliest
// start → latest deadline. Tests pass it explicitly, as the cards do.
const span = { start: new Date(at(-58)), end: new Date(at(50)) };

describe("LabsTimeline", () => {
  it("orders rows chronologically by effective start", () => {
    render(<LabsTimeline labs={labs} span={span} />);
    const titles = screen
      .getAllByText(/Lab \d/)
      .map((el) => el.textContent ?? "");
    expect(titles).toEqual([
      "Lab 1 — TCP sockets",
      "Lab 2 — Threads",
      "Lab 3 — Final project",
    ]);
  });

  it("gives every state its one status word", () => {
    render(<LabsTimeline labs={labs} span={span} />);
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(screen.getByText("in progress")).toBeInTheDocument();
    expect(screen.getByText("not started")).toBeInTheDocument();
  });

  it("marks today and pulses only the running lab's status dot", () => {
    const { container } = render(<LabsTimeline labs={labs} span={span} />);
    expect(screen.getByText(/now ·/)).toBeInTheDocument();
    // One ping ring, on the in-progress status dot and nowhere else (the
    // bar itself carries no animation).
    expect(container.querySelectorAll(".animate-ping")).toHaveLength(1);
    expect(screen.getByText(/due/)).toBeInTheDocument();
  });

  it("locks the future lab for students: no link, no starter leak", () => {
    render(<LabsTimeline labs={labs} span={span} />);
    const links = screen.getAllByRole("link");
    // Done + running link to their lab pages; the locked lab does not.
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/classes/c1/labs/l1",
      "/classes/c1/labs/l2",
    ]);
    expect(
      screen.getByTitle("This lab hasn't started yet"),
    ).toBeInTheDocument();
    // The running lab's template shows; the locked lab's must not (its name
    // is the leak the start gate prevents), so exactly one starter chip.
    expect(screen.getAllByText("starter code")).toHaveLength(1);
    expect(screen.getByText("not started")).toBeInTheDocument();
  });

  it("keeps the teacher's locked row clickable, with both starter chips", () => {
    render(<LabsTimeline labs={labs} span={span} manage />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/classes/c1/labs/l1/manage",
      "/classes/c1/labs/l2/manage",
      "/classes/c1/labs/l3/manage",
    ]);
    expect(screen.getAllByText("starter code")).toHaveLength(2);
    // Same status word as the student side: the lab is locked, not hidden.
    expect(screen.getByText("not started")).toBeInTheDocument();
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
  });

  it("keeps a truthful edge and labels by deadline only when no start is set", () => {
    // The bar's left edge stays truthful (createdAt: the lab could not be
    // worked on earlier); the tooltip names it, and the label prints no
    // pseudo-start.
    const noStart = { ...runningLab, startAt: null } as HubLabItem;
    const { container } = render(<LabsTimeline labs={[noStart]} span={span} />);
    expect(screen.getByText(/· due/)).toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
    const bar = container.querySelector(
      '[class*="ring-role-enrolled"]',
    ) as HTMLElement;
    expect(bar.style.left).not.toBe("0%");
  });

  it("explains the bar's full span with one hover surface", () => {
    const { container } = render(
      <LabsTimeline labs={[runningLab]} span={span} />,
    );
    // One tooltip zone covers the whole bar (start truth and deadline),
    // rendered as the bar's last child so overlays can't eat the hover.
    const zones = container.querySelectorAll(".cursor-help");
    expect(zones).toHaveLength(1);
    expect(zones[0]).toBe(zones[0]?.parentElement?.lastElementChild);
  });

  it("drops the now line when today falls outside the span", () => {
    // An archived class: every lab done, the whole span in the past. A
    // clamped "now" would point at the wrong month, so it's absent.
    const pastSpan = { start: new Date(at(-90)), end: new Date(at(-25)) };
    render(<LabsTimeline labs={[doneLab]} span={pastSpan} />);
    expect(screen.queryByText(/now ·/)).not.toBeInTheDocument();
  });

  it("drops the now line when today is before the span too", () => {
    // A next-term class scheduled entirely in the future: same rule, left
    // side.
    const futureSpan = { start: new Date(at(30)), end: new Date(at(90)) };
    render(<LabsTimeline labs={[lockedLab]} span={futureSpan} />);
    expect(screen.queryByText(/now ·/)).not.toBeInTheDocument();
  });

  it("renders a per-row action in its own column", () => {
    render(
      <LabsTimeline
        labs={[runningLab]}
        span={span}
        manage
        action={(lab) => <button type="button">Edit {lab.title}</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Edit Lab 2 — Threads" }),
    ).toBeInTheDocument();
  });
});
