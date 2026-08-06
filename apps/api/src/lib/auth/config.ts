import type { D1Database } from "@cloudflare/workers-types";
import { getDb } from "@roster/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { buildSessionPayload } from "./session-payload";
import { requireEduIdSignIn } from "./sign-in-guard";

// SWITCH edu-ID claims, identity only. The registry audience is HES-SO
// (academic login), so the `email` claim is the professional address and the
// swissEduID* affiliation claims are gone from the registration. Requested for
// both `userinfo` (Better Auth reads that endpoint) and `id_token`.
const SWITCH_CLAIMS = {
  name: { essential: true },
  given_name: { essential: true },
  family_name: { essential: true },
  email: { essential: true },
} as const;

// Exactly what Better Auth needs: the D1 binding plus config and secrets
// (secrets come from .dev.vars or `wrangler secret`, not wrangler.jsonc). Kept
// apart from CloudflareBindings so unrelated bindings like ASSETS stay out.
export type AuthEnv = {
  DB: D1Database;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  EDUID_ISSUER: string;
  EDUID_CLIENT_ID: string;
  EDUID_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  /** Public App slug (install URL), delivered to the SPA via /api/me. */
  GITHUB_APP_SLUG: string;
  /** Comma-separated super-admin emails (edu-ID). Optional on purpose: unset
   *  means no admins, so class creation fails closed. Public config like the
   *  slug. */
  SUPER_ADMIN_EMAILS?: string;
};

/** The Better Auth instance type. The web client infers the session shape from
 * it, including `customSession`'s `githubLinked` field. */
export type Auth = ReturnType<typeof createAuth>;

export function createAuth(env: AuthEnv) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(env.DB), { provider: "sqlite" }),
    session: {
      // Better Auth gates sensitive ops (unlink-account, delete-user,
      // list-sessions) behind a fresh session: with the default 24h freshAge,
      // an older session gets 403 SESSION_NOT_FRESH. Unlinking GitHub to
      // re-link another account is a normal correction, and no password is at
      // stake (edu-ID and GitHub only), so re-authing through SWITCH OIDC buys
      // nothing. 0 disables the check; a valid session is still required.
      freshAge: 0,
    },
    // The edu-ID names, stored on the user row at sign-in (mapped from
    // `given_name`/`family_name` in mapProfileToUser below).
    user: {
      additionalFields: {
        firstName: { type: "string", required: false },
        lastName: { type: "string", required: false },
      },
    },
    // Sign-in is edu-ID only; GitHub is a linked account, never an identity.
    // Three things enforce that, and all three are needed:
    //   1. `disableSignUp`: a GitHub sign-in may not mint a user whose email
    //      GitHub attests instead of SWITCH (email carries privilege via
    //      SUPER_ADMIN_EMAILS).
    //   2. `hooks.before` (requireEduIdSignIn): disableSignUp stops only the
    //      create, and an existing linked account still signs in through
    //      /sign-in/social. The hook closes that door.
    //   3. `disableImplicitLinking` below, the third way in.
    // GitHub links to an existing edu-ID user via `authClient.linkSocial`.
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        disableSignUp: true,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        // The edu-ID email (e.g. hotmail) differs from the GitHub email, and we
        // link to the session user anyway, so don't require matching emails.
        allowDifferentEmails: true,
        // Better Auth refuses to link accounts from providers not listed here
        // ("untrusted provider"). GitHub is user-initiated via linkSocial.
        trustedProviders: ["github"],
        // Implicit linking is Better Auth matching an incoming OAuth profile to
        // an existing user by email and linking it unasked. With `github`
        // trusted, only the local user's `emailVerified` stands in the way, and
        // SWITCH sets it, so a GitHub account holding a verified address equal
        // to someone's edu-ID email would link to their user and sign in as
        // them. Every link here is an explicit `linkSocial` from an existing
        // session, and that path is unaffected: Better Auth's callback returns
        // from its `link` branch before any of this runs.
        disableImplicitLinking: true,
      },
    },
    // The one place a request is refused before Better Auth routes it.
    hooks: { before: requireEduIdSignIn },
    // Better Auth's limiter defaults to on in production and keeps counters in
    // memory, per isolate, so on Workers it holds no real ceiling and disagrees
    // with itself between isolates. The Cloudflare rate-limiter binding does
    // the job (routes/auth.ts); off here keeps one answer to "what limits
    // /api/auth" instead of two that refuse with different bodies.
    rateLimit: { enabled: false },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "switch",
            discoveryUrl: `${env.EDUID_ISSUER}/.well-known/openid-configuration`,
            clientId: env.EDUID_CLIENT_ID,
            clientSecret: env.EDUID_CLIENT_SECRET,
            // The registry's contract: `openid` plus SWITCH's userinfo scope.
            // `profile`/`email` stay for the standard claims; SWITCH
            // deprecated `<issuer>/authz/User.Read` along with the affiliation
            // claims.
            scopes: [
              "openid",
              "profile",
              "email",
              "https://eduid.ch/scope/userinfo.read",
            ],
            // SWITCH edu-ID advertises code_challenge_methods_supported:
            // ["S256"].
            pkce: true,
            // Ask SWITCH to release the identity claims into the id_token too.
            authorizationUrlParams: {
              claims: JSON.stringify({
                userinfo: SWITCH_CLAIMS,
                id_token: SWITCH_CLAIMS,
              }),
            },
            // Persist the edu-ID names on the user row. `overrideUserInfo`
            // re-applies them at every sign-in, so existing users pick the new
            // fields up at their next login.
            mapProfileToUser: (profile) => {
              const { given_name: givenName, family_name: familyName } =
                profile as { given_name?: unknown; family_name?: unknown };
              // Cast: genericOAuth types the return against the base user
              // fields only, so firstName/lastName from `user.additionalFields`
              // work at runtime but stay invisible to this signature.
              return {
                firstName:
                  typeof givenName === "string" ? givenName : undefined,
                lastName:
                  typeof familyName === "string" ? familyName : undefined,
              } as { name?: string };
            },
            overrideUserInfo: true,
          },
        ],
      }),
      // Every session read: expose `githubLinked` for the onboarding gate, and
      // resolve an invitation this user accepted since we last saw them. Both
      // live in `buildSessionPayload` so they can be tested; see
      // `accepted-invitation-heal` for why a session read is the trigger and
      // why it is affordable on a hot path.
      customSession(({ user, session }) =>
        buildSessionPayload(env, user, session),
      ),
    ],
  });
}
