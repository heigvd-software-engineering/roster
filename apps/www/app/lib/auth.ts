import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import type { Auth } from "@roster/api";
import { customSessionClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// No explicit baseURL: Better Auth defaults to the current origin (resolved
// lazily at request time). Reading window.* at module load would crash the SSR
// prerender when this module is pulled into the eagerly-evaluated root.
const authClient = createAuthClient({
  plugins: [
    // customSessionClient<Auth> infers the extra session fields (githubLinked).
    customSessionClient<Auth>(),
    // The OAuth provider's endpoints (oauth2.*), typed from the server plugin.
    // It also carries a fetch plugin that attaches the SIGNED authorization
    // query from window.location.search to every non-GET call — which is how
    // the consent screen hands the pending authorization back without ever
    // parsing or re-signing it itself.
    oauthProviderClient(),
  ],
});

export const { signIn, signOut, linkSocial, unlinkAccount, oauth2 } =
  authClient;
