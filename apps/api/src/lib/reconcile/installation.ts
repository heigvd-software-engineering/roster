// The class's pointer at its GitHub App installation. A reinstall mints a NEW
// installation id; `githubSetupCallback` records it, but only if the browser
// that performed the reinstall reached the Setup URL. Nothing else does — and a
// student cannot repair it, because re-deriving the id needs
// `GET /user/installations`, which only lists installations the caller
// administers. So this reconciler and setup.ts are the only two writers.
import { classes } from "@labs/db";
import { eq } from "drizzle-orm";
import type { Reconciler } from "./types";

const KEY = "installation:repair";

export const installation: Reconciler = {
  name: "installation",
  async audit(ctx) {
    // ctx.installationId is the LIVE value, resolved before any reconciler ran.
    if (ctx.installationId === ctx.cls.installationId) return [];
    return [
      {
        key: KEY,
        reconciler: "installation",
        severity: "broken",
        // What we SAW, not why. A reinstall is the usual cause, not the only
        // one, and the reconciler cannot tell them apart.
        title: "The class points at an old GitHub App installation",
        detail:
          "Until this is repaired, students and lab pages cannot reach this class.",
        fix: "Repoint the class at the current installation",
        change: {
          from: `Installation ${ctx.cls.installationId}`,
          to: `Installation ${ctx.installationId}`,
        },
        destructive: false,
      },
    ];
  },
  async apply(ctx, keys) {
    if (!keys.includes(KEY)) return [];
    // Keyed on orgId, like setup.ts: the org id is the only handle a reinstall
    // preserves. Idempotent — re-applying writes the same value.
    await ctx.db
      .update(classes)
      .set({ installationId: ctx.installationId, updatedAt: new Date() })
      .where(eq(classes.orgId, ctx.cls.orgId));
    return [{ key: KEY, ok: true }];
  },
};
