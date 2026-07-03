import { expect, test } from "vitest";
import { mintJoinToken } from "../src/lib/join-token";

test("mints 32 hex chars, unique per call", () => {
  const a = mintJoinToken();
  expect(a).toMatch(/^[0-9a-f]{32}$/);
  expect(mintJoinToken()).not.toBe(a);
});
