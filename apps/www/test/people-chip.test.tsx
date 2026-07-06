import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PeopleChip } from "~/components/custom/classes/people-chip";

const aliceUser = {
  id: "u1",
  name: "A. Student",
  firstName: "Alice",
  lastName: "Student",
  email: "alice@heig-vd.ch",
  emailVerified: true,
  image: null,
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

describe("PeopleChip", () => {
  it("shows the label and opens a people table with GitHub links", async () => {
    render(
      <PeopleChip
        label="1 student · 1 pending"
        emptyText="No students yet."
        people={[
          { id: 7, login: "alice", avatarUrl: "http://a", user: aliceUser },
          { id: 8, login: "bob", avatarUrl: null, user: null, pending: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("1 student · 1 pending"));

    expect(await screen.findByRole("link", { name: /@alice/ })).toHaveAttribute(
      "href",
      "https://github.com/alice",
    );
    // Two-column table: SWITCH identity is primary, GitHub secondary.
    expect(screen.getByText("Switch identity")).toBeInTheDocument();
    expect(screen.getByText("GitHub identity")).toBeInTheDocument();
    expect(screen.getByText("Alice Student")).toBeInTheDocument();
    expect(screen.getByText("alice@heig-vd.ch")).toBeInTheDocument();
    // No labs account linked to that GitHub identity yet.
    expect(screen.getByText("not linked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /@bob/ })).toHaveAttribute(
      "href",
      "https://github.com/bob",
    );
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("is a native button, so keyboard activation is built in", () => {
    // The stat-text trigger must stay a real <button> (not a styled span):
    // Enter/Space activation then comes from the browser, no synthetic
    // key handling to guard. jsdom can't simulate Enter→click, so we assert
    // the element itself.
    render(
      <PeopleChip
        label="1 student"
        emptyText="No students yet."
        people={[{ id: 7, login: "alice", avatarUrl: "http://a", user: null }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "1 student" });
    expect(trigger.tagName).toBe("BUTTON");
  });

  it("shows the empty text when there is nobody", async () => {
    render(
      <PeopleChip
        label="0 students"
        emptyText="No students yet."
        people={[]}
      />,
    );
    fireEvent.click(screen.getByText("0 students"));
    expect(await screen.findByText("No students yet.")).toBeInTheDocument();
  });
});
