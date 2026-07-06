import { zValidator } from "@hono/zod-validator";
import { groups, studentLabRepos } from "@labs/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authedFactory } from "../factory";
import { groupInClass, resolveClassAccess } from "../lib/access";
import {
  addTeamMember,
  deleteTeam,
  removeTeamMember,
} from "../lib/github/team";
import { createGroupWithTeam, wouldDoubleParticipate } from "../lib/groups";

/**
 * Group management (F7): a labs group IS a GitHub Team (secret, students
 * always role `member`); the roster lives in the team, read live — the
 * `groups` row is a thin link. Permission model (user-decided 2026-07-06):
 * any live ACTIVE org member (student or teacher) creates groups and
 * joins/leaves THEMSELVES; only a live org Owner (teacher) manages other
 * members or deletes groups. Groups are listed and attached per-lab (see
 * handlers/lab-groups.ts — the lab page is the only group surface).
 */

const createGroupInput = z.object({
  name: z.string().trim().min(1).max(100),
});

/** Create a group (any active member). A creating STUDENT auto-joins their
 *  group; a teacher stays out — they manage, they don't participate. */
export const createGroup = authedFactory.createHandlers(
  zValidator("json", createGroupInput),
  async (c) => {
    const access = await resolveClassAccess(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);

    const group = await createGroupWithTeam(
      c.env,
      access,
      c.req.valid("json").name,
      c.get("user").id,
      { autoJoin: !access.admin },
    );
    if (!group) return c.json({ error: "name_taken" }, 409);
    return c.json({
      group: { id: group.id, name: group.name, slug: group.ghTeamSlug },
    });
  },
);

/** Join the group — the caller only ever adds THEMSELVES. Refused when it
 *  would put them in two groups participating in the same lab. */
export const joinGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  if (
    await wouldDoubleParticipate(c.env, access, access.org, group, access.login)
  ) {
    return c.json({ error: "member_already_participating" }, 409);
  }
  await addTeamMember(
    c.env,
    access.cls.installationId,
    access.org,
    group.ghTeamSlug,
    access.login,
  );
  return c.json({ ok: true });
});

/** Leave the group — the caller only ever removes THEMSELVES. */
export const leaveGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  await removeTeamMember(
    c.env,
    access.cls.installationId,
    access.org,
    group.ghTeamSlug,
    access.login,
  );
  return c.json({ ok: true });
});

/** Teacher-only: put ANY org user into the group — same double-booking
 *  guard as self-join (a teacher's add must not break the invariant). */
export const addGroupMember = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access?.admin) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  const login = c.req.param("login");
  if (!group || !login) return c.json({ error: "not_found" }, 404);

  if (await wouldDoubleParticipate(c.env, access, access.org, group, login)) {
    return c.json({ error: "member_already_participating" }, 409);
  }
  await addTeamMember(
    c.env,
    access.cls.installationId,
    access.org,
    group.ghTeamSlug,
    login,
  );
  return c.json({ ok: true });
});

/** Teacher-only: remove ANY member from the group. */
export const removeGroupMember = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access?.admin) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  const login = c.req.param("login");
  if (!group || !login) return c.json({ error: "not_found" }, 404);

  await removeTeamMember(
    c.env,
    access.cls.installationId,
    access.org,
    group.ghTeamSlug,
    login,
  );
  return c.json({ ok: true });
});

/** Teacher-only: delete the group (team + attachments + row). A team
 *  already gone on GitHub still drops the rows. */
export const deleteGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access?.admin) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  try {
    await deleteTeam(
      c.env,
      access.cls.installationId,
      access.org,
      group.ghTeamSlug,
    );
  } catch (err) {
    if ((err as { status?: number }).status !== 404) throw err;
  }
  // Lab attachments first (FK), then the group itself.
  await access.db
    .delete(studentLabRepos)
    .where(eq(studentLabRepos.groupId, group.id));
  await access.db.delete(groups).where(eq(groups.id, group.id));
  return c.json({ ok: true });
});
