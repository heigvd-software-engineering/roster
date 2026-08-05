// Two settings on the class organization that roster depends on:
//
//   - base repository permission: what every member gets on every repo in the
//     org, before any team grant. Must be "none", or every student reads other
//     groups' work repos and the solutions template.
//   - member repository creation: whether a plain Member can create repos. Must
//     be off. Work repos are born through labs, and a repo a student creates
//     directly on GitHub sits outside every gate.
//
// `confirmClass` enforces and verifies both once, at class creation; its only
// caller is handlers/classes.ts. A teacher can flip either back in the org's
// settings at any time, so this reconciler re-checks them.
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
        // The title says what is true, not what the setting is called. A
        // teacher reading "base permission is read" may miss what it grants.
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
          "The organization allows Members to create repositories. Work repositories are created through roster; a repo a student creates directly on GitHub sits outside the roster workflow entirely.",
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
    // One PATCH asserts the whole policy. It is idempotent, so repairing one
    // setting leaves an already correct other one untouched.
    await enforceOrgPolicy(ctx.env, ctx.installationId, ctx.org);
    return requested.map((key) => ({ key, ok: true }));
  },
};
