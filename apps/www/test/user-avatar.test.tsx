import { describe, expect, it } from "vitest";
import { initials } from "~/components/custom/identity/user-avatar";

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Stefan Teofanovic")).toBe("ST");
  });

  it("uses a single letter for a one-word name", () => {
    expect(initials("Alice")).toBe("A");
  });

  it("falls back to '?' for a whitespace-only name", () => {
    expect(initials("  ")).toBe("?");
  });

  it("ignores words beyond the first two", () => {
    expect(initials("jean marc du pont")).toBe("JM");
  });
});
