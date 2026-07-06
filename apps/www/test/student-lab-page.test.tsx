import { render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { StudentLabPage } from "~/pages/student-lab-page";

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
  // The pool source: the class_members cache riding on the response.
  students: [
    { githubId: "7", login: "alice", avatarUrl: "http://a" },
    { githubId: "8", login: "bob", avatarUrl: null },
  ],
  attachedIds: ["g1"],
  ...over,
});

beforeEach(() => {
  params.classId = "c1";
  params.labId = "l1";
});

describe("StudentLabPage — group lab", () => {
  it("offers Join on an open attached group and the accept ghosts", () => {
    mockApi({ classes: [], enrolled: [enrolledClass] }, groupsData());
    render(<StudentLabPage />);

    expect(screen.getByText("enrolled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Accept with one of your groups" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Accept with a new group" }),
    ).toBeInTheDocument();
    // Students see the pool too — it helps them organize (alice is in no
    // attached group yet). Management stays teacher-only.
    expect(
      screen.getByText(/Students without a group for this lab/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Detach/ }),
    ).not.toBeInTheDocument();
  });

  it("collapses accept affordances once participating; own group marked", () => {
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
    render(<StudentLabPage />);

    expect(screen.getByText("your group")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Accept with/ }),
    ).not.toBeInTheDocument();
    // Everyone's placed → the pool disappears.
    expect(
      screen.queryByText(/Students without a group/),
    ).not.toBeInTheDocument();
  });
});

describe("StudentLabPage — individual lab", () => {
  it("is one-click: Accept lab, no group machinery", () => {
    params.labId = "l2";
    mockApi(
      { classes: [], enrolled: [enrolledClass] },
      groupsData({ groups: [], attachedIds: [] }),
    );
    render(<StudentLabPage />);

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
    render(<StudentLabPage />);

    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Withdraw" }),
    ).toBeInTheDocument();
  });
});

describe("StudentLabPage — edges", () => {
  it("gates a pending enrollee", () => {
    mockApi(
      { classes: [], enrolled: [{ ...enrolledClass, state: "pending" }] },
      groupsData(),
    );
    render(<StudentLabPage />);
    expect(
      screen.getByText(/Accept your invitation on GitHub first/),
    ).toBeInTheDocument();
  });

  it("redirects a TEACHER to the manage page", () => {
    mockApi({ classes: [{ id: "c1", labs: [] }], enrolled: [] }, groupsData());
    render(<StudentLabPage />);
    expect(screen.getByTestId("navigate")).toHaveTextContent(
      "/classes/c1/labs/l1/manage",
    );
  });

  it("shows a not-found message for an unknown lab", () => {
    params.labId = "nope";
    mockApi({ classes: [], enrolled: [enrolledClass] }, groupsData());
    render(<StudentLabPage />);
    expect(
      screen.getByText("This lab doesn't exist (or you're not in its class)."),
    ).toBeInTheDocument();
  });
});
