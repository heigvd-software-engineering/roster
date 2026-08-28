import type { Auth } from "@roster/api";
import { customSessionClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// No explicit baseURL: Better Auth defaults to the current origin (resolved
// lazily at request time). Reading window.* at module load would crash the SSR
// prerender when this module is pulled into the eagerly-evaluated root.
const authClient = createAuthClient({
  // customSessionClient<Auth> infers the extra session fields (githubLinked).
  plugins: [customSessionClient<Auth>()],
});

export const { signIn, signOut, linkSocial, unlinkAccount } = authClient;
