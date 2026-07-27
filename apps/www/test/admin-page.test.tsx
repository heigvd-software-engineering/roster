import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { AdminPage } from "~/pages/admin-page";

/**
 * /admin — the page bounces non-admins (display; the API guard is the
 * boundary), filters client-side, and toggles the grant row via PUT.
 */

const authState = vi.hoisted(() => ({ isSuperAdmin: true }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router", () => ({
  useNavigate: () => navigate,
}));

vi.mock("~/contexts/auth-context", () => ({
  useAuth: () => ({
    isLoading: false,
    isSuperAdmin: authState.isSuperAdmin,
  }),
}));

vi.mock("~/contexts/message-context", () => ({
  useMessages: () => ({ push: vi.fn() }),
}));

vi.mock("~/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api")>();
  return { ...actual, useApi: vi.fn() };
});

const users = [
  {
    id: "u1",
    name: "Ada Admin",
    email: "ada@x.ch",
    createdAt: "2026-03-10T00:00:00.000Z",
    isSuperAdmin: true,
    canCreateClasses: false,
  },
  {
    id: "u2",
    name: "Bob Builder",
    email: "bob@y.ch",
    createdAt: "2026-03-10T00:00:00.000Z",
    isSuperAdmin: false,
    canCreateClasses: true,
  },
];

const fetchMock = vi.fn(
  async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
);

describe("AdminPage", () => {
  beforeEach(() => {
    authState.isSuperAdmin = true;
    navigate.mockClear();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(useApi).mockReturnValue({
      data: { users },
      isLoading: false,
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof useApi>);
  });

  it("bounces non-admins to /classes and renders nothing", () => {
    authState.isSuperAdmin = false;
    const { container } = render(<AdminPage />);
    expect(navigate).toHaveBeenCalledWith("/classes", { replace: true });
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every user — admins wear the badge, grants show as checked", () => {
    render(<AdminPage />);
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
    expect(
      screen.getByText("Super admin", { selector: "span" }),
    ).toBeInTheDocument();
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    // Ada is config-admin but holds no grant row — her toggle is OFF.
    expect(switches[0]).toHaveAttribute("aria-checked", "false");
    expect(switches[1]).toHaveAttribute("aria-checked", "true");
  });

  it("filters by name or email as you type", () => {
    render(<AdminPage />);
    fireEvent.change(screen.getByPlaceholderText("Filter by name or email…"), {
      target: { value: "bob@y" },
    });
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
    expect(screen.queryByText("Ada Admin")).not.toBeInTheDocument();
  });

  it("toggling issues the PUT with the desired end state", async () => {
    render(<AdminPage />);
    fireEvent.click(
      screen.getByRole("switch", { name: "Ada Admin can create classes" }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [input, init] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo,
      RequestInit | undefined,
    ];
    const url = typeof input === "string" ? input : input.url;
    const method =
      init?.method ?? (typeof input === "string" ? "GET" : input.method);
    expect(url).toContain("/api/admin/users/u1/class-creator");
    expect(method).toBe("PUT");
  });
});
