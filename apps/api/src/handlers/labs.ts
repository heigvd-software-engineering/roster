import { zValidator } from "@hono/zod-validator";
import { groups, labs } from "@roster/db";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { authedFactory } from "../factory";
import { findLabInClass, resolveClassAsTeacher } from "../lib/class-scope";
import { orgTemplateRepos } from "../lib/github/repo";
import { deleteGroupsWithTeams } from "../lib/groups";

/**
 * Lab input, shared by create and update. `deadline` arrives as an ISO string
 * (JSON) and is coerced to a Date. Group labs must carry a sane min/max;
 * individual labs carry none (individual means a group of one, min=max=1).
 * The optional template (starter code) comes as the id+fullName pair from the
 * templates endpoint, both or neither.
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
    // The group slug, and so the work repo name, is
    // slugify(lab.title)-slugify(group.name), so two labs sharing a title
    // share a repo namespace. The unique index is the backstop; this is the
    // clean answer.
    const [clash] = await db
      .select({ id: labs.id })
      .from(labs)
      .where(and(eq(labs.classId, cls.id), eq(labs.title, input.title)));
    if (clash) return c.json({ error: "title_taken" }, 409);

    // The one date rule: a set start must precede the deadline. Different labs
    // may overlap freely; lab 2 can open while lab 1 runs.
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

/** Teacher-only: update a lab (same input shape as create, since the edit
 *  dialog is the create dialog). Attached groups are untouched; a size change
 *  that strands one shows as "needs N more" on the lab page. */
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
    // Same guard as createLab, excluding the lab being edited: keeping your
    // own title must not read as a clash with yourself.
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
        // Absent means NULL on update too: the dialog always submits the
        // complete form, so an emptied Start means "starts now".
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

/**
 * Teacher-only: delete the lab, every group in it, and their GitHub Teams.
 *
 * Refuses nothing, like `deleteGroup`: the app has one deletion rule and it is
 * the typed name in the client's dialog (see `docs/classes-and-labs.md`). A lab
 * a teacher wants gone is usually one they mistyped minutes ago, and a rule
 * that refused forever once a student clicked "start" would leave the mistake
 * on the class page all semester.
 *
 * `groups.labId` carries no cascade of its own, so the groups go through
 * `deleteGroupsWithTeams` (which owns the teams-before-rows ordering) and the
 * lab row goes last.
 */
export const deleteLab = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsTeacher(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);

  const lab = await findLabInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);

  const rows = await access.db
    .select({ id: groups.id, ghTeamSlug: groups.ghTeamSlug })
    .from(groups)
    .where(eq(groups.labId, lab.id));

  await deleteGroupsWithTeams(access, rows);
  await access.db.delete(labs).where(eq(labs.id, lab.id));
  return c.json({ ok: true });
});

/** Teacher-only: the org's template repos, the lab dialog's starter-code
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
