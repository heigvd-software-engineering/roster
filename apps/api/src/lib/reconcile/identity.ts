// The cheapest, least destructive reconciler: the org's login/name/avatar,
// cached on the class row so the STUDENT hub is a pure DB read. Orgs get
// renamed; avatars change — this is what keeps the cache from going stale.
import { classes } from "@roster/db";
import { eq } from "drizzle-orm";
import type { Reconciler } from "./types";

/** The old and new value of one field that actually moved. Reporting a field
 *  that didn't change reads as noise and hides the one that did. Avatar VALUES
 *  are URLs — name the change, never print them. */
const changed = (
  field: string,
  was: string | null,
  now: string | null,
): { field: string; was: string; now: string } | null => {
  if (was === now) return null;
  if (field === "avatar") {
    return { field, was: "previous avatar", now: "new avatar" };
  }
  return { field, was: was ?? "—", now: now ?? "—" };
};

export const identity: Reconciler = {
  name: "identity",
  async audit(ctx) {
    const org = await ctx.orgInfo();
    const drift = [
      changed("login", ctx.cls.login, org.login),
      changed("name", ctx.cls.name, org.name),
      changed("avatar", ctx.cls.avatarUrl, org.avatarUrl),
    ].filter((d): d is NonNullable<typeof d> => d !== null);
    if (drift.length === 0) return [];
    return [
      {
        key: "identity:refresh",
        reconciler: "identity",
        severity: "drift",
        title:
          drift.length === 1
            ? "The organization's details changed on GitHub"
            : `${drift.length} of the organization's details changed on GitHub`,
        detail: `Changed on GitHub: ${drift.map((d) => d.field).join(", ")}. The class card shows the old values until refreshed.`,
        fix: "Refresh the class card",
        change: {
          from: drift.map((d) => d.was).join(" · "),
          to: drift.map((d) => d.now).join(" · "),
        },
      },
    ];
  },
  async apply(ctx, keys) {
    if (!keys.includes("identity:refresh")) return [];
    const org = await ctx.orgInfo();
    // Idempotent: re-applying writes the same values that a fresh audit would
    // read back, so calling apply twice for the same drift is a no-op success.
    await ctx.db
      .update(classes)
      .set({
        login: org.login,
        name: org.name,
        avatarUrl: org.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(classes.id, ctx.cls.id));
    return [{ key: "identity:refresh", ok: true }];
  },
};
