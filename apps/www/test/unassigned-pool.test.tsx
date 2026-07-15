import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnassignedPool } from "~/components/custom/classes/groups/shared/unassigned-pool";
import type { ClassItem } from "~/lib/api";

/** A pool student as the lab-groups response carries them. */
const student = (n: number) => ({
  githubId: String(n),
  login: `s${n}`,
  avatarUrl: null,
  state: "active" as const,
});

/** A linked SWITCH identity for that student. `user` is the whole drizzle row
 *  in production; only the name fields matter here. */
const linked = (n: number, firstName: string, lastName: string) =>
  [
    { githubId: String(n), user: { firstName, lastName, name: `gh-s${n}` } },
  ] as unknown as ClassItem["users"];
const pool = (count: number) =>
  Array.from({ length: count }, (_, i) => student(i + 1));

/** The display name of each identity row, in DOM order. GitHub-only pool
 *  students are named by their login (no @handle line). */
const names = () => screen.getAllByText(/^s\d+$/).map((el) => el.textContent);

describe("UnassignedPool", () => {
  it("renders nothing once everyone is placed", () => {
    const { container } = render(<UnassignedPool students={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("collapses the names behind a disclosure, whatever the size", () => {
    render(<UnassignedPool students={pool(12)} />);

    expect(
      screen.getByText(/Students without a group for this lab · 12/),
    ).toBeInTheDocument();
    expect(screen.queryByText("s1")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show all 12 students" }),
    ).toBeInTheDocument();
  });

  it("collapses a lone student too, without saying '1 students'", () => {
    render(<UnassignedPool students={pool(1)} />);

    expect(screen.queryByText("s1")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show the student" }),
    ).toBeInTheDocument();
  });

  it("summarises with the count alone — no faces", () => {
    render(<UnassignedPool students={pool(12)} />);

    expect(document.querySelectorAll('[data-slot="avatar"]')).toHaveLength(0);
    expect(
      screen.getByText(/Students without a group for this lab · 12/),
    ).toBeInTheDocument();
  });

  it("reveals the names on demand", () => {
    render(<UnassignedPool students={pool(12)} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Show all 12 students" }),
    );

    expect(screen.getByText("s1")).toBeInTheDocument();
    expect(names()).toHaveLength(12);
    expect(
      screen.getByRole("button", { name: "Hide the student list" }),
    ).toBeInTheDocument();
  });

  it("names a linked student by their SWITCH identity, over the login", () => {
    render(
      <UnassignedPool
        students={[student(1)]}
        users={linked(1, "Alice", "Dupont")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show the student" }));

    // ① linked → SWITCH name over the @login handle.
    expect(screen.getByText("Alice Dupont")).toBeInTheDocument();
    expect(screen.getByText("@s1")).toBeInTheDocument();
  });

  it("falls back to the login when no SWITCH identity is linked", () => {
    render(<UnassignedPool students={[student(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show the student" }));

    // ② GitHub only → the login is the name, shown once (no @handle line).
    expect(screen.getByText("s1")).toBeInTheDocument();
    expect(screen.queryByText("@s1")).not.toBeInTheDocument();
  });

  it("sorts the pool by the name it displays", () => {
    render(<UnassignedPool students={[student(3), student(1), student(2)]} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Show all 3 students" }),
    );

    expect(names()).toEqual(["s1", "s2", "s3"]);
  });
});
