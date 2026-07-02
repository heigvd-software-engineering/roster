import { describe, expect, it, vi } from "vitest";
import { callerGithubId, isOrgAdmin } from "../src/github/teacher";

vi.mock("../src/github/clients", () => ({
  installationOctokit: vi.fn(async () => ({
    request: vi.fn(async () => ({
      data: [{ id: 111 }, { id: 222 }],
    })),
  })),
}));

function fakeDb(accountId: string | undefined) {
  return {
    query: {
      account: {
        findFirst: async () => (accountId ? { accountId } : undefined),
      },
    },
  } as never;
}

describe("callerGithubId", () => {
  it("parses the stored github account id", async () => {
    expect(await callerGithubId(fakeDb("12345"), "u1")).toBe(12345);
  });
  it("returns null when unlinked or unparsable", async () => {
    expect(await callerGithubId(fakeDb(undefined), "u1")).toBeNull();
    expect(await callerGithubId(fakeDb("not-a-number"), "u1")).toBeNull();
  });
});

describe("isOrgAdmin", () => {
  it("is true iff the caller id is among org admins", async () => {
    const env = {} as never;
    expect(await isOrgAdmin(env, 100, "acme", 111)).toBe(true);
    expect(await isOrgAdmin(env, 100, "acme", 999)).toBe(false);
  });
});
