import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ConnectedAssistants,
  RevokeAssistantDialog,
} from "~/components/custom/oauth/connected-assistants";
import { scopeSummary } from "~/components/custom/oauth/consent-scope";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/**
 * The Connected assistants group and its confirm gate. The group renders
 * inside a real DropdownMenu (its items need the menu context, and a popup
 * that throws still looks fine until opened — same rule as the account menu's
 * own tests). The gate is the real ConfirmDialog: what these tests hold is
 * that nothing is deleted before the confirm click, which is the whole point
 * of the 2026-08-31 reversal.
 */

type Assistant = {
  id: string;
  name: string | null;
  scopes: string[];
  createdAt: string;
};

const apiState = vi.hoisted(() => ({
  response: {
    data: undefined as { assistants: Assistant[] } | undefined,
    error: undefined as Error | undefined,
    isLoading: false,
  },
}));
const deleteConsent = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("~/lib/api", () => ({
  api: { api: { assistants: {} } },
  useApi: () => apiState.response,
}));
vi.mock("~/lib/auth", () => ({ oauth2: { deleteConsent } }));

const grant = (over: Partial<Assistant> = {}): Assistant => ({
  id: "consent-1",
  name: "Claude Code",
  scopes: ["roster:read"],
  createdAt: "2026-08-28T10:00:00.000Z",
  ...over,
});

function openMenu() {
  const onRevoke = vi.fn();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <ConnectedAssistants onRevoke={onRevoke} />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  fireEvent.click(screen.getByText("open"));
  return onRevoke;
}

describe("ConnectedAssistants", () => {
  it("renders a grant as name, what it may do, and since when", () => {
    apiState.response = {
      data: { assistants: [grant()] },
      error: undefined,
      isLoading: false,
    };
    openMenu();

    expect(screen.getByText("Connected assistants")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(
      screen.getByText("Reads your classes · since 28 Aug 2026"),
    ).toBeInTheDocument();
  });

  it("a nameless client is 'An assistant', never a blank", () => {
    apiState.response = {
      data: { assistants: [grant({ name: null })] },
      error: undefined,
      isLoading: false,
    };
    openMenu();

    expect(screen.getByText("An assistant")).toBeInTheDocument();
  });

  it("an unrecognised scope is shown, never dropped", () => {
    apiState.response = {
      data: {
        assistants: [grant({ scopes: ["roster:read", "roster:admin"] })],
      },
      error: undefined,
      isLoading: false,
    };
    openMenu();

    expect(
      screen.getByText(/a permission roster doesn't recognise/i),
    ).toBeInTheDocument();
    expect(screen.getByText("roster:admin")).toBeInTheDocument();
  });

  it("revoke only names the target — nothing is deleted from the menu", () => {
    apiState.response = {
      data: { assistants: [grant()] },
      error: undefined,
      isLoading: false,
    };
    const onRevoke = openMenu();

    fireEvent.click(screen.getByText("Revoke access"));

    expect(onRevoke).toHaveBeenCalledWith({
      id: "consent-1",
      name: "Claude Code",
    });
    expect(deleteConsent).not.toHaveBeenCalled();
  });

  it("says so in words while loading, when empty, and on failure", () => {
    apiState.response = { data: undefined, error: undefined, isLoading: true };
    openMenu();
    expect(screen.getByText("Loading assistants…")).toBeInTheDocument();
  });

  it("empty is 'None connected'", () => {
    apiState.response = {
      data: { assistants: [] },
      error: undefined,
      isLoading: false,
    };
    openMenu();
    expect(screen.getByText("None connected")).toBeInTheDocument();
  });

  it("failure stays quiet and in place", () => {
    apiState.response = {
      data: undefined,
      error: new Error("boom"),
      isLoading: false,
    };
    openMenu();
    expect(screen.getByText(/Couldn't load assistants/)).toBeInTheDocument();
  });
});

describe("RevokeAssistantDialog", () => {
  it("names its target, and 'this assistant' when the client sent no name", () => {
    const { rerender } = render(
      <RevokeAssistantDialog
        target={{ id: "c1", name: "Claude Code" }}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Revoke access for Claude Code?"),
    ).toBeInTheDocument();

    rerender(
      <RevokeAssistantDialog
        target={{ id: "c1", name: null }}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Revoke access for this assistant?"),
    ).toBeInTheDocument();
  });

  it("cancel closes without deleting anything", () => {
    deleteConsent.mockClear();
    const onClose = vi.fn();
    render(
      <RevokeAssistantDialog
        target={{ id: "c1", name: "Claude Code" }}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteConsent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("only the confirm click deletes the grant, then the dialog closes", async () => {
    deleteConsent.mockClear();
    const onClose = vi.fn();
    render(
      <RevokeAssistantDialog
        target={{ id: "c1", name: "Claude Code" }}
        onClose={onClose}
      />,
    );

    expect(deleteConsent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));

    await waitFor(() => {
      expect(deleteConsent).toHaveBeenCalledWith({ id: "c1" });
      expect(onClose).toHaveBeenCalled();
    });
  });
});

describe("scopeSummary", () => {
  it("joins known scopes into one sentence, capitalized once", () => {
    expect(scopeSummary(["roster:read", "roster:write"])).toEqual({
      sentence: "Reads your classes · creates missing work repositories",
      unknown: [],
    });
  });

  it("passes unknown scopes through for destructive rendering", () => {
    expect(scopeSummary(["roster:admin"])).toEqual({
      sentence: null,
      unknown: ["roster:admin"],
    });
  });
});
