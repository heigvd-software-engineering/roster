import { fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { StudentAssignmentPage } from "~/pages/student-assignment-page";

const params = vi.hoisted(() => ({ classId: "c1", assignmentId: "l1" }));

vi.mock("react-router", () => ({
  useParams: () => params,
  Link: ({ to, children, ...props }: PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
}));

vi.mock("~/contexts/auth-context", () => ({
  useAuth: () => ({
    github: { login: "alice", id: 7, name: "Alice", avatarUrl: "http://a" },
  }),
}));

vi.mock("~/contexts/message-context", () => ({
  useMessages: () => ({ push: vi.fn() }),
}));

vi.mock("~/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api")>();
  return { ...actual, useApi: vi.fn() };
});

const groupAssignment = {
  id: "l1",
  classId: "c1",
  title: "Assignment 1 — Sockets",
  deadline: "2099-08-01T23:59:00.000Z",
  groupMode: "group",
  minMembers: 2,
  maxMembers: 3,
  createdByUserId: "u1",
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
};
const individualAssignment = {
  ...groupAssignment,
  id: "l2",
  title: "Assignment 2 — Solo",
  groupMode: "individual",
  minMembers: null,
  maxMembers: null,
};

const alice = { id: 7, login: "alice", avatarUrl: "http://a" };
const bob = { id: 8, login: "bob", avatarUrl: null };

/** The page is one request: a single groups response (or its error). */
function mockApi(assignmentGroupsData: unknown, error?: unknown) {
  vi.mocked(useApi).mockImplementation(
    () =>
      ({
        data: assignmentGroupsData,
        error,
        mutate: vi.fn(),
      }) as unknown as ReturnType<typeof useApi>,
  );
}

/** An assignment group in the per-assignment response shape (repo/activity folded in). */
const grp = (over: Record<string, unknown>) => ({
  id: "g1",
  name: "Team Alpha",
  slug: "team-alpha",
  members: [] as unknown[],
  repoFullName: null,
  pushedAt: null,
  repoCreatedAt: null,
  ...over,
});

const groupsData = (over?: Record<string, unknown>) => ({
  // The header data rides on the groups response (merged endpoint).
  assignment: groupAssignment,
  class: { name: "Acme", login: "acme" },
  role: "student",
  membershipState: "active",
  groups: [] as unknown[],
  users: [],
  // The pool source: the class_members cache riding on the response.
  students: [
    { githubId: "7", login: "alice", avatarUrl: "http://a", state: "active" },
    { githubId: "8", login: "bob", avatarUrl: null, state: "active" },
  ],
  ...over,
});

beforeEach(() => {
  params.classId = "c1";
  params.assignmentId = "l1";
});

