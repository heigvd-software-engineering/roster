import { mcp } from "@better-auth/mcp";
import type { D1Database } from "@cloudflare/workers-types";
import { getDb } from "@roster/db";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { jwt } from "better-auth/plugins/jwt";
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

/** The adapter is overridable for one caller only: `better-auth.config.ts`,
 *  where the schema CLI builds this config to enumerate tables. The Drizzle
 *  adapter validates every model against the schema object as it constructs, so
 *  a plugin that adds tables cannot be generated through it — the tables do not
 *  exist until the generator writes them. Runtime always uses the default. */
type AuthOverrides = { database?: BetterAuthOptions["database"] };

export function createAuth(env: AuthEnv, overrides: AuthOverrides = {}) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database:
      overrides.database ??
      drizzleAdapter(getDb(env.DB), { provider: "sqlite" }),
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
      // Signing keys and /jwks for the tokens `mcp()` issues. Required by the
      // MCP plugin, and unrelated to the edu-ID sign-in below: it signs OUR
      // tokens, it does not verify SWITCH's.
      jwt(),
      // roster as an OAuth 2.1 authorization server, so a teacher's assistant
      // can hold a credential of its own instead of borrowing their cookie.
      // This IS the provider — authorize, token, userinfo, jwks, registration
      // and the two discovery documents all arrive with it.
      // The cast is `exactOptionalPropertyTypes` (from @tsconfig/strictest)
      // meeting an upstream inference, not a shape mismatch. The provider's
      // endpoint metadata is a union of object literals where only some carry
      // `schema.items`, so TypeScript infers `items?: undefined` on the rest —
      // assignable to `items?: {…}` under normal strictness, refused under
      // exact-optional. Everything else about the plugin checks, and the runtime
      // shape is what better-call expects. Remove when upstream stops inferring
      // the undefined, or the day this file needs a second cast — that would
      // mean the mismatch is real.
      mcp({
        // The audience every issued token is bound to (RFC 8707/9728), and what
        // the protected resource metadata publishes. A token minted here is for
        // this and refused elsewhere, which is decision #8 written into the
        // token rather than left to routing alone.
        resource: `${env.BETTER_AUTH_URL}/mcp`,
        // The SPA renders its login in place at any URL (see the Auth guard),
        // so the provider's "you are not signed in" redirect goes to the root
        // and the plugin resumes the authorization once a session appears.
        loginPage: "/",
        consentPage: "/oauth/consent",
        // Decision #13: two scopes, mirroring the phase boundary. Phase 1 tools
        // read; the write scope exists so phase 2 must ask for it on a fresh
        // consent screen rather than riding a grant a teacher already gave.
        scopes: ["roster:read", "roster:write"],
        clientRegistrationDefaultScopes: ["roster:read"],
        clientRegistrationAllowedScopes: ["roster:read", "roster:write"],
        // Decision #6: clients register themselves, unauthenticated — a CLI has
        // no session to present. A registration grants nothing on its own: no
        // access exists until a teacher signs in with edu-ID and consents.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationRequirePKCE: true,
        // Decision #12: the token lasts as long as a browser session (7 days)
        // and nothing renews it. `refresh_token` is LISTED yet inert, and the
        // distinction matters: the MCP SDK registers every client with
        // grant_types ["authorization_code","refresh_token"], and refusing
        // the pair refuses every client built on it ("unsupported grant_type
        // refresh_token", found by 9.10's first real client). What actually
        // forbids refresh tokens is the provider's own issuance gate — a
        // refresh token exists only when the granted scopes include
        // `offline_access` — and offline_access is not in `scopes` below, so
        // it can never be granted. The grant is a door with no key behind it.
        accessTokenExpiresIn: 60 * 60 * 24 * 7,
        grantTypes: ["authorization_code", "refresh_token"],
      }) as BetterAuthPlugin,
      genericOAuth({
        config: [
          {
            providerId: "switch",
            // Endpoints explicitly, not `discoveryUrl`. Better Auth 1.7 moved
            // discovery from the provider's methods (1.6: fetched during a
            // sign-in) into plugin `init`, which runs on every auth context —
            // and roster builds one per request. Left on discovery, every
            // authenticated request would fetch SWITCH's well-known document
            // first, and an unreachable SWITCH would throw at init and 500 the
            // whole API, not just sign-in. These four URLs are what that
            // document returns; they belong to the issuer and move with it.
            authorizationUrl: `${env.EDUID_ISSUER}/idp/profile/oidc/authorize`,
            tokenUrl: `${env.EDUID_ISSUER}/idp/profile/oidc/token`,
            userInfoUrl: `${env.EDUID_ISSUER}/idp/profile/oidc/userinfo`,
            // The account namespace 1.7 pairs with the subject claim. Without
            // discovery there is nothing to infer it from, and it must stay
            // byte-stable: SWITCH publishes the issuer with a trailing slash,
            // so match that exactly rather than reusing EDUID_ISSUER as-is.
            accountIssuer: `${env.EDUID_ISSUER}/`,
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
