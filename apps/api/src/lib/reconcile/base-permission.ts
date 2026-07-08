// The org's BASE repository permission — what every member gets on every repo
// in the organization, before any team grant.
//
// `confirmClass` sets it to "none" and verifies it ONCE, at class creation
// (handlers/classes.ts:41-51 — its only caller). Nothing has ever re-checked it.
// A teacher can flip it back in the org's settings and every student silently
// gains read access to every repository in the org: other groups' work repos,
// the solutions template, everything.
//
// This is the reconciler that proves the abstraction earns its keep. The
// invariant existed and was unverified, and there was no surface to hang the
// check on until now. It is one file and one line in the registry.
import { setBasePermissionNone } from "../github/org";
import type { Reconciler } from "./types";

const KEY = "base-permission:reset";

export const basePermissionReconciler: Reconciler = {
  name: "base-permission",

  async audit(ctx) {
    const permission = await ctx.basePermission();
    if (permission === "none") return [];
    return [
      {
        key: KEY,
        reconciler: "base-permission",
        severity: "broken",
        // The title says what is TRUE, not what the setting is called. A teacher
        // reading "base permission is read" may not realise what it grants.
        title: "Every member can read every repository",
        detail: `The organization's base repository permission is "${permission}", not "none". Students can read other groups' work repositories.`,
        fix: 'Set the base permission back to "none"',
        // Applying REVOKES access, so it starts unchecked like every destructive
        // finding. The copy above says which way the hazard actually runs: it is
        // LEAVING this unfixed that is dangerous.
        destructive: true,
      },
    ];
  },

  async apply(ctx, keys) {
    if (!keys.includes(KEY)) return [];
    // Idempotent: setting "none" when it is already "none" is a no-op on GitHub.
    await setBasePermissionNone(ctx.env, ctx.installationId, ctx.org);
    return [{ key: KEY, ok: true }];
  },
};
