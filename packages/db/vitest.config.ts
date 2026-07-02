import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Real D1 (Miniflare) via the Workers pool — this is the FIRST @labs/db logic
// test, so it exercises the real drizzle-orm/d1 + onConflictDoUpdate/RETURNING
// behavior rather than a mocked driver. Migrations are read here (Node) and
// handed to the worker as a JSON binding; a setup file applies them before
// each test file runs.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(__dirname, "migrations"),
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
