import type { D1Database } from "@cloudflare/workers-types";
import { getDb } from "@roster/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { buildSessionPayload } from "./session-payload";
import { requireEduIdSignIn } from "./sign-in-guard";

// SWITCH edu-ID claims to request — identity only. The client's registry
// audience is HES-SO (academic login): the `email` claim IS the professional
// address, so the swissEduID* affiliation claims are gone from the
// registration and must not be requested. Requested for both `userinfo`
// (Better Auth reads the userinfo endpoint) and `id_token`.
const SWITCH_CLAIMS = {
  name: { essential: true },
  given_name: { essential: true },
  family_name: { essential: true },
  email: { essential: true },
} as const;

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
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  /** Public App slug (install URL) — delivered to the SPA via /api/me. */
  GITHUB_APP_SLUG: string;
  /** Comma-separated super-admin emails (edu-ID). Optional on purpose:
   *  empty/unset = no admins — class creation fails closed. Public
   *  config, like the slug. */
  SUPER_ADMIN_EMAILS?: string;
};

/** The Better Auth instance type — used by the web client to infer the session
 * shape (incl. the `customSession` `githubLinked` field). */
export type Auth = ReturnType<typeof createAuth>;

export function createAuth(env: AuthEnv) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(env.DB), { provider: "sqlite" }),
    session: {
      // Better Auth gates "sensitive" ops (unlink-account, delete-user,
      // list-sessions) behind a FRESH session: with the default freshAge of
      // 24h, any older session gets 403 SESSION_NOT_FRESH. Here that only hurts
      // — unlinking GitHub to re-link a different account is a normal
      // correction, and there's no password to protect (edu-ID + GitHub only),
      // so re-authing through SWITCH OIDC just to unlink buys nothing. 0
      // disables the freshness check entirely (a valid session still required).
      freshAge: 0,
    },
    // True SWITCH edu-ID identity, stored on the user row at sign-in (mapped
    // from `given_name`/`family_name` in mapProfileToUser below).
    user: {
      additionalFields: {
        firstName: { type: "string", required: false },
        lastName: { type: "string", required: false },
      },
    },
    // Sign-in is edu-ID ONLY — GitHub is a linked account, never an identity.
    // THREE things enforce that, and all three are needed:
    //   1. `disableSignUp` — a GitHub sign-in may not MINT a user whose email
    //      GitHub attests instead of SWITCH (email carries privilege via
    //      SUPER_ADMIN_EMAILS).
    //   2. `hooks.before` (requireEduIdSignIn) — but disableSignUp stops only
    //      the create; an EXISTING linked account still signs in through
    //      /sign-in/social. The hook is what actually closes that door.
    //   3. `disableImplicitLinking` below — the third way in.
    // GitHub is linked to an existing (edu-ID) user via `authClient.linkSocial`.
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
        // edu-ID email (e.g. hotmail) differs from the GitHub email, and we link
        // to the current session user anyway — so don't require matching emails.
        allowDifferentEmails: true,
        // Better Auth refuses to link accounts from providers not listed here
        // ("untrusted provider"). GitHub is user-initiated via linkSocial.
        trustedProviders: ["github"],
        // IMPLICIT linking is Better Auth matching an incoming OAuth profile to
        // an existing user BY EMAIL and linking it unasked. With `github`
        // trusted, the only thing standing in its way is the local user's
        // `emailVerified` — which SWITCH sets — so a GitHub account holding a
        // verified address equal to someone's edu-ID email would be linked to
        // THEIR user and signed in as them. Nothing here wants that: every link
        // in this app is an explicit `linkSocial` from an existing session, and
        // that path is unaffected (Better Auth's callback returns from its
        // `link` branch before any of this runs).
        disableImplicitLinking: true,
      },
    },
    // The one place a request is refused before Better Auth routes it.
    hooks: { before: requireEduIdSignIn },
    // Better Auth's own limiter defaults to ON in production, storing counters
    // in MEMORY — per-isolate, so on Workers it neither holds a real ceiling
    // nor agrees with itself between isolates. The Cloudflare rate-limiter
    // binding does the job properly (routes/auth.ts); turning this off keeps
    // ONE answer to "what limits /api/auth", instead of two that refuse with
    // different bodies.
    rateLimit: { enabled: false },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "switch",
            discoveryUrl: `${env.EDUID_ISSUER}/.well-known/openid-configuration`,
            clientId: env.EDUID_CLIENT_ID,
            clientSecret: env.EDUID_CLIENT_SECRET,
            // The registry's current contract: clients request `openid` +
            // SWITCH's userinfo scope. `profile`/`email` stay for the
            // standard claims; the old `<issuer>/authz/User.Read` scope is
            // DEPRECATED by SWITCH and gone with the affiliation claims.
            scopes: [
              "openid",
              "profile",
              "email",
              "https://eduid.ch/scope/userinfo.read",
            ],
            // SWITCH edu-ID advertises code_challenge_methods_supported: ["S256"].
            pkce: true,
            // Ask SWITCH to release the identity claims into the id_token too.
            authorizationUrlParams: {
              claims: JSON.stringify({
                userinfo: SWITCH_CLAIMS,
                id_token: SWITCH_CLAIMS,
              }),
            },
            // Persist the true edu-ID names on the user row; re-applied on
            // every sign-in (overrideUserInfo) so existing users pick the
            // new fields up at their next login.
            mapProfileToUser: (profile) => {
              const { given_name: givenName, family_name: familyName } =
                profile as { given_name?: unknown; family_name?: unknown };
              // Cast: genericOAuth types the return against the BASE user
              // fields only — `user.additionalFields` (firstName/lastName)
              // are accepted at runtime but invisible to this signature.
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
      // resolve an invitation this user has accepted since we last saw them.
      //
      // Reading the session is the right trigger for the heal because GitHub
      // never tells us when someone accepts — the only signal we get is the
      // person showing up. Per READ rather than at sign-in alone matters for a
      // teacher who was already signed in when they accepted; they would
      // otherwise keep showing as invited until their next login.
      //
      // Both live in `buildSessionPayload` so they can be tested; see there for
      // why this is affordable on a hot path.
      customSession(({ user, session }) =>
        buildSessionPayload(env, user, session),
      ),
    ],
  });
}
