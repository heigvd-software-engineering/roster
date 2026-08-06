import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MainSwitchIdentity } from "~/components/custom/shell/main-switch-identity";

/**
 * The account menu, top-right. These tests OPEN it: the popup only mounts on
 * open, so a rendered-but-never-clicked trigger proves nothing — a menu that
 * throws while building its popup still looks fine until you click it.
 */

const authState = vi.hoisted(() => ({
  github: null as {
    login: string;
    name: string | null;
    avatarUrl: string;
  } | null,
  isSuperAdmin: false,
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router", () => ({ useNavigate: () => navigate }));

vi.mock("~/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { name: "Ada Lovelace", email: "ada@heig-vd.ch" },
    github: authState.github,
    isSuperAdmin: authState.isSuperAdmin,
    signOut: vi.fn(),
    unlinkGithub: vi.fn(),
  }),
}));

vi.mock("~/contexts/theme-context", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

function open() {
  render(<MainSwitchIdentity />);
  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
}

describe("MainSwitchIdentity", () => {
  it("opens the menu with its sections", () => {
    open();

    expect(screen.getByText("Linked GitHub")).toBeInTheDocument();
    expect(screen.getByText("Not linked")).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("offers unlinking once GitHub is linked", () => {
    authState.github = {
      login: "ada",
      name: "Ada L",
      avatarUrl: "https://example.test/a.png",
    };
    open();

    expect(screen.getByText("@ada")).toBeInTheDocument();
    expect(screen.getByText("Unlink GitHub")).toBeInTheDocument();
  });

  it("shows the admin zone only to super admins", () => {
    authState.isSuperAdmin = true;
    open();

    expect(screen.getByText("Super admin")).toBeInTheDocument();
  });
});
