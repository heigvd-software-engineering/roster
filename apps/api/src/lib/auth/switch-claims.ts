// Claims we read out of the SWITCH edu-ID `id_token` we already hold.
//
// Lives under `auth/`, not in a `lib/switch/` service folder, because nothing
// here TALKS to SWITCH: the token is an artifact of signing in, stored by
// Better Auth, and this is only how we read it. AGENTS.md rule 7 puts external
// *calls* behind a per-service layer — if we ever call a SWITCH API, that call
// belongs in `lib/switch/`, and this file can stay where the token does.

/** Decode a JWT payload (no verification — it's our own stored id_token). */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split(".")[1];
  if (!part) {
    return null;
  }
  try {
    const bytes = Uint8Array.from(
      atob(part.replace(/-/g, "+").replace(/_/g, "/")),
      (ch) => ch.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * The user's institutional affiliation emails, from the SWITCH id_token's
 * `swissEduIDLinkedAffiliationMail` claim. Static profile data, so we read it
 * from the stored token — no live call, no token-expiry concern. (The personal
 * `swissEduIDAssociatedMail` is intentionally excluded — it's not an affiliation.)
 */
export function readAffiliationEmails(idToken: string): string[] {
  const p = decodeJwtPayload(idToken) as {
    swissEduIDLinkedAffiliationMail?: unknown;
  } | null;
  const linked = p?.swissEduIDLinkedAffiliationMail;
  return Array.isArray(linked) ? (linked as string[]) : [];
}
