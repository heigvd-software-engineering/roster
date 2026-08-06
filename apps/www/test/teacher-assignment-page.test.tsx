import { fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { TeacherAssignmentPage } from "~/pages/teacher-assignment-page";

const params = vi.hoisted(() => ({ classId: "c1", assignmentId: "l1" }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router", () => ({
  useParams: () => params,
  // The header's delete leaves for /classes on success; nothing here asserts
  // where it lands, only that the page renders around it.
  useNavigate: () => navigate,
  Link: ({ to, children, ...props }: PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
}));

vi.mock("~/contexts/auth-context", () => ({
  useAuth: () => ({
    github: { login: "prof", id: 111, name: "Prof", avatarUrl: null },
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

const alice = { id: 7, login: "alice", avatarUrl: "http://a" };
const bob = { id: 8, login: "bob", avatarUrl: null };
const carol = { id: 9, login: "carol", avatarUrl: null };

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

const grp = (over: Record<string, unknown>) => ({
  id: "g1",
  name: "Team Alpha",
  slug: "team-alpha",
  members: [] as unknown[],
  repoFullName: null,
  pushedAt: null,
  repoCreatedAt: null,
  lastCommit: null,
  ...over,
});

const groupsData = {
  // The header data rides on the groups response (merged endpoint).
  assignment: groupAssignment,
  class: { name: "Acme", login: "acme" },
  role: "teacher",
  membershipState: "active",
  groups: [grp({ members: [bob] })],
  users: [],
  // The pool source: the class_members cache riding on the response.
  students: [
    { githubId: "7", login: "alice", avatarUrl: "http://a", state: "active" },
    { githubId: "8", login: "bob", avatarUrl: null, state: "active" },
  ],
};

beforeEach(() => {
  params.classId = "c1";
  params.assignmentId = "l1";
});

describe("TeacherAssignmentPage", () => {
  it("shows the header, the without-a-group pool, and management", () => {
    mockApi(groupsData);
    render(<TeacherAssignmentPage />);

    expect(screen.getByText("Assignment 1 — Sockets")).toBeInTheDocument();
    expect(screen.getByText("teaching")).toBeInTheDocument();
    // alice is in NO group of this assignment → she's in the pool.
    expect(
      screen.getByText(/Students without a group for this assignment/),
    ).toBeInTheDocument();
    // The pool collapses at every size; the names are one click away.
    // alice is GitHub-only here → named by her login, shown as a @handle.
    fireEvent.click(screen.getByRole("button", { name: "Show the student" }));
    expect(screen.getByText("@alice")).toBeInTheDocument();
    // The roster: Team Alpha with 1/2 members → under min.
    expect(screen.getByText("Team Alpha")).toBeInTheDocument();
    expect(screen.getByText("under min")).toBeInTheDocument();
    // Toolbar: create a group for this assignment (no attach: groups are
    // per-assignment).
    expect(
      screen.getByRole("button", { name: "New group" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Attach a group" }),
    ).not.toBeInTheDocument();
    // Management lives ON the card, nothing hidden behind a disclosure: the
    // open seat adds, each member wears its remove ×, the kebab holds delete.
    // 1/3 with a min of 2 → two open seats, each its own add-picker.
    expect(
      screen.getAllByRole("button", { name: "Add a member to Team Alpha" }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Remove bob from Team Alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actions for Team Alpha" }),
    ).toBeInTheDocument();
    // Teachers never join/leave.
    expect(
      screen.queryByRole("button", { name: /^Join/ }),
    ).not.toBeInTheDocument();
    // No repo yet → roster edits carry no warning.
    expect(
      screen.queryByRole("button", { name: "repo exists" }),
    ).not.toBeInTheDocument();
  });

  it("links the repo and still offers delete once the work repo exists", () => {
    mockApi({
      ...groupsData,
      groups: [
        grp({ members: [alice, bob], repoFullName: "acme/lab1-team-alpha" }),
      ],
    });
    render(<TeacherAssignmentPage />);

    // The repo exists → the row links it, and delete stays offered: no
    // deletion in this app is refused, the typed name is the whole gate.
    expect(
      screen.getByRole("link", { name: /acme\/lab1-team-alpha/ }),
    ).toBeInTheDocument();
    // Delete lives in the card's kebab, and is never disabled: the typed
    // name in the dialog is the whole gate.
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Team Alpha" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Delete group" }),
    ).not.toBeDisabled();
    // Roster edits stay allowed; a warning hint explains the consequences.
    fireEvent.click(screen.getByRole("button", { name: "repo exists" }));
    expect(
      screen.getByText(/immediately sees everything the group has pushed/),
    ).toBeInTheDocument();
  });

  it("explains the creation grace window on the no-pushes verdict", () => {
    mockApi({
      ...groupsData,
      groups: [
        grp({
          members: [alice, bob],
          repoFullName: "acme/lab1-team-alpha",
          // Pushed 60s after creation, inside the grace window, so the
          // push reads as the starter commit and the verdict must both
          // say "no pushes yet" and carry the hint that explains it.
          repoCreatedAt: "2026-03-11T10:00:00.000Z",
          pushedAt: "2026-03-11T10:01:00.000Z",
        }),
      ],
    });
    render(<TeacherAssignmentPage />);

    expect(screen.getByText("no pushes yet")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "How pushes are counted" }),
    );
    expect(
      screen.getByText(/pushes made more than 2 minutes after/),
    ).toBeInTheDocument();
  });

  it("shows the last commit's author and headline under the push date", () => {
    mockApi({
      ...groupsData,
      groups: [
        grp({
          members: [alice, bob],
          repoFullName: "acme/lab1-team-alpha",
          repoCreatedAt: "2026-03-11T10:00:00.000Z",
          pushedAt: "2026-03-12T10:00:00.000Z",
          lastCommit: {
            login: "alice",
            avatarUrl: "http://a",
            name: "Alice",
            message: "solve exercise 3",
            committedAt: "2026-03-12T10:00:00.000Z",
            commitCount: 4,
          },
        }),
      ],
    });
    render(<TeacherAssignmentPage />);

    expect(screen.getByText("@alice · solve exercise 3")).toBeInTheDocument();
  });

  it("shows the missing-repo badge and offers Unlink when the repo was deleted on GitHub", () => {
    mockApi({
      ...groupsData,
      groups: [
        grp({
          members: [alice, bob],
          repoFullName: "acme/lab1-team-alpha",
          repoStatus: "missing",
        }),
      ],
    });
    render(<TeacherAssignmentPage />);

    // The link still renders (the group still points at that name)...
    expect(
      screen.getByRole("link", { name: /acme\/lab1-team-alpha/ }),
    ).toBeInTheDocument();
    // ...next to a badge explaining it's gone, with the escape hatch.
    fireEvent.click(
      screen.getByRole("button", {
        name: "This repository no longer exists on GitHub",
      }),
    );
    expect(
      screen.getByText("This repository no longer exists on GitHub"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unlink repository" }),
    ).toBeInTheDocument();
  });

  it("shows no missing-repo badge once the repo is confirmed present", () => {
    mockApi({
      ...groupsData,
      groups: [
        grp({
          members: [alice, bob],
          repoFullName: "acme/lab1-team-alpha",
          repoStatus: "ok",
        }),
      ],
    });
    render(<TeacherAssignmentPage />);

    expect(
      screen.queryByRole("button", {
        name: "This repository no longer exists on GitHub",
      }),
    ).not.toBeInTheDocument();
  });

  it("flags members whose GitHub account has no SWITCH identity", () => {
    mockApi({
      ...groupsData,
      groups: [grp({ members: [alice, bob] })],
      // alice signed in with SWITCH and linked GitHub; bob never did.
      users: [
        {
          githubId: "7",
          user: { firstName: "Alice", lastName: "Ok", name: "alice" },
        },
      ],
    });
    render(<TeacherAssignmentPage />);

    // bob carries the info hint, alice doesn't.
    fireEvent.click(
      screen.getByRole("button", { name: "@bob hasn't signed in yet" }),
    );
    expect(
      screen.getByText(/their real name appears here automatically/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "@alice hasn't signed in yet",
      }),
    ).not.toBeInTheDocument();
  });

  it("offers an unplaced teacher in the add-picker but not in the pool", () => {
    mockApi({
      ...groupsData,
      groups: [grp({ members: [bob] })],
      students: [
        ...groupsData.students,
        {
          githubId: "500",
          login: "teach",
          avatarUrl: null,
          state: "teacher",
        },
      ],
    });
    render(<TeacherAssignmentPage />);

    // The strip counts only alice: a teacher is not a missing student.
    expect(
      screen.getByRole("button", { name: "Show the student" }),
    ).toBeInTheDocument();
    // But the picker can (re)place the teacher, tagged as one. Both open
    // seats anchor the same picker; the required one names itself.
    fireEvent.click(screen.getByText("Add member — required to form"));
    expect(screen.getByText("@teach")).toBeInTheDocument();
    expect(screen.getByText("teacher")).toBeInTheDocument();
  });

  it("reveals a member's professional email from the card roster", () => {
    mockApi({
      ...groupsData,
      groups: [grp({ members: [alice] })],
      users: [
        {
          githubId: "7",
          user: {
            firstName: "Alice",
            lastName: "Ok",
            name: "alice",
            email: "alice@heig-vd.ch",
          },
        },
      ],
    });
    render(<TeacherAssignmentPage />);

    expect(screen.queryByText("alice@heig-vd.ch")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show Alice Ok's emails" }),
    );
    expect(screen.getByText("alice@heig-vd.ch")).toBeInTheDocument();
  });

  it("confirms the batch repo creation and says it locks the groups", () => {
    // Team Alpha is complete (2/2) with no repo → 1 missing repository.
    mockApi({ ...groupsData, groups: [grp({ members: [alice, bob] })] });
    render(<TeacherAssignmentPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Create 1 missing repository" }),
    );
    expect(
      screen.getByText("Create the missing repositories?"),
    ).toBeInTheDocument();
    expect(screen.getByText(/locks its group/)).toBeInTheDocument();
  });

  it("confirms the per-row repo creation and says it locks the group", () => {
    // Team Alpha is complete (2/2) with no repo → the row offers creation.
    mockApi({ ...groupsData, groups: [grp({ members: [alice, bob] })] });
    render(<TeacherAssignmentPage />);

    fireEvent.click(screen.getByRole("button", { name: "Create repository" }));
    expect(screen.getByText("Create the work repository?")).toBeInTheDocument();
    expect(
      screen.getByText(/students can no longer join or leave/),
    ).toBeInTheDocument();
  });

  it("hides the pool when every student is placed", () => {
    mockApi({
      ...groupsData,
      groups: [
        {
          id: "g1",
          name: "Team Alpha",
          slug: "team-alpha",
          members: [alice, bob],
        },
      ],
    });
    render(<TeacherAssignmentPage />);
    expect(
      screen.queryByText(/Students without a group/),
    ).not.toBeInTheDocument();
  });

  it("offers clone commands for the groups that have a repo", () => {
    mockApi({
      ...groupsData,
      groups: [
        grp({
          id: "g1",
          members: [alice, bob],
          repoFullName: "acme/lab1-team-alpha",
        }),
        // No repo yet → it contributes no clone line.
        grp({ id: "g2", name: "Team Beta", members: [alice] }),
      ],
    });
    render(<TeacherAssignmentPage />);

    fireEvent.click(screen.getByRole("button", { name: /Clone/ }));

    expect(document.querySelector("pre")?.textContent).toBe(
      "git clone https://github.com/acme/lab1-team-alpha.git",
    );
  });

  it("disables the clone commands when no group has a repo", () => {
    mockApi(groupsData);
    render(<TeacherAssignmentPage />);

    expect(screen.getByRole("button", { name: /Clone/ })).toBeDisabled();
  });

  it("redirects an enrolled STUDENT to the student page", () => {
    // The response's role decides the redirect, with no class list involved.
    mockApi({ ...groupsData, role: "student" });
    render(<TeacherAssignmentPage />);
    expect(screen.getByTestId("navigate")).toHaveTextContent(
      "/classes/c1/assignments/l1",
    );
  });

  it("disables the add-picker once the group is at the assignment's max", () => {
    // maxMembers: 3, and the group is at 3 → the pool has nowhere to go.
    mockApi({
      ...groupsData,
      groups: [grp({ members: [alice, bob, carol] })],
      students: [
        ...groupsData.students,
        { githubId: "9", login: "carol", avatarUrl: null, state: "active" },
        { githubId: "10", login: "dave", avatarUrl: null, state: "active" },
      ],
    });
    render(<TeacherAssignmentPage />);

    // A full group draws no open seat at all, so there is nowhere to add.
    expect(
      screen.queryByRole("button", { name: "Add a member to Team Alpha" }),
    ).not.toBeInTheDocument();
    // A full group is not an over-max group: no warning, only no room.
    expect(
      screen.queryByRole("button", { name: "over max" }),
    ).not.toBeInTheDocument();
  });

  it("flags an oversized group on the card itself", () => {
    // 4 against maxMembers: 3. The card must say so, or the only trace of a
    // lowered maximum is a "4/3" count that reads like a typo.
    mockApi({
      ...groupsData,
      groups: [
        grp({
          members: [
            alice,
            bob,
            carol,
            { id: 10, login: "dave", avatarUrl: null },
          ],
        }),
      ],
    });
    render(<TeacherAssignmentPage />);

    // The count reads "4/3" and spells itself out on hover.
    expect(screen.getByTitle("4 of 3 members")).toHaveTextContent("4/3");
    expect(screen.getByText("over max")).toBeInTheDocument();
    // It is not a STATUS: the lifecycle chip keeps its own meaning.
    expect(screen.getByText("no repo")).toBeInTheDocument();
  });

  it("shows no denominator for an assignment with no maximum", () => {
    // maxMembers: null on a group assignment = uncapped; "2/Infinity members"
    // is what a naive render produces here.
    mockApi({
      ...groupsData,
      assignment: { ...groupAssignment, maxMembers: null },
      groups: [grp({ members: [alice, bob] })],
    });
    render(<TeacherAssignmentPage />);

    // No denominator anywhere: the count is a bare "2".
    expect(screen.getByTitle("2 members")).toHaveTextContent(/^2$/);
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/over max/)).not.toBeInTheDocument();
  });

  it("warns when the assignment's max was lowered below the group's size", () => {
    // 4 members against maxMembers: 3, so the shrink stranded this group.
    mockApi({
      ...groupsData,
      groups: [
        grp({
          members: [
            alice,
            bob,
            carol,
            { id: 10, login: "dave", avatarUrl: null },
          ],
        }),
      ],
    });
    render(<TeacherAssignmentPage />);

    const warning = screen.getByRole("button", { name: "over max" });
    expect(warning).toBeInTheDocument();
    // The popover names the gap and the lever the teacher actually owns.
    fireEvent.click(warning);
    expect(
      screen.getByText("This group has 4 members and the assignment allows 3"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Remove 1 member to fit the assignment/),
    ).toBeInTheDocument();
  });

  it("shows the not-started status and warns before pre-start repo creation", () => {
    mockApi({
      ...groupsData,
      assignment: { ...groupAssignment, startAt: "2099-07-01T08:00:00.000Z" },
      groups: [grp({ members: [alice, bob] })],
    });
    render(<TeacherAssignmentPage />);

    // The header's status word: the timeline's vocabulary, not a banner.
    expect(screen.getByText("Not started")).toBeInTheDocument();
    // The per-row create stays enabled (the escape hatch) but its confirm
    // names the consequence.
    fireEvent.click(screen.getByRole("button", { name: "Create repository" }));
    expect(screen.getByText(/before the start time/)).toBeInTheDocument();
  });

  it("shows the in-progress status and no warning once the assignment has started", () => {
    mockApi({
      ...groupsData,
      assignment: { ...groupAssignment, startAt: "2020-01-01T08:00:00.000Z" },
      groups: [grp({ members: [alice, bob] })],
    });
    render(<TeacherAssignmentPage />);

    expect(screen.queryByText(/not started/i)).not.toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create repository" }));
    expect(screen.queryByText(/before the start time/)).not.toBeInTheDocument();
  });

  it("asks for the assignment's title even when nothing has formed in it", () => {
    // One rule, no branches: the empty assignment is the cheap case to delete,
    // not a cheaper gate. Copying the title out of the dialog is the whole
    // cost.
    mockApi({ ...groupsData, groups: [] });
    render(<TeacherAssignmentPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete this assignment" }),
    );
    expect(
      screen.getByText('Delete "Assignment 1 — Sockets"?'),
    ).toBeInTheDocument();
    expect(screen.getByText(/No groups have formed/)).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "Delete assignment" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Assignment 1 — Sockets" },
    });
    expect(confirm).not.toBeDisabled();
  });

  it("names what an assignment deletion takes and what survives it", () => {
    mockApi({
      ...groupsData,
      groups: [
        grp({ members: [alice, bob], repoFullName: "acme/lab1-team-alpha" }),
      ],
    });
    render(<TeacherAssignmentPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete this assignment" }),
    );
    expect(screen.getByText(/1 group and their GitHub teams/)).toBeVisible();
    expect(screen.getByText(/2 students lose this assignment/)).toBeVisible();
    // The one thing that doesn't go.
    expect(screen.getByText(/1 work repository stay/)).toBeVisible();

    const confirm = screen.getByRole("button", { name: "Delete assignment" });
    expect(confirm).toBeDisabled();
    const phrase = screen.getByRole("textbox");
    fireEvent.change(phrase, { target: { value: "Assignment 1" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(phrase, { target: { value: "Assignment 1 — Sockets" } });
    expect(confirm).not.toBeDisabled();
  });

  it("gates a group deletion on its name, repository or not", () => {
    mockApi({
      ...groupsData,
      groups: [
        grp({ members: [alice, bob], repoFullName: "acme/lab1-team-alpha" }),
      ],
    });
    render(<TeacherAssignmentPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Team Alpha" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete group" }));
    expect(screen.getByText('Delete "Team Alpha"?')).toBeInTheDocument();
    // The repo survives, and the way back to it is spelled out.
    expect(
      screen.getByText(/acme\/lab1-team-alpha stays in the organisation/),
    ).toBeVisible();
    // The route back is the GitHub sync, not the create button: createWorkRepo
    // never adopts an existing repo.
    expect(
      screen.getByText(/GitHub sync offers to link that repository back/),
    ).toBeVisible();

    // Same gate as the assignment's: type the name. (The menu item that opened
    // this is a menuitem, so the only button by this name is the confirm.)
    const confirm = screen.getByRole("button", { name: "Delete group" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Team Alpha" },
    });
    expect(confirm).not.toBeDisabled();
  });

  it("shows a not-found message for an unknown assignment", () => {
    // Unknown assignment (or class, or no access) = a 404 from the one
    // endpoint.
    params.assignmentId = "nope";
    mockApi(
      undefined,
      Object.assign(new Error("GET /api/… failed (404)"), { status: 404 }),
    );
    render(<TeacherAssignmentPage />);
    expect(
      screen.getByText(
        "This assignment doesn't exist (or you don't teach its class).",
      ),
    ).toBeInTheDocument();
  });
});
