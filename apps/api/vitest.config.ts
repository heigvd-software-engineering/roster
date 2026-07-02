import { defineConfig } from "vitest/config";

// `/api/health` uses no Cloudflare bindings, so a plain node test suffices.
// The Workers pool (@cloudflare/vitest-pool-workers) is adopted later, when a
// test exercises D1 / auth behavior that needs the real runtime bindings.
export default defineConfig({
  test: { environment: "node" },
});
