import { zValidator } from "@hono/zod-validator";
import { assignments, groups } from "@roster/db";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { authedFactory } from "../factory";
import {
  findAssignmentInClass,
  resolveClassAsTeacher,
} from "../lib/class-scope";
import { orgTemplateRepos } from "../lib/github/repo";
import { deleteGroupsWithTeams } from "../lib/groups";

/**
 * Assignment input, shared by create and update. `deadline` arrives as an ISO
 * string (JSON) and is coerced to a Date. Group assignments must carry a sane
 * min/max; individual assignments carry none (individual means a group of one,
 * min=max=1). The optional template (starter code) comes as the id+fullName
 * pair from the templates endpoint, both or neither.
 */
const assignmentInput = z
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
        "group assignments need minMembers <= maxMembers; individual assignments take neither",
    },
  )
  .refine(
    (v) =>
      (v.templateRepoId === undefined) ===
      (v.templateRepoFullName === undefined),
    { message: "template id and full name come together" },
  );

/** Teacher-only: create an assignment in the class (visible to students on create). */
export const createAssignment = authedFactory.createHandlers(
  zValidator("json", assignmentInput),
  async (c) => {
    const access = await resolveClassAsTeacher(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    const { db, cls } = access;

    const input = c.req.valid("json");
    // The group slug, and so the work repo name, is
    // slugify(assignment.title)-slugify(group.name), so two assignments sharing
    // a title share a repo namespace. The unique index is the backstop; this is
    // the clean answer.
    const [clash] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.classId, cls.id),
          eq(assignments.title, input.title),
        ),
      );
    if (clash) return c.json({ error: "title_taken" }, 409);

    // The one date rule: a set start must precede the deadline. Different
    // assignments may overlap freely; assignment 2 can open while assignment 1
    // runs.
    if (input.startAt && input.startAt >= input.deadline) {
      return c.json({ error: "start_after_deadline" }, 409);
    }

    const now = new Date();
    const [assignment] = await db
      .insert(assignments)
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
    if (!assignment) {
      throw new Error("assignment insert returned no row");
    }
    return c.json({ assignment });
  },
);

/** Teacher-only: update an assignment (same input shape as create, since the edit
 *  dialog is the create dialog). Attached groups are untouched; a size change
 *  that strands one shows as "needs N more" on the assignment page. */
export const updateAssignment = authedFactory.createHandlers(
  zValidator("json", assignmentInput),
  async (c) => {
    const access = await resolveClassAsTeacher(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    const { db } = access;

    const existing = await findAssignmentInClass(
      access,
      c.req.param("assignmentId"),
    );
    if (!existing) {
      return c.json({ error: "not_found" }, 404);
    }

    const input = c.req.valid("json");
    // Same guard as createAssignment, excluding the assignment being edited:
    // keeping your own title must not read as a clash with yourself.
    const [clash] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.classId, access.cls.id),
          eq(assignments.title, input.title),
          ne(assignments.id, existing.id),
        ),
      );
    if (clash) return c.json({ error: "title_taken" }, 409);

    if (input.startAt && input.startAt >= input.deadline) {
      return c.json({ error: "start_after_deadline" }, 409);
    }

    const [assignment] = await db
      .update(assignments)
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
      .where(eq(assignments.id, existing.id))
      .returning();
    if (!assignment) {
      throw new Error("assignment update returned no row");
    }
    return c.json({ assignment });
  },
);

/**
 * Teacher-only: delete the assignment, every group in it, and their GitHub
 * Teams.
 *
 * Refuses nothing, like `deleteGroup`: the app has one deletion rule and it is
 * the typed name in the client's dialog (see
 * `docs/classes-and-assignments.md`). An assignment a teacher wants gone is
 * usually one they mistyped minutes ago, and a rule that refused forever once a
 * student clicked "start" would leave the mistake on the class page all
 * semester.
 *
 * `groups.assignmentId` carries no cascade of its own, so the groups go through
 * `deleteGroupsWithTeams` (which owns the teams-before-rows ordering) and the
 * assignment row goes last.
 */
export const deleteAssignment = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsTeacher(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);

  const assignment = await findAssignmentInClass(
    access,
    c.req.param("assignmentId"),
  );
  if (!assignment) return c.json({ error: "not_found" }, 404);

  const rows = await access.db
    .select({ id: groups.id, ghTeamSlug: groups.ghTeamSlug })
    .from(groups)
    .where(eq(groups.assignmentId, assignment.id));

  await deleteGroupsWithTeams(access, rows);
  await access.db.delete(assignments).where(eq(assignments.id, assignment.id));
  return c.json({ ok: true });
});

/** Teacher-only: the org's template repos, the assignment dialog's starter-code
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
