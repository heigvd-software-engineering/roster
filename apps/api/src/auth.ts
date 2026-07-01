import type { D1Database } from "@cloudflare/workers-types";
import { getDb } from "@labs/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";

// Exactly what Better Auth needs — the D1 binding + config/secrets (secrets come
// from .dev.vars / `wrangler secret`, not wrangler.jsonc). Kept independent of
// the full CloudflareBindings so unrelated bindings (e.g. ASSETS) don't leak in.
export type AuthEnv = {
  DB: D1Database;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  EDUID_ISSUER: string;
  EDUID_CLIENT_ID: string;
  EDUID_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
};

/** The Hono env for our Worker: `new Hono<Env>()` → `c.env` is AuthEnv. */
export type Env = { Bindings: AuthEnv };

/** The Better Auth instance type — used by the web client to infer the session
 * shape (incl. the `customSession` `githubLinked` field). */
export type Auth = ReturnType<typeof createAuth>;

export function createAuth(env: AuthEnv) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(env.DB), { provider: "sqlite" }),
    // GitHub is linked to an existing (edu-ID) user via `authClient.linkSocial`.
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        // edu-ID email (e.g. hotmail) differs from the GitHub email, and we link
        // to the current session user anyway — so don't require matching emails.
        allowDifferentEmails: true,
        // Better Auth refuses to link accounts from providers not listed here
        // ("untrusted provider"). GitHub is user-initiated via linkSocial.
        trustedProviders: ["github"],
      },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "switch",
            discoveryUrl: `${env.EDUID_ISSUER}/.well-known/openid-configuration`,
            clientId: env.EDUID_CLIENT_ID,
            clientSecret: env.EDUID_CLIENT_SECRET,
            // SWITCH edu-ID needs its own authz scope to release the profile
            // (per the working opendidac config), on top of the standard three.
            scopes: [
              "openid",
              "profile",
              "email",
              `${env.EDUID_ISSUER}/authz/User.Read`,
            ],
            // SWITCH edu-ID advertises code_challenge_methods_supported: ["S256"].
            pkce: true,
          },
        ],
      }),
      // Expose `githubLinked` on the session so the onboarding gate can key off
      // it without a separate request. True once a `github` account row exists.
      customSession(async ({ user, session }) => {
        const accounts = await getDb(env.DB).query.account.findMany({
          where: (a, { eq }) => eq(a.userId, user.id),
          columns: { providerId: true },
        });
        const githubLinked = accounts.some((a) => a.providerId === "github");
        return { user, session, githubLinked };
      }),
    ],
  });
}
