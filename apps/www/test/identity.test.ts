import { describe, expect, it } from "vitest";
import { personIdentity } from "~/lib/identity";

const gh = { login: "alice", avatarUrl: "https://gh/alice.png" };
const edu = { firstName: "Alice", lastName: "Dupont", name: "alice-gh" };

describe("personIdentity — three states", () => {
  it("① fully linked: SWITCH name, initials, @login, affiliations", () => {
    expect(
      personIdentity(gh, { ...edu, affiliations: ["a@heig-vd.ch"] }),
    ).toEqual({
      name: "Alice Dupont",
      handle: "alice",
      avatarUrl: null,
      emails: ["a@heig-vd.ch"],
    });
  });

  it("② GitHub only: login as the name, photo, a 'not linked' note", () => {
    const p = personIdentity(gh, undefined);
    expect(p).toEqual({
      name: "alice",
      nameIsLogin: true,
      subtitle: "not linked to edu-ID",
      avatarUrl: "https://gh/alice.png",
      emails: [],
    });
    // The login is the name; there's no @handle line to double it.
    expect(p).not.toHaveProperty("handle");
  });

  it("③ edu-ID only (no GitHub): SWITCH name, note, NO @unknown handle", () => {
    const p = personIdentity({ login: null, avatarUrl: null }, edu);
    expect(p).toEqual({
      name: "Alice Dupont",
      subtitle: "GitHub not linked yet",
      avatarUrl: null,
      emails: [],
    });
    // The old bug: a literal "@unknown" handle. Must be gone.
    expect(p).not.toHaveProperty("handle");
  });

  it("falls back to the profile name when SWITCH has no real name", () => {
    expect(
      personIdentity(gh, { firstName: null, lastName: null, name: "A. D." }),
    ).toMatchObject({ name: "A. D.", handle: "alice", avatarUrl: null });
  });

  it("carries the linked user's affiliation emails", () => {
    expect(
      personIdentity(gh, { ...edu, affiliations: ["a@x.ch", "a@y.ch"] }).emails,
    ).toEqual(["a@x.ch", "a@y.ch"]);
  });
});
