import { applyD1Migrations, env } from "cloudflare:test";

// Runs once per worker before each test file (see `test.setupFiles` in
// vitest.config.ts). Applies the real migration SQL to the local D1 instance so
// tests exercise the actual schema: FKs, unique indexes, and the rest.
await applyD1Migrations(
  env.DB,
  env.TEST_MIGRATIONS as Parameters<typeof applyD1Migrations>[1],
);
