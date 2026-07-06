import { render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { LabPage } from "~/pages/lab-page";

const params = vi.hoisted(() => ({ classId: "c1", labId: "l1" }));

vi.mock("react-router", () => ({
  useParams: () => params,
  Link: ({ to, children, ...props }: PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
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
const individualLab = {
  ...groupLab,
  id: "l2",
  title: "Lab 2 — Solo",
  groupMode: "individual",
  minMembers: null,
  maxMembers: null,
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
  labs: [groupLab, individualLab],
};
const enrolledClass = {
  id: "c1",
  createdAt: "2026-03-10T00:00:00.000Z",
  login: "acme",
  name: "Acme",
  avatarUrl: null,
  state: "active",
  teachers: [],
  labs: [groupLab, individualLab],
};

/** classes fetch (no args) vs lab-groups fetch (args) — route by args. */
function mockApi(classesData: unknown, labGroupsData: unknown) {
  vi.mocked(useApi).mockImplementation(
    (_endpoint, args) =>
      ({
        data: args === undefined ? classesData : labGroupsData,
        mutate: vi.fn(),
      }) as unknown as ReturnType<typeof useApi>,
  );
}

const groupsData = (
  over?: Partial<{ groups: unknown[]; attachedIds: string[] }>,
) => ({
  groups: [
    { id: "g1", name: "Team Alpha", slug: "team-alpha", members: [bob] },
    { id: "g2", name: "Team Beta", slug: "team-beta", members: [alice] },
  ],
  users: [],
  attachedIds: ["g1"],
  ...over,
});

beforeEach(() => {
  params.classId = "c1";
  params.labId = "l1";
});

describe("LabPage — teacher, group lab", () => {
  it("shows the header, the without-a-group pool, and management", () => {
    mockApi({ classes: [teachingClass], enrolled: [] }, groupsData());
    render(<LabPage />);

    expect(screen.getByText("Lab 1 — Sockets")).toBeInTheDocument();
    expect(screen.getByText("group 2–3")).toBeInTheDocument();
    expect(screen.getByText("teaching")).toBeInTheDocument();
    // alice is in NO attached group (g2 isn't attached) → she's in the pool.
    expect(
      screen.getByText(/Students without a group for this lab/),
    ).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    // Attached group tile + teacher management affordances.
    expect(screen.getByText("Team Alpha")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Detach Team Alpha from this lab" }),
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
});

describe("LabPage — student, group lab", () => {
  it("offers Join on an open attached group and the accept ghosts", () => {
    mockApi({ classes: [], enrolled: [enrolledClass] }, groupsData());
    render(<LabPage />);

    expect(screen.getByText("enrolled")).toBeInTheDocument();
    // alice is NOT in attached g1 → Join is open (room under max 3).
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
    // g2 (hers, unattached) is an accept candidate; creating also offered.
    expect(
      screen.getByRole("button", { name: "+ Accept with one of your groups" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Accept with a new group" }),
    ).toBeInTheDocument();
    // No teacher affordances, no pool.
    expect(
      screen.queryByText(/Students without a group/),
    ).not.toBeInTheDocument();
  });

  it("collapses accept affordances once participating", () => {
    mockApi(
      { classes: [], enrolled: [enrolledClass] },
      groupsData({
        groups: [
          {
            id: "g1",
            name: "Team Alpha",
            slug: "team-alpha",
            members: [alice, bob],
          },
        ],
        attachedIds: ["g1"],
      }),
    );
    render(<LabPage />);

    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Accept with/ }),
    ).not.toBeInTheDocument();
  });
});

describe("LabPage — student, individual lab", () => {
  it("is one-click: Accept lab, no group machinery", () => {
    params.labId = "l2";
    mockApi(
      { classes: [], enrolled: [enrolledClass] },
      groupsData({ groups: [], attachedIds: [] }),
    );
    render(<LabPage />);

    expect(
      screen.getByRole("button", { name: "Accept lab" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Participating groups")).not.toBeInTheDocument();
  });

  it("shows Accepted + Withdraw once the solo group participates", () => {
    params.labId = "l2";
    mockApi(
      { classes: [], enrolled: [enrolledClass] },
      groupsData({
        groups: [
          { id: "solo", name: "alice", slug: "alice", members: [alice] },
        ],
        attachedIds: ["solo"],
      }),
    );
    render(<LabPage />);

    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Withdraw" }),
    ).toBeInTheDocument();
  });
});

describe("LabPage — edges", () => {
  it("gates a pending enrollee", () => {
    mockApi(
      { classes: [], enrolled: [{ ...enrolledClass, state: "pending" }] },
      groupsData(),
    );
    render(<LabPage />);
    expect(
      screen.getByText(/Accept your invitation on GitHub first/),
    ).toBeInTheDocument();
  });

  it("shows a not-found message for an unknown lab", () => {
    params.labId = "nope";
    mockApi({ classes: [teachingClass], enrolled: [] }, groupsData());
    render(<LabPage />);
    expect(
      screen.getByText("This lab doesn't exist (or you're not in its class)."),
    ).toBeInTheDocument();
  });
});
