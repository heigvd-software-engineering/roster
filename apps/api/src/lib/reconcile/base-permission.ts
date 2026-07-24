// The org policy labs depends on — TWO settings on the class organization:
//
//   - the BASE repository permission: what every member gets on every repo in
//     the org, before any team grant. Must be "none", or every student
//     silently reads other groups' work repos and the solutions template.
//   - member REPOSITORY CREATION: whether a plain Member can create repos.
//     Must be off — work repos are born through labs; a repo a student
//     creates directly on GitHub sits outside every gate.
//
// `confirmClass` enforces and verifies both ONCE, at class creation
// (handlers/classes.ts — its only caller). A teacher can flip either back in
// the org's settings at any time; this reconciler is what re-checks them.
import { enforceOrgPolicy } from "../github/org";
import type { Reconciler } from "./types";

const BASE_KEY = "base-permission:reset";
const CREATE_KEY = "base-permission:repo-creation";

export const basePermissionReconciler: Reconciler = {
  name: "base-permission",

  async audit(ctx) {
    const policy = await ctx.orgPolicy();
    const findings = [];
    if (policy.basePermission !== "none") {
      findings.push({
        key: BASE_KEY,
        reconciler: "base-permission",
        severity: "broken" as const,
        // The title says what is TRUE, not what the setting is called. A teacher
        // reading "base permission is read" may not realise what it grants.
        title: "Every member can read every repository",
        detail: `The organization's base repository permission is "${policy.basePermission}", not "none". Students can read other groups' work repositories.`,
        fix: 'Set the base permission back to "none"',
        change: {
          from: `Base permission: ${policy.basePermission}`,
          to: "Base permission: none",
        },
      });
    }
    if (policy.membersCanCreateRepos) {
      findings.push({
        key: CREATE_KEY,
        reconciler: "base-permission",
        severity: "broken" as const,
        title: "Students can create repositories in the organization",
        detail:
          "The organization allows Members to create repositories. Work repositories are created through labs; a repo a student creates directly on GitHub sits outside the labs workflow entirely.",
        fix: "Turn off member repository creation",
        change: {
          from: "Member repository creation: allowed",
          to: "Member repository creation: off",
        },
      });
    }
    return findings;
  },

  async apply(ctx, keys) {
    const requested = keys.filter((k) => k === BASE_KEY || k === CREATE_KEY);
    if (requested.length === 0) return [];
    // ONE PATCH asserts the whole policy — idempotent, so repairing one
    // setting while the other is already right is a no-op for the latter.
    await enforceOrgPolicy(ctx.env, ctx.installationId, ctx.org);
    return requested.map((key) => ({ key, ok: true }));
  },
};
