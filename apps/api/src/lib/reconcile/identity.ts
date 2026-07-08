// The cheapest, least destructive reconciler: the org's login/name/avatar,
// cached on the class row so the STUDENT hub is a pure DB read. Orgs get
// renamed; avatars change — this is what keeps the cache from going stale.
import { classes } from "@labs/db";
import { eq } from "drizzle-orm";
import type { Reconciler } from "./types";

export const identity: Reconciler = {
  name: "identity",
  async audit(ctx) {
    const org = await ctx.orgInfo();
    const drifted =
      org.login !== ctx.cls.login ||
      org.name !== ctx.cls.name ||
      org.avatarUrl !== ctx.cls.avatarUrl;
    if (!drifted) return [];
    return [
      {
        key: "identity:refresh",
        reconciler: "identity",
        severity: "drift",
        title: "The organization's details changed on GitHub",
        detail: `${ctx.cls.login} → ${org.login}${
          org.name !== ctx.cls.name
            ? ` · "${ctx.cls.name}" → "${org.name}"`
            : ""
        }`,
        fix: "Refresh the class card",
        destructive: false,
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
