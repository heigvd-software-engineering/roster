import { APIError, createAuthMiddleware } from "better-auth/api";

/** The provider id SWITCH edu-ID is registered under (`plugins.genericOAuth`
 *  in config.ts). Better Auth 1.7 serves generic providers from the same
 *  endpoint as the built-in social ones, so this id — not a path — is what
 *  tells edu-ID apart from GitHub. */
const EDU_ID_PROVIDER = "switch";
const SOCIAL_SIGN_IN = "/sign-in/social";

/**
 * SWITCH edu-ID is the only identity. Anything else that can mint a session is
 * refused here, at Better Auth's one `hooks.before` slot, which is also the
 * only place that sees its route table: it owns `/api/auth/*` wholesale and
 * there is no route module to hang this on.
 *
 * The rule that needs enforcing is GitHub's. `socialProviders.github` has to
 * exist for `authClient.linkSocial` to work, and configuring it also registers
 * the public `POST /api/auth/sign-in/social` for that provider.
 * `disableSignUp: true` does not close that door; it only refuses to create a
 * user. For anyone who has already linked GitHub (everyone past onboarding) the
 * sign-in callback finds their account by (providerId, accountId), takes the
 * "linked account" branch, and mints a session with SWITCH never involved. That
 * inverts the identity model: a borrowed GitHub account becomes a full roster
 * session as its owner, teacher or super admin, with none of the institution's
 * controls on the edu-ID in between.
 *
 * Written as an allowlist rather than "refuse GitHub", because what is
 * protected is the claim "sign-in is edu-ID only", not one provider's name.
 * Better Auth ships `/sign-in/email`, `/sign-in/magic-link`,
 * `/sign-in/username` and more behind plugins; a denylist would let any of them
 * through the day someone enables one, silently, and no test could notice.
 *
 * **Better Auth 1.7 moved where the line is drawn.** `/sign-in/oauth2` is gone:
 * generic providers are signed in through `/sign-in/social`, the very endpoint
 * this guard existed to close. So the allowlist can no longer be a path — it is
 * that one endpoint *and* the edu-ID provider id, read from the request body.
 * Every other provider on it, GitHub included, is refused exactly as before.
 *
 * Linking is unaffected: `linkSocial` posts to `/link-social` (session
 * required) and its callback returns from the `link` branch before the sign-in
 * machinery runs. See better-auth's `api/routes/callback`.
 */
export const requireEduIdSignIn = createAuthMiddleware(async (ctx) => {
  if (!ctx.path.startsWith("/sign-in/")) return;

  const provider = (ctx.body as { provider?: unknown } | undefined)?.provider;
  if (ctx.path === SOCIAL_SIGN_IN && provider === EDU_ID_PROVIDER) return;

  throw new APIError("FORBIDDEN", {
    code: "EDU_ID_IS_THE_ONLY_SIGN_IN",
    message: "Sign in with SWITCH edu-ID; GitHub can only be linked.",
  });
});
