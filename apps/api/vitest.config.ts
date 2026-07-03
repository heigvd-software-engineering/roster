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
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
