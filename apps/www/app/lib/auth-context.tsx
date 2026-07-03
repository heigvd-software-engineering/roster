import { createContext, type ReactNode, useContext, useMemo } from "react";
import { api, useApi } from "~/lib/api";
import {
  linkSocial as authLinkSocial,
  signIn as authSignIn,
  signOut as authSignOut,
  unlinkAccount,
} from "~/lib/auth";

/** The SWITCH/edu-ID identity. */
type Account = {
  name: string;
  email: string;
  /** All edu-ID emails: institutional affiliations + personal. */
  affiliations: string[];
};

/** The linked GitHub identity (live profile). */
type Github = {
  login: string;
  name: string | null;
  avatarUrl: string;
};

type AuthValue = {
  /** True until the first /api/me resolves. */
  isLoading: boolean;
  /** A session exists (signed in). */
  authed: boolean;
  account: Account | null;
  github: Github | null;
  /** GitHub is usable right now (drives the onboarding gate). */
  githubLinked: boolean;
  /** Start edu-ID (SWITCH) sign-in. */
  signIn: () => void;
  /** Sign out, then revalidate /api/me so the UI reflects it immediately. */
  signOut: () => Promise<void>;
  /** Start GitHub account linking (redirects to GitHub). */
  linkGithub: (callbackURL?: string) => void;
  /** Unlink GitHub, then revalidate — the gate then routes to onboarding. */
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
  const me = data?.user ?? null;

  const value = useMemo<AuthValue>(
    () => ({
      isLoading,
      authed: me !== null,
      account: me
        ? {
            name: me.name,
            email: me.email,
            affiliations: data?.affiliations ?? [],
          }
        : null,
      github: data?.github ?? null,
      githubLinked: Boolean(data?.githubLinked),
      signIn: () => {
        // Return to the page the user was on — the login renders in place
        // (Auth guard), so deep links (e.g. a class join link, which carries
        // query params) survive.
        authSignIn.oauth2({
          providerId: "switch",
          callbackURL:
            window.location.pathname +
            window.location.search +
            window.location.hash,
        });
      },
      signOut: async () => {
        await authSignOut();
        await mutate();
      },
      linkGithub: (callbackURL = "/") => {
        authLinkSocial({ provider: "github", callbackURL });
      },
      unlinkGithub: async () => {
        await unlinkAccount({ providerId: "github" });
        await mutate();
      },
    }),
    [data, me, isLoading, mutate],
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
