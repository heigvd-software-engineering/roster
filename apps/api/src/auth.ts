import type { D1Database } from "@cloudflare/workers-types";
import { getDb } from "@labs/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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
};

/** The Hono env for our Worker: `new Hono<Env>()` → `c.env` is AuthEnv. */
export type Env = { Bindings: AuthEnv };

export function createAuth(env: AuthEnv) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(env.DB), { provider: "sqlite" }),
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
    ],
  });
}
