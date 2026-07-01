import type { AppType } from "@labs/api";
import { hc, type InferResponseType } from "hono/client";
import useSWR, { type SWRConfiguration } from "swr";

/**
 * Typed RPC client. Response types are INFERRED from the server's `AppType`
 * (Hono) — no codegen, no hand-written shapes.
 */
// SSR-safe: window.* is read lazily (the client is only used in the browser).
// A module-load `window.location.origin` would crash the prerender if this file
// were ever pulled into the eagerly-evaluated root (see lib/auth.ts).
export const api = hc<AppType>(
  typeof window === "undefined" ? "http://localhost" : window.location.origin,
);

/**
 * Generic typed GET hook (SWR-backed). Pass an hc endpoint node (e.g.
 * `api.api.me`): the response type is inferred from it, its URL is the SWR
 * cache key, and any SWR options can be passed through. Returns the full SWR
 * response (`data`, `error`, `isLoading`, `mutate`, …).
 */
export function useApi<
  E extends { $get: (...args: never[]) => unknown; $url: () => URL },
>(endpoint: E, config?: SWRConfiguration<InferResponseType<E["$get"]>>) {
  type Data = InferResponseType<E["$get"]>;
  const path = endpoint.$url().pathname;
  return useSWR<Data>(
    path,
    async () => {
      const res = (await endpoint.$get()) as {
        ok: boolean;
        status: number;
        json: () => Promise<Data>;
      };
      // Throw non-2xx so SWR routes it to `error` instead of parsing the
      // error body as valid `Data`.
      if (!res.ok) {
        throw new Error(`GET ${path} failed (${res.status})`);
      }
      return res.json();
    },
    config,
  );
}
