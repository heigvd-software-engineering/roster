import { account, classMembers, type getDb, user } from "@roster/db";
import { and, eq, inArray } from "drizzle-orm";
import { inList } from "./in-list";

/**
 * Who people are, across the three identity systems this app straddles:
 *
 * - a **roster user** (`user.id`), created by Better Auth at sign-in
 * - a **GitHub account** (`account.accountId` for provider `github`), what
 *   every org, team and repo API speaks in, and what `class_members` stores
 * - a **SWITCH edu-ID** (provider `switch`), where the real name and the
 *   professional email come from. The registry audience is HES-SO (academic
 *   login), so `user.email` is the institutional address, refreshed at every
 *   sign-in (overrideUserInfo). SWITCH no longer releases the swissEduID*
 *   affiliation claims and nothing reads them.
 *
 * Nothing here authorizes anything: it answers "who is this" and "what may we
 * say about them", never "may they do this". Class-scoped permission lives in
 * `class-scope.ts`.
 */

type Db = ReturnType<typeof getDb>;

/**
 * A roster user's GitHub account id, in the two forms the codebase needs:
 * `ghId` as a number for GitHub APIs, `githubId` as the string stored in
 * `class_members.githubId`.
 *
 * `null` when there is no linked GitHub account, or when the stored id is not
 * numeric, which is as good as absent (`account.accountId` is TEXT, shared with
 * providers whose ids are not numbers).
 */
export async function githubIdsForUser(
  db: Db,
  userId: string,
): Promise<{ ghId: number; githubId: string } | null> {
  const row = await db.query.account.findFirst({
    where: (a, op) =>
      op.and(op.eq(a.userId, userId), op.eq(a.providerId, "github")),
    columns: { accountId: true },
  });
  if (!row) return null;
  const ghId = Number(row.accountId);
  return Number.isFinite(ghId) ? { ghId, githubId: row.accountId } : null;
}

/** The columns of a linked roster user: the one set allowed to leave the
 *  server for other class members. Both lookups below select exactly these. */
const linkedProfileColumns = {
  githubId: account.accountId,
  firstName: user.firstName,
  lastName: user.lastName,
  name: user.name,
  email: user.email,
};

/**
 * The roster users behind a set of GitHub ids, in the one shape allowed to
 * leave the server for other class members: display-name fields plus the
 * professional email.
 *
 * With the HES-SO audience, `user.email` is that professional address, the
 * thing rosters exist to show, so it rides here as `email`. Keyed by github id
 * because that is what the caller has: rosters and member rows speak GitHub, so
 * the client correlates on it.
 */
export async function profilesByGithubId(db: Db, githubIds: string[]) {
  if (githubIds.length === 0) return [];
  const rows = await db
    .select(linkedProfileColumns)
    .from(account)
    .innerJoin(user, eq(account.userId, user.id))
    .where(
      and(
        eq(account.providerId, "github"),
        inList(account.accountId, githubIds),
      ),
    );
  return rows.map(({ githubId, ...profile }) => ({ githubId, user: profile }));
}

/**
 * The roster users behind the joined members of a set of classes, each tagged
 * with its class id: the same shape as `profilesByGithubId`, answered by a join for a
 * caller that holds class ids rather than GitHub ids.
 *
 * The hub used to read every member row and send its GitHub ids back for the
 * lookup. That is a round trip through application code for something the
 * database relates on its own (`class_members.githubId` is
 * `account.accountId`), and it made the list grow with the number of students.
 *
 * Joined members only: an open invitation is not yet anyone's membership, so an
 * invited person's roster identity stays out even when the invitation names
 * them. A person in two of the classes appears once for each.
 */
export async function profilesOfClassMembers(db: Db, classIds: string[]) {
  const rows =
    classIds.length === 0
      ? []
      : await db
          .select({ classId: classMembers.classId, ...linkedProfileColumns })
          .from(classMembers)
          .innerJoin(
            account,
            and(
              eq(account.providerId, "github"),
              eq(account.accountId, classMembers.githubId),
            ),
          )
          .innerJoin(user, eq(account.userId, user.id))
          .where(
            and(
              inList(classMembers.classId, classIds),
              inArray(classMembers.state, ["active", "teacher"]),
            ),
          );
  return rows.map(({ classId, githubId, ...profile }) => ({
    classId,
    linked: { githubId, user: profile },
  }));
}
