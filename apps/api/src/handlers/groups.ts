import { groups } from "@labs/db";
import { eq } from "drizzle-orm";
import { authedFactory } from "../factory";
import { groupInClass, resolveClassAccess } from "../lib/access";
import {
  addTeamMember,
  deleteTeam,
  removeTeamMember,
} from "../lib/github/team";
import { alreadyInLabGroup } from "../lib/groups";

/**
 * Group MEMBERSHIP + lifecycle (per-lab model, spec 2026-07-07). A group is
 * a GitHub Team (secret, students always role `member`) that belongs to ONE
 * lab; the roster lives in the team, read live. Permission model: any live
 * ACTIVE org member joins/leaves THEMSELVES; only a live org Owner (teacher)
 * manages other members or deletes groups. Creating a group is lab-scoped —
 * see handlers/lab-groups.ts. `groupId` is globally unique, so these stay
 * class-scoped by id; the group carries its own `labId` for the invariant.
 */

/** Join the group — the caller only ever adds THEMSELVES. Refused when it
 *  would put them in two groups OF THE SAME LAB. */
export const joinGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  if (
    await alreadyInLabGroup(
      c.env,
      access,
      access.org,
      group.labId,
      access.login,
      group.id,
    )
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

/** Teacher-only: put ANY org user into the group — same within-lab
 *  double-booking guard as self-join. */
export const addGroupMember = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access?.admin) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  const login = c.req.param("login");
  if (!group || !login) return c.json({ error: "not_found" }, 404);

  if (
    await alreadyInLabGroup(
      c.env,
      access,
      access.org,
      group.labId,
      login,
      group.id,
    )
  ) {
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

/** Teacher-only: delete the group (team + row). A team already gone on
 *  GitHub still drops the row; a group whose WORK REPO exists is a
 *  deliverable — refuse rather than orphan it. */
export const deleteGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access?.admin) return c.json({ error: "not_found" }, 404);
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  if (group.ghRepoId !== null) {
    return c.json({ error: "has_repo" }, 409);
  }

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
  await access.db.delete(groups).where(eq(groups.id, group.id));
  return c.json({ ok: true });
});
