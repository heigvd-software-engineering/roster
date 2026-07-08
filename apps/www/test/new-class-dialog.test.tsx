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

    expect(
      await screen.findByText("Class = GitHub organization"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Teachers = organization Owners"),
    ).toBeInTheDocument();
    // labs has no promote button and never will — every teacher check is a live
    // isOrgAdmin call. The dialog is the only place that says where to go.
    expect(
      screen.getByText(/promote them to Owner — labs never changes roles/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Students = organization Members"),
    ).toBeInTheDocument();
    expect(screen.getByText("One security change")).toBeInTheDocument();
    expect(
      screen.getByText("Students never see each other's work"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Your existing repositories stay hidden"),
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
