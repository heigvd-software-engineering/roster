import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewClassDialog } from "~/components/custom/classes/hub/new-class-dialog";

const installUrl = "https://github.com/apps/heigvdlabs/installations/new";
vi.mock("~/contexts/auth-context", () => ({
  useAuth: () => ({ githubAppInstallUrl: installUrl }),
}));

describe("NewClassDialog", () => {
  it("explains the model, then hands off to the install flow", async () => {
    render(<NewClassDialog />);
    fireEvent.click(screen.getByRole("button", { name: "New class" }));

    // The term→meaning mapping.
    expect(await screen.findByText("Class")).toBeInTheDocument();
    expect(screen.getByText("Teachers")).toBeInTheDocument();
    expect(screen.getByText("Students")).toBeInTheDocument();
    expect(screen.getByText("Student work")).toBeInTheDocument();
    // Teachers are invited from within labs (InviteTeacherDialog) — the dialog
    // must point there, not at GitHub's own invite UI.
    expect(
      screen.getByText(/labs sends the Owner invitation/),
    ).toBeInTheDocument();
    // The privacy section: base permission is dropped to No access, keeping
    // student work private — the safety-critical claim must survive.
    expect(screen.getByText("Who can see what")).toBeInTheDocument();
    expect(
      screen.getByText(/keep confidential material private/),
    ).toBeInTheDocument();
    // The install-vs-request tip lives next to the button now.
    expect(
      screen.getByText(/only asks its owners for approval/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Connect an organization" }),
    ).toHaveAttribute("href", installUrl);
  });

  it("does not start the install flow before the dialog is opened", () => {
    render(<NewClassDialog />);
    expect(
      screen.queryByRole("link", { name: "Connect an organization" }),
    ).not.toBeInTheDocument();
  });
});
