import { render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { LabRow } from "~/components/custom/classes/labs/lab-row";
import type { LabItem } from "~/lib/api";

vi.mock("react-router", () => ({
  Link: ({ to, children, ...props }: PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const base = {
  id: "l1",
  classId: "c1",
  title: "Lab 2 — Streams",
  deadline: "2099-08-01T23:59:00.000Z",
  startAt: null,
  groupMode: "group",
  minMembers: 2,
  maxMembers: 3,
  templateRepoId: 7,
  templateRepoFullName: "acme/lab1-solution",
  createdByUserId: "u1",
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
} as unknown as LabItem;

const scheduled = { ...base, startAt: "2099-07-01T08:00:00.000Z" } as LabItem;

describe("LabRow", () => {
  it("renders a started lab as a link with the starter-code badge", () => {
    render(<LabRow lab={base} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/classes/c1/labs/l1",
    );
    expect(screen.getByText("starter code")).toBeInTheDocument();
  });

  it("locks a pre-start lab for students: no link, a starts date, no badge", () => {
    render(<LabRow lab={scheduled} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/starts/)).toBeInTheDocument();
    // The template's NAME is itself a leak (e.g. lab1-solution).
    expect(screen.queryByText("starter code")).not.toBeInTheDocument();
  });

  it("keeps the teacher's pre-start row clickable, with a starts marker", () => {
    render(<LabRow lab={scheduled} manage />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/classes/c1/labs/l1/manage",
    );
    expect(screen.getByText(/starts/)).toBeInTheDocument();
    expect(screen.getByText("starter code")).toBeInTheDocument();
  });
});
