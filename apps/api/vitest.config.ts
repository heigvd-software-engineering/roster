import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Real D1 (Miniflare) via the Workers pool — route tests seed real rows and
// exercise the endpoints' INLINE Drizzle queries (there is no query-helper
// layer to mock; see packages/db/README.md). GitHub/auth stay module-mocked.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(__dirname, "../../packages/db/migrations"),
      );
      return {
        miniflare: {
          d1Databases: ["DB"],
          bindings: { TEST_MIGRATIONS: migrations },
          // MUST match wrangler.jsonc. Left unset, the pool dates its runner
          // worker TODAY, and every test file dies the moment the calendar
          // passes the workerd binary's newest supported date:
          //   "requires compatibility date X, newest supported is Y".
          compatibilityDate: "2026-06-30",
          compatibilityFlags: ["nodejs_compat"],
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
