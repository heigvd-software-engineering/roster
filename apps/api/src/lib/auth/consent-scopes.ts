/**
 * `oauth_consent.scopes` as production actually stores it, found by 9.10's
 * client being told its fresh consent was withdrawn: Better Auth's adapter
 * stringifies the array, and the CLI-generated json-mode column stringifies
 * AGAIN on write — so the cell holds a JSON string containing a JSON array
 * ('"[\"roster:read\"]"'), and one drizzle read yields a STRING where the
 * type promises an array. The provider shrugs the double wrap off when
 * reading its own rows; every direct drizzle read must do the same. This is
 * the one place that knows.
 *
 * Stands in for: nothing standard — it bridges a disagreement between the
 * toolkit's own two layers (the CLI-generated `mode: "json"` column and the
 * adapter's stringify-before-write; both theirs, checked 2026-08-31). Delete
 * when upstream fixes either side; the regression tests seeding the
 * double-encoded shape will say so by failing.
 */
export function consentScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((s): s is string => typeof s === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((s): s is string => typeof s === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}
