// CLI-only entry for `@better-auth/cli generate`. Schema generation reads the
// auth options only, never connecting to the DB or the IdP, so the placeholder
// values below are safe. The runtime calls `createAuth(env)` with the real
// Cloudflare bindings.
import { createAuth } from "./src/lib/auth/config";

export const auth = createAuth({
  DB: {} as D1Database,
  BETTER_AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "generate-only",
  EDUID_ISSUER: "http://localhost",
  EDUID_CLIENT_ID: "x",
  EDUID_CLIENT_SECRET: "x",
  GITHUB_CLIENT_ID: "x",
  GITHUB_CLIENT_SECRET: "x",
  GITHUB_APP_ID: "x",
  GITHUB_APP_PRIVATE_KEY: "x",
  GITHUB_APP_SLUG: "x",
});
