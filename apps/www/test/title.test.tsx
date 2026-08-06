import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pageTitle, useDocumentTitle } from "~/lib/title";

describe("pageTitle", () => {
  it("is the app's name on its own with nothing to add", () => {
    expect(pageTitle()).toBe("Roster");
  });

  it("puts the page's words first, the app's name last", () => {
    expect(pageTitle("Lab 3", "PRO")).toBe("Lab 3 · PRO · Roster");
  });

  it("drops the parts a page hasn't loaded yet", () => {
    expect(pageTitle("Assignment", null)).toBe("Assignment · Roster");
    expect(pageTitle(undefined, "")).toBe("Roster");
  });
});

describe("useDocumentTitle", () => {
  function Page({ subject }: { subject?: string }) {
    useDocumentTitle(subject ?? "Assignment", "PRO");
    return null;
  }

  it("titles the tab, and retitles it when the subject arrives", () => {
    const { rerender } = render(<Page />);
    expect(document.title).toBe("Assignment · PRO · Roster");
    rerender(<Page subject="Lab 3" />);
    expect(document.title).toBe("Lab 3 · PRO · Roster");
  });
});
