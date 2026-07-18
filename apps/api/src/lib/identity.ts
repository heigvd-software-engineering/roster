import { account, type getDb, user } from "@labs/db";
import { and, eq, inArray } from "drizzle-orm";
import { readAffiliationEmails } from "./auth/switch-claims";

/**
 * WHO people are, across the three identity systems this app straddles:
 *
 * - a **labs user** (`user.id`) — created by Better Auth at sign-in
 * - a **GitHub account** (`account.accountId` for provider `github`) — what
 *   every org, team and repo API speaks in, and what `class_members` stores
 * - a **SWITCH edu-ID** (provider `switch`) — where the real name and the
 *   institutional affiliation emails come from
 *
 * Nothing here authorizes anything: it answers "who is this" and "what may we
 * say about them", never "may they do this". Class-scoped permission lives in
 * `class-scope.ts`.
 */

type Db = ReturnType<typeof getDb>;

/**
 * A labs user's GitHub account id, in the two forms the codebase needs: `ghId`
 * as a NUMBER for GitHub APIs, `githubId` as the STRING stored in
 * `class_members.githubId`.
 *
 * `null` when there is no linked GitHub account — or when the stored id is not
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
 * The labs users behind a set of GitHub ids, in the ONE shape allowed to leave
 * the server for other class members: display-name fields plus affiliation
 * (professional) emails.
 *
 * The private login email NEVER rides here — `/api/me` alone may show it, and
 * only to its owner. Keyed by github id because that is what the caller has:
 * rosters and member rows speak GitHub, so the client correlates on it.
 */
export async function profilesByGithubId(db: Db, githubIds: string[]) {
  if (githubIds.length === 0) return [];
  const rows = await db
    .select({
      githubId: account.accountId,
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      name: user.name,
    })
    .from(account)
    .innerJoin(user, eq(account.userId, user.id))
    .where(
      and(
        eq(account.providerId, "github"),
        inArray(account.accountId, githubIds),
      ),
    );
  if (rows.length === 0) return [];
  const affiliations = await affiliationsByUserId(
    db,
    rows.map((r) => r.userId),
  );
  return rows.map(({ githubId, userId, ...names }) => ({
    githubId,
    user: { ...names, affiliations: affiliations.get(userId) ?? [] },
  }));
}

/**
 * Affiliation (professional) emails for many users at once, decoded from each
 * stored SWITCH id_token — so they are as fresh as that user's last sign-in and
 * are never persisted separately. The shared piece of every people payload.
 */
export async function affiliationsByUserId(
  db: Db,
  userIds: string[],
): Promise<Map<string, string[]>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: account.userId, idToken: account.idToken })
    .from(account)
    .where(
      and(eq(account.providerId, "switch"), inArray(account.userId, userIds)),
    );
  return new Map(
    rows.map((r) => [
      r.userId,
      r.idToken ? readAffiliationEmails(r.idToken) : [],
    ]),
  );
}
