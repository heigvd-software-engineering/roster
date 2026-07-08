// THE registry. Adding a reconciliation factor is adding a file (exporting
// `{ name, audit, apply }`) and one line below — never a change to this file's
// two functions.
import { identity } from "./identity";
import type {
  AppliedOp,
  ClassContext,
  FailedOp,
  Finding,
  FindingKey,
  Reconciler,
} from "./types";

export const RECONCILERS: readonly Reconciler[] = [identity];

/** One spelling of a failure, so an audit finding and a failed apply read the
 *  same. `err.message` only — a stack or a request URL is not for a teacher. */
const reason = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

function unavailable(r: Reconciler, err: unknown): Finding {
  return {
    key: `${r.name}:unavailable`,
    reconciler: r.name,
    severity: "info",
    title: `${r.name} could not be checked`,
    detail: reason(err),
    fix: null,
    destructive: false,
  };
}

/**
 * Runs every reconciler. NEVER rejects: a module that throws yields one `info`
 * finding, so one flaky check never blocks the fix the teacher came for — which
 * matters most when a dead installation makes every GitHub reconciler fail.
 * Writes nothing: it only calls `audit`, never `apply`.
 */
export async function runAudit(
  ctx: ClassContext,
  reconcilers: readonly Reconciler[] = RECONCILERS,
): Promise<Finding[]> {
  const results = await Promise.all(
    // try/catch around the CALL, not `.catch()` on its result: a reconciler
    // declared without `async` that throws outright never returns a promise to
    // attach a handler to, and would reject runAudit — breaking the one
    // invariant this function exists to hold. `never` is assignable to
    // Promise<Finding[]>, so the compiler will not stop the next author.
    reconcilers.map(async (r) => {
      try {
        return await r.audit(ctx);
      } catch (err) {
        return [unavailable(r, err)];
      }
    }),
  );
  return results.flat();
}

/**
 * Dispatches each key to its owning reconciler — the segment before the first
 * ":" (reconciler names may contain "-", e.g. "base-permission", so this
 * splits on ":" and never on "-"). A key whose prefix owns no reconciler comes
 * back as a failed op rather than throwing. One failing `apply` call never
 * aborts the others: each reconciler's own keys are isolated in their own
 * `Promise`, caught individually.
 */
export async function applyFindings(
  ctx: ClassContext,
  keys: FindingKey[],
  reconcilers: readonly Reconciler[] = RECONCILERS,
): Promise<(AppliedOp | FailedOp)[]> {
  const byName = new Map(reconcilers.map((r) => [r.name, r] as const));
  // Grouped by the reconciler object itself (not its name): the map's value
  // type carries the reconciler, so the later `.apply(...)` call needs no
  // re-lookup and thus no non-null assertion.
  const grouped = new Map<Reconciler, FindingKey[]>();
  const unknown: FailedOp[] = [];
  for (const key of keys) {
    const name = key.split(":", 1)[0] ?? "";
    const reconciler = byName.get(name);
    if (!reconciler) {
      unknown.push({ key, ok: false, error: "unknown_reconciler" });
      continue;
    }
    grouped.set(reconciler, [...(grouped.get(reconciler) ?? []), key]);
  }
  const applied = await Promise.all(
    // Same reason as runAudit: catch the CALL, not the promise it may never
    // return. One reconciler blowing up must not lose the other's results.
    [...grouped].map(async (entry): Promise<(AppliedOp | FailedOp)[]> => {
      const [reconciler, ks] = entry;
      try {
        return await reconciler.apply(ctx, ks);
      } catch (err) {
        return ks.map((key) => ({ key, ok: false, error: reason(err) }));
      }
    }),
  );
  return [...unknown, ...applied.flat()];
}
