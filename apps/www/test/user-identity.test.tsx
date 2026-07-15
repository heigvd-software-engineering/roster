import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserIdentity } from "~/components/custom/identity/user-identity";

/** The avatar's rendered size token. */
const avatarSize = () =>
  document.querySelector('[data-slot="avatar"]')?.getAttribute("data-size");

describe("UserIdentity", () => {
  it("prefixes a handle with @ and sets it in mono", () => {
    render(<UserIdentity name="Alice Dupont" handle="alice" />);

    expect(screen.getByText("Alice Dupont")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toHaveClass("font-mono");
  });

  it("prints a subtitle verbatim, in prose", () => {
    render(<UserIdentity name="Stefan" subtitle="stefan@heig-vd.ch" />);

    const subtitle = screen.getByText("stefan@heig-vd.ch");
    expect(subtitle).toBeInTheDocument();
    // An email is prose, not an identifier.
    expect(subtitle).not.toHaveClass("font-mono");
  });

  it("shows the name alone when there is no second line", () => {
    render(<UserIdentity name="Alice Dupont" />);

    expect(screen.getByText("Alice Dupont")).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("is small by default and large on request", () => {
    const { unmount } = render(<UserIdentity name="Alice" handle="alice" />);
    expect(avatarSize()).toBe("sm");
    unmount();

    render(<UserIdentity name="Alice" handle="alice" size="lg" />);
    expect(avatarSize()).toBe("lg");
  });

  it("renders nothing interactive — pure display", () => {
    render(<UserIdentity name="Alice" handle="alice" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
