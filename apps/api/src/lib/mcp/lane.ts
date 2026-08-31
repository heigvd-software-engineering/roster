import type { ExecutionContext } from "@cloudflare/workers-types";
import type { McpServer } from "@modelcontextprotocol/server";
import { getDb, oauthConsent, user } from "@roster/db";
import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppBindings, Env } from "../../env";
import type { McpToolSpec } from "../../mcp/tools";
import { mcpTools } from "../../mcp/tools";
import { consentScopes } from "../auth/consent-scopes";
import { READ_SCOPE, verifyMcpBearer } from "./verify";

/**
 * The lane behind `/mcp` — a named unit (AGENTS 11). Order of the checks is
 * the design:
 *
 * 1. `verifyMcpBearer` (./verify.ts — in-process JWKS, since a Worker may
 *    not fetch its own hostname) verifies the bearer token: signature,
 *    issuer, audience (`<origin>/mcp`, decision #8), expiry and scope — and
 *    answers unauthenticated requests with the RFC 9728 `WWW-Authenticate`
 *    challenge an MCP client starts its authorization from.
 * 2. The consent row is re-read on EVERY call (decision #12). The token may
 *    verify for its whole seven days; the row is the teacher's standing
 *    grant, and deleting it stops the next call, not the next token.
 * 3. The subject resolves to a user row — the actor.
 *
 * Only then does the MCP handler see the request. A tool re-enters the API
 * through `app.request(path, init, { ...env, MCP_ACTOR: actor }, ctx)`: the
 * env of an internal call, the one channel an external request cannot write
 * to (test 9.1). The lane receives `app` from the mount point and never
 * imports it from `index.ts` — that would be a circular import.
 */

export { READ_SCOPE } from "./verify";

/**
 * The grant is gone or was never whole: the JSON-RPC 401 + challenge shape
 * `requireMcpAuth` uses for a bad token, so a client reacts the same way to a
 * withdrawn consent as to an expired token — it starts a fresh authorization.
 */
const staleGrant = (env: AppBindings, description: string) => {
  console.warn("mcp stale grant:", description); // 9.10 diagnostics
  return staleGrantResponse(env, description);
};
const staleGrantResponse = (env: AppBindings, description: string) =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: description },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate":
          `Bearer error="invalid_token", error_description="${description}", ` +
          `resource_metadata="${new URL(env.BETTER_AUTH_URL).origin}/.well-known/oauth-protected-resource"`,
      },
    },
  );

/**
 * One tool call: the endpoint the table names, called the way any client
 * would, as the injected actor. A non-2xx becomes an MCP tool error carrying
 * the endpoint's own error code (1.6): a tool that returns a failure body as
 * plain content hands a model a JSON blob it will happily narrate as an
 * answer — a refusal must read as a refusal. Exported for test 9.5, which
 * holds this equal to a direct endpoint call.
 */
export async function runTool(
  app: Hono<Env>,
  env: AppBindings,
  ctx: ExecutionContext | undefined,
  tool: McpToolSpec,
  input: Record<string, string>,
) {
  const res = await app.request(
    tool.path(input),
    { method: tool.method },
    env,
    ctx as Parameters<typeof app.request>[3],
  );
  const text = await res.text();
  if (!res.ok) {
    return {
      content: [
        {
          type: "text" as const,
          text: `The request was refused (HTTP ${res.status}): ${text}`,
        },
      ],
      isError: true,
    };
  }
  return { content: [{ type: "text" as const, text }] };
}

/**
 * The MCP SDK arrives by dynamic import, once, at the first /mcp request.
 * Not laziness for its own sake: bundled statically, the SDK's core module
 * lands UNWRAPPED at the top of the Worker bundle and runs its zod schemas
 * (`lazy(...)`) before esbuild's deferred init has constructed zod's classes
 * — "ZodLazy is not a constructor", and the whole Worker fails to start,
 * every route included. Deferred to request time, every top-level init has
 * long finished. The 0.1 spike never saw this: without better-auth in the
 * graph, nothing forced zod into a wrapped module.
 */
const sdk = () => import("@modelcontextprotocol/server");

/** One MCP server per request — stateless (R7), tools from the table alone. */
async function buildServer(
  app: Hono<Env>,
  env: AppBindings,
  ctx: ExecutionContext | undefined,
): Promise<McpServer> {
  const { McpServer } = await sdk();
  const server = new McpServer({ name: "roster", version: "1.0.0" });
  for (const tool of mcpTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: z.object(tool.inputSchema),
      },
      (input) => runTool(app, env, ctx, tool, input as Record<string, string>),
    );
  }
  return server;
}

/** The `/mcp` entry point; `app` arrives from the mount, never by import. */
export function handleMcp(app: Hono<Env>, c: Context<Env>): Promise<Response> {
  const env = c.env;
  // `app.request`-driven tests have no ExecutionContext and Hono throws on
  // the accessor rather than returning undefined; in workerd it always exists.
  let ctx: ExecutionContext | undefined;
  try {
    ctx = c.executionCtx as unknown as ExecutionContext;
  } catch {
    ctx = undefined;
  }
  const run = async (request: Request): Promise<Response> => {
    const verified = await verifyMcpBearer(app, env, request);
    if (verified instanceof Response) {
      return verified;
    }
    const { claims } = verified;
    // The custom claims, through one typed view: JWTPayload only carries
    // them in its index signature, and strictest TS forbids dotting into
    // that while biome dislikes bracket access. Named here once.
    const {
      client_id: clientIdClaim,
      azp,
      scope,
    } = claims as { client_id?: unknown; azp?: unknown; scope?: unknown };
    const sub = typeof claims.sub === "string" ? claims.sub : undefined;
    const clientId =
      typeof clientIdClaim === "string"
        ? clientIdClaim
        : typeof azp === "string"
          ? azp
          : undefined;
    if (!sub || !clientId) {
      return staleGrant(env, "token carries no subject or client");
    }

    const db = getDb(env.DB);
    const consent = await db
      .select({ scopes: oauthConsent.scopes })
      .from(oauthConsent)
      .where(
        and(eq(oauthConsent.clientId, clientId), eq(oauthConsent.userId, sub)),
      )
      .limit(1);
    const grantedScopes = consentScopes(consent[0]?.scopes);
    if (!grantedScopes.includes(READ_SCOPE)) {
      return staleGrant(env, "consent was withdrawn");
    }

    const actorRows = await db
      .select()
      .from(user)
      .where(eq(user.id, sub))
      .limit(1);
    const actor = actorRows[0];
    if (!actor) {
      return staleGrant(env, "the granting account no longer exists");
    }

    const { createMcpHandler } = await sdk();
    const handler = createMcpHandler(() =>
      buildServer(app, { ...env, MCP_ACTOR: actor }, ctx),
    );
    const authorization = request.headers.get("authorization") ?? "";
    return handler.fetch(request, {
      authInfo: {
        token: authorization.replace(/^Bearer\s+/i, ""),
        clientId,
        scopes: typeof scope === "string" ? scope.split(" ") : [],
        ...(typeof claims.exp === "number" ? { expiresAt: claims.exp } : {}),
      },
    });
  };
  return run(c.req.raw);
}
