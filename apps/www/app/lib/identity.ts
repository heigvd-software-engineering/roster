import { switchDisplayName } from "~/lib/format";

/**
 * How one person is shown, wherever they appear. The second line is a
 * discriminated choice, either a GitHub `@handle` or a muted status note, so
 * the three identity states can't blur together and every unlinked person
 * says so in words (the teacher shouldn't have to infer it from the avatar):
 *
 *   ① fully linked (edu-ID + GitHub): SWITCH name + `@login`
 *   ② GitHub only  (no edu-ID):       login as the name + "not linked to edu-ID"
 *   ③ edu-ID only  (no GitHub):       SWITCH name + "GitHub not linked yet"
 */
export type PersonIdentity = {
  /** The display name: the SWITCH identity when linked, else the login. */
  name: string;
  /** True when `name` is a GitHub login (state ②, no edu-ID): render it as a
   *  mono, "@"-prefixed handle so a bare login reads as a login, not a
   *  person's name. `name` itself stays the raw login (the avatar's initials,
   *  the alt text and the emails menu all want it clean). */
  nameIsLogin?: boolean;
  /** The photo, or null when the avatar should fall back to initials. */
  avatarUrl: string | null;
  /** The professional email (`user.email`, HES-SO audience), the only email
   *  the app ever shows for another person. It comes from edu-ID, so only
   *  states ① and ③ can carry it. */
  email: string | null;
} & (
  | { handle: string; subtitle?: never }
  | { subtitle: string; handle?: never }
);

/**
 * The rule for showing a person: the avatar belongs to the identity that names
 * them. A person named by their edu-ID (SWITCH) wears initials, since edu-ID
 * carries no picture; one named by their GitHub login wears its photo. The second
 * line states the link status in words, so a teacher scanning the roster sees
 * exactly who still has to link (and the login is never printed twice, nor a
 * missing login leaked as "@unknown").
 */
export function personIdentity(
  person: { login: string | null; avatarUrl: string | null },
  linked?: {
    firstName: string | null;
    lastName: string | null;
    name: string;
    email?: string | null;
  },
): PersonIdentity {
  const email = linked?.email ?? null;
  if (linked) {
    const name = switchDisplayName(linked);
    // ① edu-ID + GitHub → name + @login. ③ edu-ID only → name + a note
    // (never "@unknown": there is no handle to show).
    return person.login
      ? { name, handle: person.login, avatarUrl: null, email }
      : { name, subtitle: "GitHub not linked yet", avatarUrl: null, email };
  }
  // ② GitHub only → the login is the identity (shown once, with its photo),
  // and the note spells out why there's no real name.
  return {
    name: person.login ?? "unknown",
    nameIsLogin: person.login != null,
    subtitle: "not linked to edu-ID",
    avatarUrl: person.avatarUrl,
    email,
  };
}
