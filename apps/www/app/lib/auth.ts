import type { Auth } from "@labs/api";
import {
  customSessionClient,
  genericOAuthClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// No explicit baseURL: Better Auth defaults to the current origin (resolved
// lazily at request time). Reading window.* at module load would crash the SSR
// prerender when this module is pulled into the eagerly-evaluated root.
export const authClient = createAuthClient({
  // customSessionClient<Auth> infers the extra session fields (githubLinked).
  plugins: [genericOAuthClient(), customSessionClient<Auth>()],
});

export const { useSession, signIn, signOut, linkSocial, unlinkAccount } =
  authClient;
