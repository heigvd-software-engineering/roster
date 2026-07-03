import { zValidator } from "@hono/zod-validator";
import { classes, getDb, labs } from "@labs/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authedFactory } from "../factory";
import { orgLogin } from "../github/app";
import { isOrgAdmin } from "../github/org";

/**
 * Lab creation input. `deadline` arrives as an ISO string (JSON) and is
 * coerced to a Date; group labs must carry a sane min/max, individual labs
 * must carry none (individual = a group of one, min=max=1 implicitly).
 */
const createLabInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    deadline: z.coerce.date(),
    groupMode: z.enum(["individual", "group"]),
    minMembers: z.number().int().min(1).optional(),
    maxMembers: z.number().int().min(1).optional(),
  })
  .refine(
    (v) =>
      v.groupMode === "group"
        ? v.minMembers !== undefined &&
          v.maxMembers !== undefined &&
          v.minMembers <= v.maxMembers
        : v.minMembers === undefined && v.maxMembers === undefined,
    {
      message:
        "group labs need minMembers <= maxMembers; individual labs take neither",
    },
  );

/** Teacher-only: create a lab in the class (visible to students on create). */
export const createLab = authedFactory.createHandlers(
  zValidator("json", createLabInput),
  async (c) => {
    // Params type as string | undefined outside the chain — guard explicitly.
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const db = getDb(c.env.DB);
    const [cls] = await db.select().from(classes).where(eq(classes.id, id));
    if (!cls) return c.json({ error: "not_found" }, 404);

    // Teacher check: live org Owner (same rule as confirm — 404, not 403,
    // so the class's existence isn't confirmed to non-teachers).
    const ghAccount = await db.query.account.findFirst({
      where: (a, op) =>
        op.and(
          op.eq(a.userId, c.get("user").id),
          op.eq(a.providerId, "github"),
        ),
      columns: { accountId: true },
    });
    const ghId = Number(ghAccount?.accountId);
    if (
      !Number.isFinite(ghId) ||
      !(await isOrgAdmin(
        c.env,
        cls.installationId,
        await orgLogin(c.env, cls.installationId),
        ghId,
      ))
    ) {
      return c.json({ error: "not_found" }, 404);
    }

    const input = c.req.valid("json");
    const now = new Date();
    const [lab] = await db
      .insert(labs)
      .values({
        id: crypto.randomUUID(),
        classId: cls.id,
        title: input.title,
        deadline: input.deadline,
        groupMode: input.groupMode,
        minMembers: input.minMembers ?? null,
        maxMembers: input.maxMembers ?? null,
        createdByUserId: c.get("user").id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!lab) {
      throw new Error("lab insert returned no row");
    }
    return c.json({ lab });
  },
);
