import { getDb, oauthClient, oauthConsent } from "@roster/db";
import { asc, eq } from "drizzle-orm";
import { authedFactory } from "../factory";

/**
 * The teacher's standing grants, shaped for the Connected assistants group in
 * the account menu (plan 1.7a). One endpoint because the stock pair cannot
 * feed the list: `oauth2/get-consents` returns rows with no client name, and
 * `oauth2/public-client` returns no way to batch — this is the join, one
 * fetch, no N+1. Read-only; revoking stays on Better Auth's
 * `oauth2/delete-consent`, whose own session check scopes the delete.
 *
 * `name` stays nullable on purpose: it is the client's self-asserted DCR
 * registration name, and a client that sent none renders as "An assistant"
 * in the SPA — the consent page's own fallback. Nothing here verifies it.
 *
 * Session only. The MCP lane can never reach this: it is not in the tool
 * table (`src/mcp/tools.ts`), and that table is the only door (R9).
 */
export const listAssistants = authedFactory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select({
      id: oauthConsent.id,
      name: oauthClient.name,
      scopes: oauthConsent.scopes,
      createdAt: oauthConsent.createdAt,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, c.get("user").id))
    .orderBy(asc(oauthConsent.createdAt));

  return c.json({
    assistants: rows.map((row) => ({
      ...row,
      // The column is JSON-typed, so Drizzle infers `unknown`. A consent row
      // the provider wrote always holds a string array; anything else would
      // be corruption, and an empty list is the honest rendering of it.
      scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    })),
  });
});
