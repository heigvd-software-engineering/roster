import { fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { TeacherLabPage } from "~/pages/teacher-lab-page";

const params = vi.hoisted(() => ({ classId: "c1", labId: "l1" }));

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

const groupLab = {
  id: "l1",
  classId: "c1",
  title: "Lab 1 — Sockets",
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

/** The page is ONE request now — a single groups response (or its error). */
function mockApi(labGroupsData: unknown, error?: unknown) {
  vi.mocked(useApi).mockImplementation(
    () =>
      ({
        data: labGroupsData,
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
  ...over,
});

const groupsData = {
  // The header data rides on the groups response (merged endpoint).
  lab: groupLab,
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
  params.labId = "l1";
});

describe("TeacherLabPage", () => {
  it("shows the header, the without-a-group pool, and management", () => {
    mockApi(groupsData);
    render(<TeacherLabPage />);

    expect(screen.getByText("Lab 1 — Sockets")).toBeInTheDocument();
    expect(screen.getByText("teaching")).toBeInTheDocument();
    // alice is in NO group of this lab → she's in the pool.
    expect(
      screen.getByText(/Students without a group for this lab/),
    ).toBeInTheDocument();
    // The pool collapses at every size — the names are one click away.
    // alice is GitHub-only here → named by her login, shown as a @handle.
    fireEvent.click(screen.getByRole("button", { name: "Show the student" }));
    expect(screen.getByText("@alice")).toBeInTheDocument();
    // The roster: Team Alpha with 1/2 members → under min.
    expect(screen.getByText("Team Alpha")).toBeInTheDocument();
    expect(screen.getByText("under min")).toBeInTheDocument();
    // Toolbar: create a group for THIS lab (no attach — groups are per-lab).
    expect(
      screen.getByRole("button", { name: "+ New group" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Attach a group" }),
    ).not.toBeInTheDocument();
    // Management is one click deep: the row's drawer.
    fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
    expect(
      screen.getByRole("button", { name: "Delete group" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add from the pool/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove bob from Team Alpha" }),
    ).toBeInTheDocument();
    // Teachers never join/leave.
    expect(
      screen.queryByRole("button", { name: "Join" }),
    ).not.toBeInTheDocument();
    // No repo yet → roster edits carry no warning.
    expect(
      screen.queryByRole("button", {
        name: "repo exists",
      }),
    ).not.toBeInTheDocument();
  });

  it("links the repo and disables delete once the work repo exists", () => {
    mockApi({
      ...groupsData,
      groups: [
        grp({ members: [alice, bob], repoFullName: "acme/lab1-team-alpha" }),
      ],
    });
    render(<TeacherLabPage />);

    // The repo exists → the row links it and the drawer refuses delete.
    expect(
      screen.getByRole("link", { name: /acme\/lab1-team-alpha/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
    expect(screen.getByRole("button", { name: "Delete group" })).toBeDisabled();
    // Roster edits stay allowed — a warning hint explains the consequences.
    fireEvent.click(
      screen.getByRole("button", {
        name: "repo exists",
      }),
    );
    expect(
      screen.getByText(/immediately sees everything the group has pushed/),
    ).toBeInTheDocument();
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
    render(<TeacherLabPage />);

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
    render(<TeacherLabPage />);

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
    render(<TeacherLabPage />);

    fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
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
    render(<TeacherLabPage />);

    // The strip counts only alice — a teacher is not a missing student.
    expect(
      screen.getByRole("button", { name: "Show the student" }),
    ).toBeInTheDocument();
    // But the picker can (re)place the teacher, tagged as one.
    fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Add from the pool \(2\)/ }),
    );
    expect(screen.getByText("@teach")).toBeInTheDocument();
    expect(screen.getByText("teacher")).toBeInTheDocument();
  });

  it("reveals a member's affiliation emails from the drawer roster", () => {
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
            affiliations: ["alice@heig-vd.ch"],
          },
        },
      ],
    });
    render(<TeacherLabPage />);

    fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
    expect(screen.queryByText("alice@heig-vd.ch")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show Alice Ok's emails" }),
    );
    expect(screen.getByText("alice@heig-vd.ch")).toBeInTheDocument();
  });

  it("confirms the batch repo creation and says it locks the groups", () => {
    // Team Alpha is complete (2/2) with no repo → 1 missing repository.
    mockApi({ ...groupsData, groups: [grp({ members: [alice, bob] })] });
    render(<TeacherLabPage />);

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
    render(<TeacherLabPage />);

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
    render(<TeacherLabPage />);
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
    render(<TeacherLabPage />);

    fireEvent.click(screen.getByRole("button", { name: /Clone/ }));

    expect(document.querySelector("pre")?.textContent).toBe(
      "git clone https://github.com/acme/lab1-team-alpha.git",
    );
  });

  it("disables the clone commands when no group has a repo", () => {
    mockApi(groupsData);
    render(<TeacherLabPage />);

    expect(screen.getByRole("button", { name: /Clone/ })).toBeDisabled();
  });

  it("redirects an enrolled STUDENT to the student page", () => {
    // The response's role decides the redirect — no class list involved.
    mockApi({ ...groupsData, role: "student" });
    render(<TeacherLabPage />);
    expect(screen.getByTestId("navigate")).toHaveTextContent(
      "/classes/c1/labs/l1",
    );
  });

  // --- the lab's max size, seen from the roster ---

  it("disables the add-picker once the group is at the lab's max", () => {
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
    render(<TeacherLabPage />);

    fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
    expect(
      screen.getByRole("button", { name: /Add from the pool/ }),
    ).toBeDisabled();
    // A full group is not an over-max group — no warning, just no room.
    expect(
      screen.queryByRole("button", { name: "over the lab max" }),
    ).not.toBeInTheDocument();
  });

  it("flags an oversized group on the row itself, without opening the drawer", () => {
    // 4 against maxMembers: 3 — the row must say so, or a teacher who just
    // shrank the lab has to open every drawer to find who is stranded.
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
    render(<TeacherLabPage />);

    expect(screen.getByText(/4\/3 members/)).toBeInTheDocument();
    expect(screen.getByText(/1 over max/)).toBeInTheDocument();
    // It is not a STATUS: the lifecycle chip keeps its own meaning.
    expect(screen.getByText("no repo")).toBeInTheDocument();
  });

  it("shows no denominator for a lab with no maximum", () => {
    // maxMembers: null on a group lab = uncapped — "2/Infinity members" is
    // what a naive render produces here.
    mockApi({
      ...groupsData,
      lab: { ...groupLab, maxMembers: null },
      groups: [grp({ members: [alice, bob] })],
    });
    render(<TeacherLabPage />);

    expect(screen.getByText(/2 members/)).toBeInTheDocument();
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/over max/)).not.toBeInTheDocument();
  });

  it("warns when the lab's max was lowered below the group's size", () => {
    // 4 members against maxMembers: 3 — the shrink stranded this group.
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
    render(<TeacherLabPage />);

    fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
    const warning = screen.getByRole("button", { name: "over the lab max" });
    expect(warning).toBeInTheDocument();
    // The popover names the gap and the lever the teacher actually owns.
    fireEvent.click(warning);
    expect(
      screen.getByText("This group has 4 members and the lab allows 3"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Remove 1 member to fit the lab/),
    ).toBeInTheDocument();
  });

  it("shows the not-started status and warns before pre-start repo creation", () => {
    mockApi({
      ...groupsData,
      lab: { ...groupLab, startAt: "2099-07-01T08:00:00.000Z" },
      groups: [grp({ members: [alice, bob] })],
    });
    render(<TeacherLabPage />);

    // The header's status word — the timeline's vocabulary, not a banner.
    expect(screen.getByText("not started")).toBeInTheDocument();
    // The per-row create stays ENABLED (the escape hatch) but its confirm
    // names the consequence.
    fireEvent.click(screen.getByRole("button", { name: "Create repository" }));
    expect(screen.getByText(/before the start time/)).toBeInTheDocument();
  });

  it("shows the in-progress status and no warning once the lab has started", () => {
    mockApi({
      ...groupsData,
      lab: { ...groupLab, startAt: "2020-01-01T08:00:00.000Z" },
      groups: [grp({ members: [alice, bob] })],
    });
    render(<TeacherLabPage />);

    expect(screen.queryByText(/not started/i)).not.toBeInTheDocument();
    expect(screen.getByText("in progress")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create repository" }));
    expect(screen.queryByText(/before the start time/)).not.toBeInTheDocument();
  });

  it("shows a not-found message for an unknown lab", () => {
    // Unknown lab (or class, or no access) = a 404 from the one endpoint.
    params.labId = "nope";
    mockApi(
      undefined,
      Object.assign(new Error("GET /api/… failed (404)"), { status: 404 }),
    );
    render(<TeacherLabPage />);
    expect(
      screen.getByText(
        "This lab doesn't exist (or you don't teach its class).",
      ),
    ).toBeInTheDocument();
  });
});
