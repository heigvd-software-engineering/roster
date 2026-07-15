import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Hint } from "~/components/custom/hint";

describe("Hint", () => {
  it("hides the message until the icon button is clicked", () => {
    render(
      <Hint variant="warning" label="Roster warning">
        Adding a student grants access to the pushed work.
      </Hint>,
    );

    expect(
      screen.queryByText("Adding a student grants access to the pushed work."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Roster warning" }));
    expect(
      screen.getByText("Adding a student grants access to the pushed work."),
    ).toBeInTheDocument();
  });

  it("shows the optional title above the message", () => {
    render(
      <Hint variant="error" label="Sync problem" title="The sync failed">
        Retry from the toolbar.
      </Hint>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sync problem" }));
    expect(screen.getByText("The sync failed")).toBeInTheDocument();
    expect(screen.getByText("Retry from the toolbar.")).toBeInTheDocument();
  });

  it("renders visible text that names the button", () => {
    render(
      <Hint variant="warning" text="Important">
        Read this before editing.
      </Hint>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Important" }));
    expect(screen.getByText("Read this before editing.")).toBeInTheDocument();
  });

  it("labels the button per variant when no label is given", () => {
    render(<Hint>Plain background info.</Hint>);

    expect(
      screen.getByRole("button", { name: "More information" }),
    ).toBeInTheDocument();
  });
});
