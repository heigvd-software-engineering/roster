// The class's pointer at its GitHub App installation. A reinstall mints a new
// installation id, and `githubSetupCallback` records it only if the browser that
// performed the reinstall reached the Setup URL. A student cannot repair it:
// re-deriving the id needs `GET /user/installations`, which lists only the
// installations the caller administers. So this reconciler and setup.ts are the
// only two writers.
import { classes } from "@roster/db";
import { eq } from "drizzle-orm";
import type { Reconciler } from "./types";

const KEY = "installation:repair";

export const installation: Reconciler = {
  name: "installation",
  async audit(ctx) {
    // ctx.installationId is the live value, resolved before any reconciler ran.
    if (ctx.installationId === ctx.cls.installationId) return [];
    return [
      {
        key: KEY,
        reconciler: "installation",
        severity: "broken",
        // What we saw, not why. A reinstall is the usual cause but not the only
        // one, and the reconciler cannot tell them apart.
        title: "The class points at an old GitHub App installation",
        detail:
          "Until this is repaired, students and lab pages cannot reach this class.",
        fix: "Repoint the class at the current installation",
        change: {
          from: `Installation ${ctx.cls.installationId}`,
          to: `Installation ${ctx.installationId}`,
        },
      },
    ];
  },
  async apply(ctx, keys) {
    if (!keys.includes(KEY)) return [];
    // Keyed on orgId, like setup.ts: the org id is the only handle a reinstall
    // preserves. Idempotent, since re-applying writes the same value.
    await ctx.db
      .update(classes)
      .set({ installationId: ctx.installationId, updatedAt: new Date() })
      .where(eq(classes.orgId, ctx.cls.orgId));
    return [{ key: KEY, ok: true }];
  },
};
