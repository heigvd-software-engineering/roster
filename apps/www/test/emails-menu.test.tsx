import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmailsMenu } from "~/components/custom/identity/emails-menu";

describe("EmailsMenu", () => {
  it("opens a floating menu showing the email", () => {
    render(<EmailsMenu name="Alice" email="alice@heig-vd.ch" />);

    expect(screen.queryByText("alice@heig-vd.ch")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show Alice's emails" }),
    );
    expect(screen.getByText("alice@heig-vd.ch")).toBeInTheDocument();
  });

  it("renders nothing when there is no email", () => {
    const { container } = render(<EmailsMenu name="Bob" email={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
