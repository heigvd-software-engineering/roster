import type { AppType } from "@roster/api";
import { type ClientResponse, hc, type InferResponseType } from "hono/client";
import { useState } from "react";
import useSWR, { type SWRConfiguration } from "swr";
import { useMessages } from "~/contexts/message-context";

/**
 * Typed RPC client. Response types are inferred from the server's `AppType`
 * (Hono): no codegen, no hand-written shapes.
 */
// SSR-safe: window.* is read lazily (the client only runs in the browser).
// A module-load `window.location.origin` would crash the prerender if this file
// were ever pulled into the eagerly-evaluated root (see lib/auth.ts).
export const api = hc<AppType>(
  typeof window === "undefined" ? "http://localhost" : window.location.origin,
);

// Response types indexed off the inferred AppType, never hand-modeled: the
// Drizzle schema stays the single source of truth.
export type ClassItem = InferResponseType<
  typeof api.api.classes.$get,
  200
>["classes"][number];
/** An assignment as the hub serves it; the timeline types against this. */
export type HubAssignmentItem = ClassItem["assignments"][number];
/** A class the caller is enrolled in (student side), served from the DB
 *  caches: no join token, people, or teacher-only fields. */
export type EnrolledClassItem = InferResponseType<
  typeof api.api.classes.$get,
  200
>["enrolled"][number];
/** The assignment page's one groups endpoint: all class groups with live rosters,
 *  linked users, and which groups participate in this assignment. */
export const assignmentGroupsApi =
  api.api.classes[":id"].assignments[":assignmentId"].groups;
/** The assignment row alone, as the assignment page receives it: the shape every
 * assignment-scoped component types against (a HubAssignmentItem satisfies it
 * too). */
export type AssignmentItem = InferResponseType<
  (typeof assignmentGroupsApi)["$get"],
  200
>["assignment"];
/** The caller's groups in other assignments: copy-forward sources for "reuse". */
export const reusableGroupsApi =
  api.api.classes[":id"].assignments[":assignmentId"].reusable;
export type ReusableGroup = InferResponseType<
  (typeof reusableGroupsApi)["$get"],
  200
>["groups"][number];
/** A group with its live team roster (F7). */
export type GroupItem = InferResponseType<
  (typeof assignmentGroupsApi)["$get"],
  200
>["groups"][number];
/** The 404-vs-transient discriminator for `useApi` errors. */
export const errorStatus = (error: unknown) =>
  (error as { status?: number } | null | undefined)?.status;
/** An enrolled student as the assignment pages see them (class_members cache). */
export type AssignmentStudent = InferResponseType<
  (typeof assignmentGroupsApi)["$get"],
  200
>["students"][number];

/**
 * Mutation-state hook shared by the app's action buttons: `act` runs the
 * request, holds `busy` while in flight, surfaces failures as global
 * messages (the strip under the header), and calls `revalidate` on success.
 * `on409` maps a conflict body to user copy, else conflicts read as the
 * generic failure. Modal forms don't use this: their errors stay inline in
 * the dialog.
 */
export function useAction(
  revalidate: () => Promise<unknown>,
  on409?: (body: { error?: string }) => string,
) {
  const { push } = useMessages();
  const [busy, setBusy] = useState(false);
  /** `onOk` reads the success response, for endpoints whose 200 still carries
   *  partial-failure detail (the batch repo create's `skipped`). Runs after
   *  the revalidate so its messages describe the fresh state. */
  async function act(
    run: () => Promise<Response>,
    onOk?: (res: Response) => void | Promise<void>,
  ) {
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
        // The API's honest "GitHub can't answer right now" (on-error.ts):
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
      if (onOk) await onOk(res);
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

/**
 * Generic typed GET hook (SWR-backed). Pass an hc endpoint node (e.g.
 * `api.api.me`): the response type is inferred from it, its URL is the SWR
 * cache key, and any SWR options pass through. Parameterized endpoints (e.g.
 * `api.api.classes[":id"].groups`) take their `args` as the second parameter,
 * and the substituted path keeps cache keys unique per resource. Returns the
 * full SWR response (`data`, `error`, `isLoading`, `mutate`, …).
 */
export function useApi<
  E extends {
    // biome-ignore lint/suspicious/noExplicitAny: the constraint must admit any endpoint arg shape; concrete types still flow from the caller's E below
    $get: (...args: any[]) => Promise<ClientResponse<unknown>>;
    // biome-ignore lint/suspicious/noExplicitAny: same reason; $url mirrors $get
    $url: (...args: any[]) => URL;
  },
>(
  endpoint: E,
  args?: Parameters<E["$get"]>[0],
  config?: SWRConfiguration<InferResponseType<E["$get"], 200>>,
) {
  type Data = InferResponseType<E["$get"], 200>;
  // The cache key must carry the query too: `$url` only substitutes path
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
      // error body as valid `Data`. The status rides on the error so pages
      // can tell 404 (doesn't exist / no access) from a transient failure.
      if (!res.ok) {
        throw Object.assign(new Error(`GET ${path} failed (${res.status})`), {
          status: res.status,
        });
      }
      // `.json()`'s return type doesn't survive the generic narrowing: inside
      // the function body TS sees `endpoint.$get()` only through the
      // constraint's shape (`ClientResponse<unknown>`), so `.json()` resolves
      // to `Promise<unknown>` whatever the caller's endpoint. The cast is the
      // seam between "generic over any hc endpoint" and "typed per-call";
      // `Data` is what the real `res.json()` returns.
      return (await res.json()) as Data;
    },
    config,
  );
}
