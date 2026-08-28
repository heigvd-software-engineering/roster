import { expect, test } from "vitest";
import { requireEduIdSignIn } from "../src/lib/auth/sign-in-guard";

// The identity model in one test file: edu-ID is the only way to a session, and
// GitHub may be linked but never signed in with. Better Auth's own
// `disableSignUp` does not carry this. It only refuses to create a user, and an
// already-linked account still signs in through /sign-in/social.
//
// Since 1.7 that endpoint serves edu-ID too (generic providers lost their own
// /sign-in/oauth2), so these tests pass a body: the provider id is now the
// difference between the one way in and the door this guard exists to shut.

/** The middleware reads `path` and `body`; a literal is the whole ctx. */
const run = (path: string, body?: Record<string, unknown>) =>
  (requireEduIdSignIn as unknown as (ctx: unknown) => Promise<unknown>)({
    path,
    body,
  });

test("refuses a GitHub sign-in, with a 403 carrying its own code", async () => {
  await expect(
    run("/sign-in/social", { provider: "github" }),
  ).rejects.toMatchObject({
    status: "FORBIDDEN",
    body: { code: "EDU_ID_IS_THE_ONLY_SIGN_IN" },
    message: expect.stringContaining("GitHub can only be linked"),
  });
});

test("refuses the shared endpoint with no provider, or an unknown one", async () => {
  // A missing body must not read as "allowed": the guard opens for one id only.
  await expect(run("/sign-in/social")).rejects.toThrow();
  await expect(run("/sign-in/social", {})).rejects.toThrow();
  await expect(run("/sign-in/social", { provider: "google" })).rejects.toThrow();
});

test("refuses sign-in routes we don't ship today — the allowlist's whole point", async () => {
  // Enabling a Better Auth plugin must not silently open a second door.
  await expect(run("/sign-in/email")).rejects.toThrow();
  await expect(run("/sign-in/magic-link")).rejects.toThrow();
  await expect(run("/sign-in/username")).rejects.toThrow();
  // Gone in 1.7. If a future version brings it back, it is not the way in.
  await expect(run("/sign-in/oauth2", { provider: "switch" })).rejects.toThrow();
});

test("lets the edu-ID sign-in through", async () => {
  await expect(
    run("/sign-in/social", { provider: "switch" }),
  ).resolves.toBeUndefined();
});

test("lets LINKING through — that is the supported path", async () => {
  await expect(run("/link-social")).resolves.toBeUndefined();
});

test("leaves every other Better Auth route alone", async () => {
  await expect(run("/get-session")).resolves.toBeUndefined();
  await expect(run("/sign-out")).resolves.toBeUndefined();
  await expect(run("/callback/github")).resolves.toBeUndefined();
});
