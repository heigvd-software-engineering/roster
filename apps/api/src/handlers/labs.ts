import { zValidator } from "@hono/zod-validator";
import { labs } from "@labs/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authedFactory } from "../factory";
import { labInClass, resolveClassAsTeacher } from "../lib/access";

/**
 * Lab input (create AND update share it). `deadline` arrives as an ISO
 * string (JSON) and is coerced to a Date; group labs must carry a sane
 * min/max, individual labs must carry none (individual = a group of one,
 * min=max=1 implicitly).
 */
const labInput = z
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
  zValidator("json", labInput),
  async (c) => {
    const access = await resolveClassAsTeacher(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    const { db, cls } = access;

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

/** Teacher-only: update a lab (same input shape as create — the edit dialog
 *  IS the create dialog). Attached groups are untouched; a size change that
 *  strands one shows as "needs N more" on the lab page. */
export const updateLab = authedFactory.createHandlers(
  zValidator("json", labInput),
  async (c) => {
    const access = await resolveClassAsTeacher(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    const { db } = access;

    const existing = await labInClass(access, c.req.param("labId"));
    if (!existing) {
      return c.json({ error: "not_found" }, 404);
    }

    const input = c.req.valid("json");
    const [lab] = await db
      .update(labs)
      .set({
        title: input.title,
        deadline: input.deadline,
        groupMode: input.groupMode,
        minMembers: input.minMembers ?? null,
        maxMembers: input.maxMembers ?? null,
        updatedAt: new Date(),
      })
      .where(eq(labs.id, existing.id))
      .returning();
    if (!lab) {
      throw new Error("lab update returned no row");
    }
    return c.json({ lab });
  },
);
