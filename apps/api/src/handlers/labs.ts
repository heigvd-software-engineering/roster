import { zValidator } from "@hono/zod-validator";
import { labs } from "@roster/db";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { authedFactory } from "../factory";
import { findLabInClass, resolveClassAsTeacher } from "../lib/class-scope";
import { orgTemplateRepos } from "../lib/github/repo";

/**
 * Lab input (create AND update share it). `deadline` arrives as an ISO
 * string (JSON) and is coerced to a Date; group labs must carry a sane
 * min/max, individual labs must carry none (individual = a group of one,
 * min=max=1 implicitly). The optional template (starter code) comes as the
 * id+fullName pair from the templates endpoint — both or neither.
 */
const labInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    deadline: z.coerce.date(),
    startAt: z.coerce.date().optional(),
    groupMode: z.enum(["individual", "group"]),
    minMembers: z.number().int().min(1).optional(),
    maxMembers: z.number().int().min(1).optional(),
    templateRepoId: z.number().int().optional(),
    templateRepoFullName: z.string().min(3).max(200).optional(),
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
  )
  .refine(
    (v) =>
      (v.templateRepoId === undefined) ===
      (v.templateRepoFullName === undefined),
    { message: "template id and full name come together" },
  );

/** Teacher-only: create a lab in the class (visible to students on create). */
export const createLab = authedFactory.createHandlers(
  zValidator("json", labInput),
  async (c) => {
    const access = await resolveClassAsTeacher(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    const { db, cls } = access;

    const input = c.req.valid("json");
    // The group slug — and so the WORK REPO NAME — is
    // slugify(lab.title)-slugify(group.name), so two labs sharing a title share a
    // repo namespace. The unique index is the backstop; this is the clean answer.
    const [clash] = await db
      .select({ id: labs.id })
      .from(labs)
      .where(and(eq(labs.classId, cls.id), eq(labs.title, input.title)));
    if (clash) return c.json({ error: "title_taken" }, 409);

    // The one date rule: a set start must precede the deadline. Ranges of
    // DIFFERENT labs may overlap freely — lab 2 can open while lab 1 runs.
    if (input.startAt && input.startAt >= input.deadline) {
      return c.json({ error: "start_after_deadline" }, 409);
    }

    const now = new Date();
    const [lab] = await db
      .insert(labs)
      .values({
        id: crypto.randomUUID(),
        classId: cls.id,
        title: input.title,
        deadline: input.deadline,
        startAt: input.startAt ?? null,
        groupMode: input.groupMode,
        minMembers: input.minMembers ?? null,
        maxMembers: input.maxMembers ?? null,
        templateRepoId: input.templateRepoId ?? null,
        templateRepoFullName: input.templateRepoFullName ?? null,
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

    const existing = await findLabInClass(access, c.req.param("labId"));
    if (!existing) {
      return c.json({ error: "not_found" }, 404);
    }

    const input = c.req.valid("json");
    // Same guard as createLab, excluding the lab being edited: keeping your own
    // title must not read as a clash with yourself.
    const [clash] = await db
      .select({ id: labs.id })
      .from(labs)
      .where(
        and(
          eq(labs.classId, access.cls.id),
          eq(labs.title, input.title),
          ne(labs.id, existing.id),
        ),
      );
    if (clash) return c.json({ error: "title_taken" }, 409);

    if (input.startAt && input.startAt >= input.deadline) {
      return c.json({ error: "start_after_deadline" }, 409);
    }

    const [lab] = await db
      .update(labs)
      .set({
        title: input.title,
        deadline: input.deadline,
        // Absent means NULL on update too — the dialog always submits the
        // complete form, so an emptied Start genuinely means "starts now".
        startAt: input.startAt ?? null,
        groupMode: input.groupMode,
        minMembers: input.minMembers ?? null,
        maxMembers: input.maxMembers ?? null,
        templateRepoId: input.templateRepoId ?? null,
        templateRepoFullName: input.templateRepoFullName ?? null,
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

/** Teacher-only: the org's TEMPLATE repos — the lab dialog's starter-code
 *  choices (only repos flagged `is_template` on GitHub can /generate). */
export const listTemplateRepos = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsTeacher(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const templates = await orgTemplateRepos(
    c.env,
    access.cls.installationId,
    access.org,
  );
  return c.json({ templates });
});
