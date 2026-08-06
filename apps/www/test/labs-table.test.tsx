import { render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { LabsTable } from "~/components/custom/classes/labs/labs-table";
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

// Passed out of order on purpose: the table must re-sort by start.
const labs = [lockedLab, doneLab, runningLab];

describe("LabsTable", () => {
  it("orders rows chronologically by effective start", () => {
    render(<LabsTable labs={labs} />);
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
    render(<LabsTable labs={labs} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });

  it("locks the future lab for students: no link, no starter leak", () => {
    render(<LabsTable labs={labs} />);
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
    // is the leak the start gate prevents), so exactly one starter marker.
    expect(screen.getAllByText("starter code")).toHaveLength(1);
  });

  it("keeps the teacher's locked row clickable, with both starter markers", () => {
    render(<LabsTable labs={labs} manage />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/classes/c1/labs/l1/manage",
      "/classes/c1/labs/l2/manage",
      "/classes/c1/labs/l3/manage",
    ]);
    expect(screen.getAllByText("starter code")).toHaveLength(2);
    // Same status word as the student side: the lab is locked, not hidden.
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
  });

  it("labels by deadline only when no start is set", () => {
    // With a null startAt the earlier date is merely the creation date, so
    // the cell prints no pseudo-start range.
    const noStart = { ...runningLab, startAt: null } as HubLabItem;
    render(<LabsTable labs={[noStart]} />);
    expect(screen.getByText(/^due /)).toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it("prints the range when a start is set", () => {
    render(<LabsTable labs={[runningLab]} />);
    expect(screen.getByText(/→/)).toBeInTheDocument();
  });

  it("renders a per-row action in its own column", () => {
    render(
      <LabsTable
        labs={[runningLab]}
        manage
        action={(lab) => <button type="button">Edit {lab.title}</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Edit Lab 2 — Threads" }),
    ).toBeInTheDocument();
  });
});
