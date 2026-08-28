import { getDb, oauthAccessToken, oauthClient, oauthConsent } from "@roster/db";
import { and, isNull, lt, notInArray } from "drizzle-orm";
import type { AuthEnv } from "./config";

/** How long a registration may sit unused before it is swept. Long enough that
 *  a teacher who registers an assistant and finishes the flow tomorrow keeps
 *  it; short enough that spam does not accumulate. */
const UNCLAIMED_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Delete client registrations that never became an actual grant.
 *
 * Registration is open — a CLI has no session to present — so anyone can create
 * rows here. What they cannot create is access: nothing works until a teacher
 * signs in with edu-ID and consents. So the exposure is junk rows, and this is
 * what bounds them.
 *
 * Lazy on purpose. roster has no cron trigger and no scheduled Worker, and
 * adding one for housekeeping would be new infrastructure for a table that only
 * grows when someone is abusing it. Running here means the sweep happens
 * exactly when rows are being created, on a path that is already rate-limited.
 *
 * A registration is "claimed" once it has a consent or a token: those are the
 * two things a teacher's approval produces. Anything older than a day with
 * neither is a client nobody ever finished connecting.
 */
export async function pruneUnclaimedClients(env: AuthEnv): Promise<void> {
  const db = getDb(env.DB);
  const cutoff = new Date(Date.now() - UNCLAIMED_AFTER_MS);

  const [consented, tokened] = await Promise.all([
    db.select({ clientId: oauthConsent.clientId }).from(oauthConsent),
    db.select({ clientId: oauthAccessToken.clientId }).from(oauthAccessToken),
  ]);
  const claimed = [
    ...new Set(
      [...consented, ...tokened]
        .map((row) => row.clientId)
        .filter((id): id is string => id !== null),
    ),
  ];

  await db.delete(oauthClient).where(
    and(
      lt(oauthClient.createdAt, cutoff),
      // A row with no createdAt cannot be aged, so it is left alone rather
      // than guessed about.
      claimed.length > 0
        ? notInArray(oauthClient.clientId, claimed)
        : undefined,
      isNull(oauthClient.userId),
    ),
  );
}
