import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ClassCard } from "~/components/custom/classes/hub/class-card";
import { formatDeadline } from "~/lib/format";

const profUser = {
  id: "u1",
  name: "Bob Prof",
  firstName: "Bob",
  lastName: "Prof",
  email: "bob@heig-vd.ch",
  emailVerified: true,
  image: null,
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

const lab = {
  id: "l1",
  classId: "c1",
  title: "Lab 1 — TCP sockets",
  deadline: "2099-08-01T23:59:00.000Z",
  groupMode: "group" as const,
  minMembers: 2,
  maxMembers: 3,
  templateRepoId: null,
  templateRepoFullName: null,
  createdByUserId: "u1",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

function renderCard() {
  return render(
    <MemoryRouter>
      <ClassCard
        id="c1"
        orgId={42}
        createdAt="2026-03-10T00:00:00.000Z"
        login="acme"
        name="Acme"
        avatarUrl="http://a"
        joinToken="tok123"
        teachers={[{ id: 1, login: "prof", avatarUrl: "http://p" }]}
        students={[{ id: 2, login: "alice", avatarUrl: "http://s" }]}
        pending={[{ id: 900, login: "bob", avatarUrl: null }]}
        users={[{ githubId: "1", user: profUser }]}
        labs={[lab]}
        onChanged={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("ClassCard people chips", () => {
  it("shows live counts with the pending suffix", () => {
    renderCard();
    expect(screen.getByText("1 student · 1 pending")).toBeInTheDocument();
    expect(screen.getByText("1 teacher")).toBeInTheDocument();
  });
});

describe("ClassCard org identity", () => {
  it("links to the GitHub org page", () => {
    renderCard();
    expect(screen.getByRole("link", { name: /@acme/ })).toHaveAttribute(
      "href",
      "https://github.com/acme",
    );
  });

  it("carries the teaching role chip", () => {
    renderCard();
    expect(screen.getByText("teaching")).toBeInTheDocument();
  });
});

describe("ClassCard student invitation link", () => {
  it("explains it invites per class before offering the copy", () => {
    renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: "Student invitation link" }),
    );
    // The one thing a teacher gets wrong: thinking they invite students to a
    // lab. The popover has to say the link is per class.
    expect(
      screen.getByText(/One link per class, not per lab/),
    ).toBeInTheDocument();
  });

  it("copies the join URL and confirms inline", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: "Student invitation link" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy invitation link" }),
    );

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join/tok123`,
    );
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe("ClassCard labs (F6)", () => {
  it("renders real lab rows with their mode", () => {
    renderCard();
    expect(screen.getByText("Lab 1 — TCP sockets")).toBeInTheDocument();
    expect(screen.getByText("group 2–3")).toBeInTheDocument();
    // The Progress column was dropped (user-decided 2026-07-07): standing
    // lives on the lab pages, the hub stays lean.
    expect(screen.queryByText("Progress")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ New lab" }),
    ).toBeInTheDocument();
  });

  it("shows the explicit deadline date and time", () => {
    renderCard();
    expect(
      screen.getByText(formatDeadline(new Date(lab.deadline))),
    ).toBeInTheDocument();
  });
});

describe("ClassCard audit + reconcile", () => {
  it("offers the audit beside the join link, not behind an ellipsis", () => {
    renderCard();
    expect(
      screen.getByRole("button", {
        name: "GitHub compliance audit of this class",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "More class actions" }),
    ).not.toBeInTheDocument();
  });

  it("says the audit only reads before offering the link", () => {
    renderCard();
    fireEvent.click(
      screen.getByRole("button", {
        name: "GitHub compliance audit of this class",
      }),
    );
    // The refresh icon reads as "repair now" — the copy has to say it doesn't.
    expect(screen.getByText(/audit only reads/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run the audit" })).toHaveAttribute(
      "href",
      "/classes/c1/reconcile",
    );
  });
});
