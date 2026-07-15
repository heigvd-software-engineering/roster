import { switchDisplayName } from "~/lib/format";

/**
 * How one person is shown, wherever they appear. The second line is a
 * discriminated choice — a GitHub `@handle`, a muted status note, or nothing
 * — so the three identity states can't blur together:
 *
 *   ① fully linked (edu-ID + GitHub): SWITCH name + `@login`
 *   ② GitHub only  (no edu-ID):       login as the name, nothing below
 *                                     (the PHOTO avatar is the "unlinked" tell)
 *   ③ edu-ID only  (no GitHub):       SWITCH name + "GitHub not linked" note
 *
 * ② stays bare on purpose: a class roster is mostly GitHub-only students, so a
 * "not linked" note on every row would be noise — the face already says it.
 * ③ is rare (the caller mid-onboarding), so its note isn't noise and IS needed
 * to tell it apart from ①.
 */
export type PersonIdentity = {
  /** The display name: the SWITCH identity when linked, else the login. */
  name: string;
  /** The photo, or null when the avatar should fall back to initials. */
  avatarUrl: string | null;
  /** Affiliation (professional) emails — the ONLY emails the app ever shows
   *  for another person. From edu-ID, so states ① and ③ can carry them. */
  emails: string[];
} & (
  | { handle: string; subtitle?: never }
  | { subtitle: string; handle?: never }
  | { handle?: never; subtitle?: never }
);

/**
 * THE rule for showing a person: the avatar belongs to the identity that names
 * them. A person named by their edu-ID (SWITCH) wears initials — edu-ID carries
 * no picture; a person named by their GitHub login wears its photo. The second
 * line then states the GitHub-link status, so the same login is never printed
 * twice and a missing login never leaks as "@unknown".
 *
 * One consequence, intentional: the only faces in a class roster are the people
 * who haven't linked their edu-ID yet.
 */
export function personIdentity(
  person: { login: string | null; avatarUrl: string | null },
  linked?: {
    firstName: string | null;
    lastName: string | null;
    name: string;
    affiliations?: string[];
  },
): PersonIdentity {
  const emails = linked?.affiliations ?? [];
  if (linked) {
    const name = switchDisplayName(linked);
    // ① edu-ID + GitHub → name + @login. ③ edu-ID only → name + a note
    // (never "@unknown" — there's simply no handle to show).
    return person.login
      ? { name, handle: person.login, avatarUrl: null, emails }
      : { name, subtitle: "GitHub not linked yet", avatarUrl: null, emails };
  }
  // ② GitHub only → the login IS the identity, shown once, with its photo.
  return {
    name: person.login ?? "unknown",
    avatarUrl: person.avatarUrl,
    emails,
  };
}
