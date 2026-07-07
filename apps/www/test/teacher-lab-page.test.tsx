import { render, screen } from "@testing-library/react";
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

const groupsData = {
  groups: [
    { id: "g1", name: "Team Alpha", slug: "team-alpha", members: [bob] },
    { id: "g2", name: "Team Beta", slug: "team-beta", members: [] },
  ],
  users: [],
  // The pool source: the class_members cache riding on the response.
  students: [
    { githubId: "7", login: "alice", avatarUrl: "http://a" },
    { githubId: "8", login: "bob", avatarUrl: null },
  ],
  attached: [{ groupId: "g1", repoFullName: null }],
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
    // alice is in NO attached group → she's in the pool.
    expect(
      screen.getByText(/Students without a group for this lab/),
    ).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    // Management on the attached tile + the attach/create ghosts.
    expect(
      screen.getByRole("button", { name: "Detach Team Alpha from this lab" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add a member to Team Alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Attach a group" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ New group" }),
    ).toBeInTheDocument();
    // Teachers never join/leave.
    expect(
      screen.queryByRole("button", { name: "Join" }),
    ).not.toBeInTheDocument();
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
