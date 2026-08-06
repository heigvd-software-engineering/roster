// The registry. Adding a reconciliation factor means adding a file that exports
// `{ name, audit, apply }` plus one line below, never a change to this file's
// two functions.
import { basePermissionReconciler } from "./base-permission";
import { groupMembersReconciler } from "./group-members";
import { groupTeams } from "./group-teams";
import { identity } from "./identity";
import { installation } from "./installation";
import { roster } from "./roster";
import type {
  AppliedOp,
  ClassContext,
  FailedOp,
  Finding,
  FindingKey,
  Reconciler,
} from "./types";
import { workRepos } from "./work-repos";

// `installation` is listed first because it must run first: every other GitHub
// reconciler depends on the pointer being right, and the teacher must fix a
// dead one before anything else on the page can succeed.
export const RECONCILERS: readonly Reconciler[] = [
  installation,
  identity,
  roster,
  groupTeams,
  // After `groupTeams`: a group whose team is gone has no roster to reconcile,
  // and the teacher should see the team finding first.
  groupMembersReconciler,
  workRepos,
  basePermissionReconciler,
];

/** One spelling of a failure, so an audit finding and a failed apply read the
 *  same. `err.message` only: a stack or a request URL is not for a teacher. */
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
    change: null,
  };
}

/**
 * Runs every reconciler. Never rejects: a module that throws yields one `info`
 * finding, so one flaky check never blocks the fix the teacher came for. That
 * matters most when a dead installation makes every GitHub reconciler fail.
 * Writes nothing, calling `audit` and never `apply`.
 */
export async function runAudit(
  ctx: ClassContext,
  reconcilers: readonly Reconciler[] = RECONCILERS,
): Promise<Finding[]> {
  const results = await Promise.all(
    // try/catch around the call, not `.catch()` on its result: a reconciler
    // declared without `async` that throws outright returns no promise to
    // attach a handler to, and would reject runAudit, breaking the one
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
 * Dispatches each key to the reconciler named by the segment before the first
 * ":". Names may contain "-", as in "base-permission", so this splits on ":"
 * only. A key whose prefix owns no reconciler comes back as a failed op instead
 * of throwing. One failing `apply` never aborts the others: each reconciler's
 * keys sit in their own `Promise`, caught individually.
 */
export async function applyFindings(
  ctx: ClassContext,
  keys: FindingKey[],
  reconcilers: readonly Reconciler[] = RECONCILERS,
): Promise<(AppliedOp | FailedOp)[]> {
  const byName = new Map(reconcilers.map((r) => [r.name, r] as const));
  // Keyed by the reconciler object, not its name, so the later `.apply(...)`
  // call needs no re-lookup and no non-null assertion.
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
    // Same reason as runAudit: catch the call, not the promise it may never
    // return. One reconciler blowing up must not lose the others' results.
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
