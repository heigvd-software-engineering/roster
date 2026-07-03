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
