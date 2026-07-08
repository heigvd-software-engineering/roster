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

const teachingClass = {
  id: "c1",
  orgId: 1,
  createdAt: "2026-03-10T00:00:00.000Z",
  login: "acme",
  name: "Acme",
  avatarUrl: "",
  joinToken: "tok",
  teachers: [{ id: 111, login: "prof", avatarUrl: null }],
  students: [alice, bob],
  pending: [],
  users: [],
  labs: [groupLab],
};

function mockApi(classesData: unknown, labGroupsData: unknown) {
  vi.mocked(useApi).mockImplementation(
    (_endpoint, args) =>
      ({
        data: args === undefined ? classesData : labGroupsData,
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
  groups: [grp({ members: [bob] })],
  users: [],
  // The pool source: the class_members cache riding on the response.
  students: [
    { githubId: "7", login: "alice", avatarUrl: "http://a" },
    { githubId: "8", login: "bob", avatarUrl: null },
  ],
};

beforeEach(() => {
  params.classId = "c1";
  params.labId = "l1";
});

describe("TeacherLabPage", () => {
  it("shows the header, the without-a-group pool, and management", () => {
    mockApi({ classes: [teachingClass], enrolled: [] }, groupsData);
    render(<TeacherLabPage />);

    expect(screen.getByText("Lab 1 — Sockets")).toBeInTheDocument();
    expect(screen.getByText("teaching")).toBeInTheDocument();
    // alice is in NO group of this lab → she's in the pool.
    expect(
      screen.getByText(/Students without a group for this lab/),
    ).toBeInTheDocument();
    // The pool collapses at every size — the names are one click away.
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
  });

  it("links the repo and disables delete once the work repo exists", () => {
    mockApi(
      { classes: [teachingClass], enrolled: [] },
      {
        ...groupsData,
        groups: [
          grp({ members: [alice, bob], repoFullName: "acme/lab1-team-alpha" }),
        ],
      },
    );
    render(<TeacherLabPage />);

    // The repo exists → the row links it and the drawer refuses delete.
    expect(
      screen.getByRole("link", { name: /acme\/lab1-team-alpha/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
    expect(screen.getByRole("button", { name: "Delete group" })).toBeDisabled();
  });

  it("hides the pool when every student is placed", () => {
    mockApi(
      { classes: [teachingClass], enrolled: [] },
      {
        ...groupsData,
        groups: [
          {
            id: "g1",
            name: "Team Alpha",
            slug: "team-alpha",
            members: [alice, bob],
          },
        ],
      },
    );
    render(<TeacherLabPage />);
    expect(
      screen.queryByText(/Students without a group/),
    ).not.toBeInTheDocument();
  });

  it("offers clone commands for the groups that have a repo", () => {
    mockApi(
      { classes: [teachingClass], enrolled: [] },
      {
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
      },
    );
    render(<TeacherLabPage />);

    fireEvent.click(screen.getByRole("button", { name: "More lab actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Clone/ }));

    expect(document.querySelector("pre")?.textContent).toBe(
      "git clone https://github.com/acme/lab1-team-alpha.git",
    );
  });

  it("disables the clone commands when no group has a repo", () => {
    mockApi({ classes: [teachingClass], enrolled: [] }, groupsData);
    render(<TeacherLabPage />);

    fireEvent.click(screen.getByRole("button", { name: "More lab actions" }));
    expect(screen.getByRole("menuitem", { name: /Clone/ })).toHaveAttribute(
      "data-disabled",
    );
  });

  it("redirects an enrolled STUDENT to the student page", () => {
    mockApi(
      { classes: [], enrolled: [{ id: "c1", state: "active", labs: [] }] },
      groupsData,
    );
    render(<TeacherLabPage />);
    expect(screen.getByTestId("navigate")).toHaveTextContent(
      "/classes/c1/labs/l1",
    );
  });

  it("shows a not-found message for an unknown lab", () => {
    params.labId = "nope";
    mockApi({ classes: [teachingClass], enrolled: [] }, groupsData);
    render(<TeacherLabPage />);
    expect(
      screen.getByText(
        "This lab doesn't exist (or you don't teach its class).",
      ),
    ).toBeInTheDocument();
  });
});
