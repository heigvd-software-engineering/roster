import type { InferResponseType } from "hono/client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { useMessages } from "~/contexts/message-context";
import { api, useApi } from "~/lib/api";
import {
  linkSocial as authLinkSocial,
  signIn as authSignIn,
  signOut as authSignOut,
  unlinkAccount,
} from "~/lib/auth";

// The /api/me response, inferred. The context re-exposes its fields raw:
// user = the Drizzle user row, github = the live GitHub profile.
type Me = InferResponseType<typeof api.api.me.$get, 200>;

type AuthValue = Pick<Me, "user" | "github" | "githubAppInstallUrl"> & {
  /** True until the first /api/me resolves. */
  isLoading: boolean;
  /** A session exists (signed in). */
  authed: boolean;
  /** The GitHub link's live state. "unknown" means GitHub is unreachable; the
   *  gate fails open on it (warning banner, no onboarding redirect). */
  githubState: Me["githubState"];
  /** GitHub is proven usable right now (`githubState === "linked"`). */
  githubLinked: boolean;
  /** Config-listed super admin; shows the admin zone. */
  isSuperAdmin: boolean;
  /** May create classes (admin, or granted); shows "New class". */
  canCreateClasses: boolean;
  /** Start edu-ID (SWITCH) sign-in. Failures surface on the message strip,
   *  never as a button that silently does nothing. */
  signIn: () => Promise<void>;
  /** Sign out, then revalidate /api/me so the UI reflects it immediately. */
  signOut: () => Promise<void>;
  /** Start GitHub account linking (redirects to GitHub). */
  linkGithub: (callbackURL?: string) => void;
  /** Unlink GitHub, then revalidate; the gate routes to onboarding. */
  unlinkGithub: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

/**
 * One source of truth for identity + auth, fetched once from /api/me and shared
 * across the app (gate, header, pages) via useAuth(). Wraps the auth actions so
 * callers never import from two places.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, mutate } = useApi(api.api.me);
  const { push } = useMessages();

  // GitHub couldn't answer the boot fetch: say so once, in the global strip.
  // The app stays usable (fail open) because the server still authorizes
  // every write live, per action; only the display may be missing or stale.
  const githubState = data?.githubState ?? "unlinked";
  useEffect(() => {
    if (githubState === "unknown") {
      push("GitHub is unreachable right now, so some data may be missing.", {
        variant: "warning",
      });
    }
  }, [githubState, push]);

  const value = useMemo<AuthValue>(
    () => ({
      isLoading,
      authed: (data?.user ?? null) !== null,
      user: data?.user ?? null,
      github: data?.github ?? null,
      githubAppInstallUrl: data?.githubAppInstallUrl ?? "",
      githubState,
      githubLinked: githubState === "linked",
      isSuperAdmin: data?.isSuperAdmin ?? false,
      canCreateClasses: data?.canCreateClasses ?? false,
      signIn: async () => {
        // Return to the page the user was on. The login renders in place
        // (Auth guard), so deep links survive (e.g. a class join link, which
        // carries query params).
        try {
          const { error } = await authSignIn.social({
            provider: "switch",
            callbackURL:
              window.location.pathname +
              window.location.search +
              window.location.hash,
          });
          // On success the browser navigates to edu-ID, so an error here means
          // the sign-in POST itself failed (API down, network). Say so: a
          // silent dead button reads as "app is broken".
          if (error) throw new Error(error.message ?? "sign-in failed");
        } catch {
          push("Sign-in is unavailable right now. Try again in a moment.", {
            variant: "error",
          });
        }
      },
      signOut: async () => {
        await authSignOut();
        await mutate();
      },
      linkGithub: (callbackURL = "/") => {
        authLinkSocial({
          provider: "github",
          callbackURL,
          // A failed link (e.g. a brand-new GitHub account whose email isn't
          // verified yet → "Unable to get user info") lands back on the
          // onboarding page with a friendly retry, not Better Auth's raw
          // /api/auth/error page.
          errorCallbackURL: `/onboarding/github?error=link_failed&returnTo=${encodeURIComponent(callbackURL)}`,
        });
      },
      unlinkGithub: async () => {
        // 1.7 unlinks by account row id, carried on the session payload.
        if (!data?.githubAccountId) return;
        await unlinkAccount({ accountId: data.githubAccountId });
        await mutate();
      },
    }),
    [data, isLoading, mutate, githubState, push],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Read the shared identity/auth state. Must be used within <AuthProvider>. */
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
