import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NewClassDialog } from "~/components/custom/classes/new-class-dialog";
import { githubAppInstallUrl } from "~/lib/config";

describe("NewClassDialog", () => {
  it("explains the model, then hands off to the install flow", async () => {
    render(<NewClassDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Create a new class" }));

    expect(
      await screen.findByText("Class = GitHub organization"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Teachers = organization Owners"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Students = organization Members"),
    ).toBeInTheDocument();
    expect(screen.getByText("One security change")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Connect an organization" }),
    ).toHaveAttribute("href", githubAppInstallUrl);
  });

  it("does not start the install flow before the dialog is opened", () => {
    render(<NewClassDialog />);
    expect(
      screen.queryByRole("link", { name: "Connect an organization" }),
    ).not.toBeInTheDocument();
  });
});
