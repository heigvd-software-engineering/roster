// The one place a reconciler's audit/apply reaches for the truth. Every
// source is fetched lazily and at most once per audit: `roster` and
// `base-permission` both want `ctx.people()`, and `orgPeople` is three
// paginated GitHub calls — it must run once, not once per reconciler.
// Equally, a reconciler that never asks for `orgRepos()` never pays for it.
import {
  type Class,
  classMembers,
  type Group,
  type getDb,
  groups,
  labs,
} from "@labs/db";
import { eq } from "drizzle-orm";
import type { AuthEnv } from "../auth/config";
import { orgInfo, orgPeople, orgPolicy } from "../github/org";
import { orgRepoActivity } from "../github/repo";
import type { ClassContext } from "./types";

type Db = ReturnType<typeof getDb>;

/** Memoize a zero-arg async thunk — including its rejection, so a failing source
 *  is not retried once per reconciler within one audit. */
function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}

/** Every group of every lab of this class. Groups belong to a lab, and labs
 *  belong to a class — there is no direct groups.classId column, so this is
 *  a join through labs, not a plain select. */
async function groupsOfClass(db: Db, classId: string): Promise<Group[]> {
  const rows = await db
    .select({ group: groups })
    .from(groups)
    .innerJoin(labs, eq(groups.labId, labs.id))
    .where(eq(labs.classId, classId));
  return rows.map((r) => r.group);
}

/**
 * Everything a reconciler may read, fetched lazily and at most once per audit.
 * `installationId` is the LIVE value, derived before any reconciler runs —
 * otherwise every GitHub reconciler fails against a dead pointer, which is
 * exactly when the page is needed.
 */
export function buildContext(
  env: AuthEnv,
  db: Db,
  cls: Class,
  live: { installationId: number; login: string },
): ClassContext {
  const { installationId } = live;
  const org = live.login;
  return {
    db,
    env,
    cls,
    org,
    installationId,
    orgInfo: once(() => orgInfo(env, installationId, org)),
    people: once(() => orgPeople(env, installationId, org)),
    orgPolicy: once(() => orgPolicy(env, installationId, org)),
    groups: once(() => groupsOfClass(db, cls.id)),
    orgRepos: once(() => orgRepoActivity(env, installationId, org)),
    members: once(() =>
      db.select().from(classMembers).where(eq(classMembers.classId, cls.id)),
    ),
  };
}
