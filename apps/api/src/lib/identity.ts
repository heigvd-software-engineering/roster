import { account, type getDb, user } from "@roster/db";
import { and, eq, inArray } from "drizzle-orm";

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
    .select({
      githubId: account.accountId,
      firstName: user.firstName,
      lastName: user.lastName,
      name: user.name,
      email: user.email,
    })
    .from(account)
    .innerJoin(user, eq(account.userId, user.id))
    .where(
      and(
        eq(account.providerId, "github"),
        inArray(account.accountId, githubIds),
      ),
    );
  return rows.map(({ githubId, ...profile }) => ({ githubId, user: profile }));
}
