/**
 * Mint a class join-link capability token: 128 bits of Web Crypto randomness as
 * 32 hex chars. Separate from the class `id` (a stable cuid) so a leaked link
 * can be regenerated later without touching identity.
 */
export function mintJoinToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
