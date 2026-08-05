import { APIError, createAuthMiddleware } from "better-auth/api";

/** The ONE way in: the generic-OAuth endpoint the `switch` provider is
 *  registered on (`plugins.genericOAuth` in config.ts). */
const EDU_ID_SIGN_IN = "/sign-in/oauth2";

/**
 * SWITCH edu-ID is the only identity. Anything else that can mint a session is
 * refused here, at Better Auth's one `hooks.before` slot — which is also the
 * only place that sees its route table, since it owns `/api/auth/*` wholesale
 * and there is no route module to hang this on.
 *
 * The rule that needs enforcing is GitHub's: `socialProviders.github` has to
 * exist for `authClient.linkSocial` to work, and configuring it also registers
 * the public `POST /api/auth/sign-in/social` for that provider.
 * `disableSignUp: true` does NOT close that door — it only refuses to CREATE a
 * user. For anyone who has already linked GitHub (everyone past onboarding) the
 * sign-in callback finds their account by (providerId, accountId), takes the
 * "linked account" branch, and mints a session with SWITCH never involved. That
 * is the whole identity model inverted: a borrowed GitHub account would be a
 * full roster session as its owner — teacher, super admin — with none of the
 * institution's controls on the edu-ID in between.
 *
 * Written as an ALLOWLIST rather than "refuse GitHub", because the thing being
 * protected is the claim "sign-in is edu-ID only", not one provider's name.
 * Better Auth ships `/sign-in/email`, `/sign-in/magic-link`, `/sign-in/username`
 * and more behind plugins; a denylist would let any of them through the day
 * someone enables one, silently, and no test could notice.
 *
 * Linking is UNAFFECTED. `linkSocial` posts to `/link-social` (session
 * required) and its callback returns from the `link` branch before any of the
 * sign-in machinery — see better-auth's `api/routes/callback`.
 */
export const requireEduIdSignIn = createAuthMiddleware(async (ctx) => {
  if (!ctx.path.startsWith("/sign-in/") || ctx.path === EDU_ID_SIGN_IN) return;
  throw new APIError("FORBIDDEN", {
    code: "EDU_ID_IS_THE_ONLY_SIGN_IN",
    message: "Sign in with SWITCH edu-ID; GitHub can only be linked.",
  });
});
