import { switchDisplayName } from "~/lib/format";

/** How one person is shown, wherever they appear. */
export type PersonIdentity = {
  /** The display name: the SWITCH identity when linked, else the login. */
  name: string;
  /** The GitHub login, always — rendered as a mono "@handle". */
  handle: string;
  /** The photo, or null when the avatar should fall back to initials. */
  avatarUrl: string | null;
  /** Affiliation (professional) emails — the ONLY emails the app ever
   *  shows for another person. Empty when unlinked or none on record. */
  emails: string[];
};

/**
 * THE rule for showing a person: the avatar belongs to the identity that names
 * them. A linked student is named by their edu-ID (SWITCH) identity, and edu-ID
 * carries no picture — so they wear their initials. An unlinked student has
 * only a GitHub account, so we name them by their login and show its photo.
 *
 * One consequence, and it's intentional: the only faces in a class roster are
 * the students who haven't linked their edu-ID yet.
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
  const handle = person.login ?? "unknown";
  const emails = linked?.affiliations ?? [];
  return linked
    ? { name: switchDisplayName(linked), handle, avatarUrl: null, emails }
    : { name: handle, handle, avatarUrl: person.avatarUrl, emails };
}
