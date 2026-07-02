import type { getDb } from "@labs/db";

type Db = ReturnType<typeof getDb>;

/** The linked GitHub account's stored OAuth token (same lookup `/api/me`
 *  uses), or undefined if the user never linked GitHub. */
export async function githubUserToken(
  db: Db,
  userId: string,
): Promise<string | undefined> {
  const account = await db.query.account.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.userId, userId), eq(a.providerId, "github")),
    columns: { accessToken: true },
  });
  return account?.accessToken ?? undefined;
}
