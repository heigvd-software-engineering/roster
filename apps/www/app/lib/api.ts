import type { AppType } from "@labs/api";
import { hc, type InferResponseType } from "hono/client";
import useSWR, { type SWRConfiguration } from "swr";

/**
 * Typed RPC client. Response types are INFERRED from the server's `AppType`
 * (Hono) — no codegen, no hand-written shapes.
 */
export const api = hc<AppType>(window.location.origin);

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
  return useSWR<Data>(
    endpoint.$url().pathname,
    async () =>
      (
        await (endpoint.$get() as Promise<{ json: () => Promise<Data> }>)
      ).json(),
    config,
  );
}
