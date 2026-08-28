// CLI-only entry for `@better-auth/cli generate`. Schema generation reads the
// auth options only, never connecting to the DB or the IdP, so the placeholder
// values below are safe. The runtime calls `createAuth(env)` with the real
// Cloudflare bindings.
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth } from "./src/lib/auth/config";

export const auth = createAuth(
  {
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
  },
  // Generation only: the Drizzle adapter refuses to construct while a plugin
  // declares tables the schema does not have yet, which is exactly the state
  // this command exists to fix. The in-memory adapter has no such opinion, and
  // the output format comes from `--adapter drizzle --dialect sqlite`.
  // An empty store still refuses unknown models, and the plugin's tables are
  // precisely what does not exist yet, so the store answers for any of them.
  { database: memoryAdapter(new Proxy({}, { get: () => [] })) },
);