describe("StudentAssignmentPage — group assignment", () => {
  it("offers Join on a group with room, plus New group", () => {
    mockApi(groupsData({ groups: [grp({ members: [bob] })] }));
    render(<StudentAssignmentPage />);

    // 1/3 with a min of 2: the first open seat is the one still needed to
    // form, the second is merely available. Both are the join verb.
    expect(
      screen.getByRole("button", { name: "Join (required to form)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Join this group" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New group" }),
    ).toBeInTheDocument();
    // The pool shows students not in any group of this assignment (alice).
    expect(
      screen.getByText(/Students without a group for this assignment/),
    ).toBeInTheDocument();
  });

  it("collapses to YOUR group once you're in one; hides the others", () => {
    mockApi(
      groupsData({
        groups: [
          grp({ id: "g1", name: "Team Alpha", members: [alice, bob] }),
          grp({ id: "g2", name: "Team Beta", slug: "team-beta", members: [] }),
        ],
      }),
    );
    render(<StudentAssignmentPage />);

    expect(screen.getByText("your group")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(screen.getByText("Team Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Team Beta")).not.toBeInTheDocument();
    // g1 has the min (2) → the start card, repo yet to create.
    expect(screen.getByText("Your group is ready")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create repository" }),
    ).toBeInTheDocument();
  });

  it("keeps the start card away while your group is under the minimum", () => {
    mockApi(groupsData({ groups: [grp({ members: [alice] })] }));
    render(<StudentAssignmentPage />);

    expect(screen.getByText("Needs a member to form")).toBeInTheDocument();
    expect(screen.queryByText("Your group is ready")).not.toBeInTheDocument();
  });

  it("start card turns to the clone instructions once the repo exists", () => {
    mockApi(
      groupsData({
        groups: [
          grp({
            members: [alice, bob],
            repoFullName: "acme/assignment-1-team-alpha",
          }),
        ],
      }),
    );
    render(<StudentAssignmentPage />);

    expect(
      screen.getByText("repository created, off you go"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /git clone https:\/\/github\.com\/acme\/assignment-1-team-alpha\.git/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create repository" }),
    ).not.toBeInTheDocument();
  });

  it("warns that creating the repo locks the group, before creating", () => {
    mockApi(groupsData({ groups: [grp({ members: [alice, bob] })] }));
    render(<StudentAssignmentPage />);

    // The button no longer fires directly; it opens the confirm gate.
    fireEvent.click(screen.getByRole("button", { name: "Create repository" }));
    expect(screen.getByText("Create the work repository?")).toBeInTheDocument();
    expect(screen.getByText(/This locks the group/)).toBeInTheDocument();
  });

  it("locks Leave once your group's repo exists", async () => {
    mockApi(
      groupsData({
        groups: [
          grp({
            members: [alice, bob],
            repoFullName: "acme/assignment-1-team-alpha",
          }),
        ],
      }),
    );
    render(<StudentAssignmentPage />);

    const leave = screen.getByRole("button", { name: "Leave" });
    expect(leave).toBeDisabled();
    // The reason lives in a real tooltip (native title is unreliable on
    // disabled buttons). Its trigger wraps the button and shows on focus.
    fireEvent.focus(leave.parentElement as HTMLElement);
    expect(
      await screen.findByText(
        "The group's work repository exists. Ask your teacher to move you.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the repo card when a locked group falls below the minimum", () => {
    // Teacher removed a member from a locked 2-person group (min 2): the
    // survivor must still reach the repo they're required to work in.
    mockApi(
      groupsData({
        groups: [
          grp({
            members: [alice],
            repoFullName: "acme/assignment-1-team-alpha",
          }),
        ],
      }),
    );
    render(<StudentAssignmentPage />);

    expect(
      screen.getByText(
        /git clone https:\/\/github\.com\/acme\/assignment-1-team-alpha\.git/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave" })).toBeDisabled();
  });

  it("replaces the link and clone commands with a clear error when the repo is missing", () => {
    mockApi(
      groupsData({
        groups: [
          grp({
            members: [alice, bob],
            repoFullName: "acme/assignment-1-team-alpha",
            repoStatus: "missing",
          }),
        ],
      }),
    );
    render(<StudentAssignmentPage />);

    // Visible without clicking anything, not just a small badge.
    expect(
      screen.getByText("This repository no longer exists on GitHub"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("repository deleted on GitHub"),
    ).toBeInTheDocument();
    // Cloning a deleted repo makes no sense, so neither the link nor the
    // clone commands render.
    expect(
      screen.queryByRole("link", { name: /acme\/assignment-1-team-alpha/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Clone it to work locally:"),
    ).not.toBeInTheDocument();
    // The 404 badge stays (same explanation as the teacher's), info-only.
    fireEvent.click(
      screen.getByRole("button", {
        name: "This repository no longer exists on GitHub",
      }),
    );
    expect(
      screen.getByText(/Ask your teacher to unlink it/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Unlink repository" }),
    ).not.toBeInTheDocument();
  });

  it("locks Join on a group whose repo exists", () => {
    // Someone else's group: room left (1/3) but already locked by its repo.
    mockApi(
      groupsData({
        groups: [
          grp({ members: [bob], repoFullName: "acme/assignment-1-team-alpha" }),
        ],
      }),
    );
    render(<StudentAssignmentPage />);

    // The seat survives the lock — hiding it would make a locked 1/3 group
    // read as full — but the verb doesn't: it becomes a passive slot that
    // names the teacher as the only way in.
    expect(
      screen.queryByRole("button", { name: /^Join/ }),
    ).not.toBeInTheDocument();
    const seats = screen.getAllByText("Locked seat: ask your teacher");
    expect(seats.length).toBeGreaterThan(0);
    expect(seats[0]).toHaveAttribute(
      "title",
      "This group's repository exists, so only your teacher can add members",
    );
  });
});

describe("StudentAssignmentPage — individual assignment", () => {
  it("is one-click: Accept assignment, no group machinery", () => {
    params.assignmentId = "l2";
    mockApi(groupsData({ assignment: individualAssignment, groups: [] }));
    render(<StudentAssignmentPage />);

    expect(
      screen.getByRole("button", { name: "Accept assignment" }),
    ).toBeInTheDocument();
    // The ghost tile: the accepted layout, dimmed, before the click.
    expect(
      screen.getByText("your solo assignment, not accepted yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This assignment is individual"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Groups in this assignment"),
    ).not.toBeInTheDocument();
  });

  it("shows the solo tile + the work repo card once the solo group has one", () => {
    params.assignmentId = "l2";
    mockApi(
      groupsData({
        assignment: individualAssignment,
        groups: [
          grp({
            id: "solo",
            name: "alice",
            slug: "alice",
            members: [alice],
            repoFullName: "acme/assignment-2-solo-alice",
          }),
        ],
      }),
    );
    render(<StudentAssignmentPage />);

    // The solo tile: the group flow's own skeleton with solo copy.
    expect(screen.getByText("your solo assignment")).toBeInTheDocument();
    expect(screen.getByText("Your assignment is ready")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /acme\/assignment-2-solo-alice/ }),
    ).toHaveAttribute(
      "href",
      "https://github.com/acme/assignment-2-solo-alice",
    );
    expect(
      screen.getByText(
        /git clone https:\/\/github\.com\/acme\/assignment-2-solo-alice\.git/,
      ),
    ).toBeInTheDocument();
    // The repo exists → the solo group is a deliverable: no Withdraw.
    expect(
      screen.queryByRole("button", { name: "Withdraw" }),
    ).not.toBeInTheDocument();
  });

  it("shows the same missing-repo error on the solo tile when the individual assignment's repo is deleted", () => {
    params.assignmentId = "l2";
    mockApi(
      groupsData({
        assignment: individualAssignment,
        groups: [
          grp({
            id: "solo",
            name: "alice",
            slug: "alice",
            members: [alice],
            repoFullName: "acme/assignment-2-solo-alice",
            repoStatus: "missing",
          }),
        ],
      }),
    );
    render(<StudentAssignmentPage />);

    expect(screen.getByText("Your assignment is ready")).toBeInTheDocument();
    expect(
      screen.getByText("This repository no longer exists on GitHub"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("repository deleted on GitHub"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /acme\/assignment-2-solo-alice/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/git clone https:\/\/github\.com/),
    ).not.toBeInTheDocument();
  });

  it("offers only the repo retry when the accept's repo step failed — no Withdraw", () => {
    params.assignmentId = "l2";
    mockApi(
      groupsData({
        assignment: individualAssignment,
        groups: [
          grp({ id: "solo", name: "alice", slug: "alice", members: [alice] }),
        ],
      }),
    );
    render(<StudentAssignmentPage />);

    expect(screen.getByText("one step left")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create repository" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Withdraw" }),
    ).not.toBeInTheDocument();
  });
});

describe("StudentAssignmentPage — edges", () => {
  it("gates a pending enrollee", () => {
    // The pending branch: live membership state on the response, no 404.
    mockApi(groupsData({ membershipState: "pending" }));
    render(<StudentAssignmentPage />);
    expect(
      screen.getByText(/Accept your invitation on GitHub first/),
    ).toBeInTheDocument();
  });

  it("redirects a TEACHER to the manage page", () => {
    // The response's role decides the redirect, with no class list involved.
    mockApi(groupsData({ role: "teacher" }));
    render(<StudentAssignmentPage />);
    expect(screen.getByTestId("navigate")).toHaveTextContent(
      "/classes/c1/assignments/l1/manage",
    );
  });

  it("gates a not-yet-started assignment with its start date", () => {
    // Mirrors the server: pre-start, a student's response is head-only.
    mockApi(
      groupsData({
        assignment: { ...groupAssignment, startAt: "2099-07-01T08:00:00.000Z" },
        groups: [],
        students: [],
      }),
    );
    render(<StudentAssignmentPage />);
    expect(screen.getByText(/This assignment starts/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ New group" }),
    ).not.toBeInTheDocument();
  });

  it("shows a not-found message for an unknown assignment", () => {
    // Unknown assignment (or class, or no access) = a 404 from the one
    // endpoint.
    params.assignmentId = "nope";
    mockApi(
      undefined,
      Object.assign(new Error("GET /api/… failed (404)"), { status: 404 }),
    );
    render(<StudentAssignmentPage />);
    expect(
      screen.getByText(
        "This assignment doesn't exist (or you're not in its class).",
      ),
    ).toBeInTheDocument();
  });
});
