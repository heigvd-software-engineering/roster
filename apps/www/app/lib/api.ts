import type { AppType } from "@labs/api";
import { type ClientResponse, hc, type InferResponseType } from "hono/client";
import { useState } from "react";
import useSWR, { type SWRConfiguration } from "swr";
import { useMessages } from "~/contexts/message-context";

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
/** The lab page's one groups endpoint: all class groups with live rosters,
 *  linked users, and which groups participate in this lab. */
export const labGroupsApi = api.api.classes[":id"].labs[":labId"].groups;
/** The caller's groups in OTHER labs — copy-forward sources for "reuse". */
export const reusableGroupsApi = api.api.classes[":id"].labs[":labId"].reusable;
export type ReusableGroup = InferResponseType<
  (typeof reusableGroupsApi)["$get"],
  200
>["groups"][number];
/** A group with its live team roster (F7). */
export type GroupItem = InferResponseType<
  (typeof labGroupsApi)["$get"],
  200
>["groups"][number];
/** An enrolled student as the lab pages see them (class_members cache). */
export type LabStudent = InferResponseType<
  (typeof labGroupsApi)["$get"],
  200
>["students"][number];

/**
 * Generic typed GET hook (SWR-backed). Pass an hc endpoint node (e.g.
 * `api.api.me`): the response type is inferred from it, its URL is the SWR
 * cache key, and any SWR options can be passed through. Parameterized
 * endpoints (e.g. `api.api.classes[":id"].groups`) take their `args` as the
 * second parameter — the substituted path keeps cache keys unique per
 * resource. Returns the full SWR response (`data`, `error`, `isLoading`,
 * `mutate`, …).
 */
/**
 * Mutation-state hook shared by the app's action buttons: `act` runs the
 * request, holds `busy` while in flight, surfaces failures as GLOBAL
 * messages (the strip under the header), and calls `revalidate` on
 * success. `on409` maps a conflict body to user copy (else conflicts read
 * as the generic failure). Modal FORMS don't use this — their errors stay
 * inline in the dialog.
 */
export function useAction(
  revalidate: () => Promise<unknown>,
  on409?: (body: { error?: string }) => string,
) {
  const { push } = useMessages();
  const [busy, setBusy] = useState(false);
  async function act(run: () => Promise<Response>) {
    setBusy(true);
    try {
      const res = await run();
      if (res.status === 409 && on409) {
        push(on409((await res.json()) as { error?: string }), {
          variant: "warning",
        });
        return;
      }
      if (res.status === 503) {
        // The API's honest "GitHub can't answer right now" (on-error.ts) —
        // transient and retryable, not the user's fault.
        push("GitHub is unreachable right now — try again in a minute.", {
          variant: "warning",
        });
        return;
      }
      if (!res.ok) {
        push("That didn't go through — refresh and try again.", {
          variant: "error",
        });
        return;
      }
      await revalidate();
    } catch {
      push("Something went wrong — check your connection.", {
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }
  return { busy, act };
}

export function useApi<
  E extends {
    // biome-ignore lint/suspicious/noExplicitAny: the constraint must admit any endpoint arg shape; concrete types still flow from the caller's E below
    $get: (...args: any[]) => Promise<ClientResponse<unknown>>;
    // biome-ignore lint/suspicious/noExplicitAny: same — $url mirrors $get
    $url: (...args: any[]) => URL;
  },
>(
  endpoint: E,
  args?: Parameters<E["$get"]>[0],
  config?: SWRConfiguration<InferResponseType<E["$get"], 200>>,
) {
  type Data = InferResponseType<E["$get"], 200>;
  // The cache key must carry the QUERY too — `$url` only substitutes path
  // params, and two windows of the same endpoint (e.g. `?from=`) must not
  // collide on one key.
  const url = endpoint.$url(args);
  const query = (args as { query?: Record<string, string> } | undefined)?.query;
  const path =
    url.pathname + (query ? `?${new URLSearchParams(query)}` : url.search);
  return useSWR<Data>(
    path,
    async () => {
      const res = await endpoint.$get(args);
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
