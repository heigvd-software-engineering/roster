import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClassCard } from "~/components/custom/classes/class-card";

function renderCard() {
  return render(
    <ClassCard
      login="acme"
      name="Acme"
      avatarUrl="http://a"
      joinToken="tok123"
      students={1}
      teachers={1}
      labs={[]}
    />,
  );
}

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
