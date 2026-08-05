import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { D1Database } from "@cloudflare/workers-types";

// `packages/db` is not a Worker and has no `wrangler.jsonc`, so no `wrangler
// types` output supplies this ambient `Cloudflare.Env` augmentation. Declared
// here by hand for the test-only D1 and migrations bindings that
// ../vitest.config.ts configures.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
