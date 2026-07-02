import { applyD1Migrations, env } from "cloudflare:test";

// Runs once per worker before each test file (see vitest.config.ts
// `test.setupFiles`) — applies the real migration SQL to the local D1
// instance so tests exercise the actual schema (FKs, unique indexes, etc).
await applyD1Migrations(
  env.DB,
  env.TEST_MIGRATIONS as Parameters<typeof applyD1Migrations>[1],
);
