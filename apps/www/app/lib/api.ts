import type { AppType } from "@labs/api";
import { type ClientResponse, hc, type InferResponseType } from "hono/client";
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

// Derived response types — indexed off the inferred AppType, never
// hand-modeled (the Drizzle schema stays the single source of truth).
export type ClassItem = InferResponseType<
  typeof api.api.classes.$get,
  200
>["classes"][number];
export type LabItem = ClassItem["labs"][number];
/** A class the caller is ENROLLED in (student side) — served entirely from
 *  the DB caches; carries no join token, people, or teacher-only fields. */
export type EnrolledClassItem = InferResponseType<
  typeof api.api.classes.$get,
  200
>["enrolled"][number];

/**
 * Generic typed GET hook (SWR-backed). Pass an hc endpoint node (e.g.
 * `api.api.me`): the response type is inferred from it, its URL is the SWR
 * cache key, and any SWR options can be passed through. Returns the full SWR
 * response (`data`, `error`, `isLoading`, `mutate`, …).
 */
export function useApi<
  E extends { $get: () => Promise<ClientResponse<unknown>>; $url: () => URL },
>(endpoint: E, config?: SWRConfiguration<InferResponseType<E["$get"], 200>>) {
  type Data = InferResponseType<E["$get"], 200>;
  const path = endpoint.$url().pathname;
  return useSWR<Data>(
    path,
    async () => {
      const res = await endpoint.$get();
      // Throw non-2xx so SWR routes it to `error` instead of parsing the
      // error body as valid `Data`.
      if (!res.ok) {
        throw new Error(`GET ${path} failed (${res.status})`);
      }
      // `res` itself is fully typed off the real, narrowed `E` here (no cast
      // needed for `.ok`/`.status`). `.json()`'s return type doesn't survive
      // that narrowing though: inside a generic function body, TS can only
      // see `endpoint.$get()` through the *constraint's* declared shape
      // (`ClientResponse<unknown>`), so `.json()` resolves to `Promise<unknown>`
      // regardless of the caller's concrete endpoint. This one cast is the
      // unavoidable seam between "generic over any hc endpoint" and "typed
      // per-call" — `Data` is exactly what the real `res.json()` returns.
      return (await res.json()) as Data;
    },
    config,
  );
}
