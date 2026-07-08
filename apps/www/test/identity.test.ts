import { describe, expect, it } from "vitest";
import { personIdentity } from "~/lib/identity";

const alice = { login: "alice", avatarUrl: "https://gh/alice.png" };
const linked = { firstName: "Alice", lastName: "Dupont", name: "alice-gh" };

describe("personIdentity", () => {
  it("names a linked person by their SWITCH identity, with no photo", () => {
    // edu-ID carries no picture — the avatar falls back to initials.
    expect(personIdentity(alice, linked)).toEqual({
      name: "Alice Dupont",
      handle: "alice",
      avatarUrl: null,
    });
  });

  it("names an unlinked person by their GitHub login, with their photo", () => {
    // GitHub is the only identity we have — so it's the one we show.
    expect(personIdentity(alice, undefined)).toEqual({
      name: "alice",
      handle: "alice",
      avatarUrl: "https://gh/alice.png",
    });
  });

  it("falls back to the profile name when SWITCH has no real name", () => {
    expect(
      personIdentity(alice, { firstName: null, lastName: null, name: "A. D." }),
    ).toEqual({ name: "A. D.", handle: "alice", avatarUrl: null });
  });

  it("survives a person with no GitHub login", () => {
    expect(personIdentity({ login: null, avatarUrl: null }, undefined)).toEqual(
      {
        name: "unknown",
        handle: "unknown",
        avatarUrl: null,
      },
    );
  });
});
