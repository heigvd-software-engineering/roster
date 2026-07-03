import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { D1Database } from "@cloudflare/workers-types";

// `packages/db` has no `wrangler.jsonc` of its own (it isn't a Worker), so
// there's no `wrangler types` output to supply this ambient `Cloudflare.Env`
// augmentation. Hand-declared here for the test-only D1 + migrations
// bindings configured in ../vitest.config.ts.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
