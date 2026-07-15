import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmailsMenu } from "~/components/custom/identity/emails-menu";

describe("EmailsMenu", () => {
  it("opens a floating menu listing the emails", () => {
    render(
      <EmailsMenu
        name="Alice"
        emails={["alice@heig-vd.ch", "alice@unil.ch"]}
      />,
    );

    expect(screen.queryByText("alice@heig-vd.ch")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show Alice's emails" }),
    );
    expect(screen.getByText("alice@heig-vd.ch")).toBeInTheDocument();
    expect(screen.getByText("alice@unil.ch")).toBeInTheDocument();
  });

  it("renders nothing when there are no emails", () => {
    const { container } = render(<EmailsMenu name="Bob" emails={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
