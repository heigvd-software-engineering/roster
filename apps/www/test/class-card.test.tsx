import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClassCard } from "~/components/custom/classes/class-card";

const profUser = {
  id: "u1",
  name: "Bob Prof",
  firstName: "Bob",
  lastName: "Prof",
  email: "bob@heig-vd.ch",
  emailVerified: true,
  image: null,
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

function renderCard() {
  return render(
    <ClassCard
      id="c1"
      orgId={42}
      login="acme"
      name="Acme"
      avatarUrl="http://a"
      joinToken="tok123"
      teachers={[{ id: 1, login: "prof", avatarUrl: "http://p" }]}
      students={[{ id: 2, login: "alice", avatarUrl: "http://s" }]}
      pending={[{ id: 900, login: "bob", avatarUrl: null }]}
      users={[{ githubId: "1", user: profUser }]}
      labs={[]}
    />,
  );
}

describe("ClassCard people chips", () => {
  it("shows live counts with the pending suffix", () => {
    renderCard();
    expect(screen.getByText("1 student · 1 pending")).toBeInTheDocument();
    expect(screen.getByText("1 teacher")).toBeInTheDocument();
  });
});

describe("ClassCard org identity", () => {
  it("links to the GitHub org page", () => {
    renderCard();
    expect(screen.getByRole("link", { name: /@acme/ })).toHaveAttribute(
      "href",
      "https://github.com/acme",
    );
  });
});

describe("ClassCard copy join link", () => {
  it("copies the join URL and confirms inline", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Copy join link" }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join/tok123`,
    );
    expect(
      await screen.findByRole("button", { name: "Copied ✓" }),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
