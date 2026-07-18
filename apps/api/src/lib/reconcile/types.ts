// The contracts of the reconciliation subsystem. A reconciler owns ONE
// GitHub-authoritative concern (installation, identity, roster, group-teams,
// work-repos, base-permission) and never talks to GitHub directly: it reads
// through `ClassContext` (context.ts) and reports/fixes drift as `Finding`s.
import type { Class, classMembers, Group, getDb } from "@labs/db";
import type { AuthEnv } from "../auth/config";
import type { OrgInvitation, OrgPerson } from "../github/org";

type Db = ReturnType<typeof getDb>;
type ClassMember = typeof classMembers.$inferSelect;

/** Stable and derived from CONTENT, not a counter. Two audits of the same drift
 *  produce the same key; a changed drift is a different finding. The segment
 *  before the first ":" is the reconciler name — `applyFindings` dispatches on it. */
export type FindingKey = string; // "roster:remove:githubId=9"

export type Severity = "broken" | "drift" | "info";

export type Finding = {
  key: FindingKey;
  reconciler: string;
  severity: Severity;
  /** One line, for the checkbox. */
  title: string;
  /** What we saw, precisely. */
  detail: string;
  /** What Apply will do. `null` = we can see it, we cannot fix it. */
  fix: string | null;
  /** The state transition Apply performs — `from` is what stands NOW, `to`
   *  what it becomes. Rendered as `from → to`; null when the change has no
   *  meaningful two-state reading (then `fix` alone speaks). */
  change: { from: string; to: string } | null;
};

export type AppliedOp = { key: FindingKey; ok: true };
export type FailedOp = { key: FindingKey; ok: false; error: string };

export type Reconciler = {
  name: string;
  audit(ctx: ClassContext): Promise<Finding[]>;
  /** Only ever called with keys THIS reconciler produced. Each op is idempotent. */
  apply(
    ctx: ClassContext,
    keys: FindingKey[],
  ): Promise<(AppliedOp | FailedOp)[]>;
};

/**
 * Everything a reconciler may read: GitHub truth plus this class's own rows,
 * fetched lazily and memoized at most once per audit (see context.ts's
 * `buildContext`). `org`/`installationId` are the LIVE values, resolved once
 * before any reconciler runs — never `cls.installationId`, which is a cache
 * that reconciliation itself exists to correct.
 */
export type ClassContext = {
  db: Db;
  env: AuthEnv;
  cls: Class;
  org: string;
  installationId: number;
  orgInfo: () => Promise<{
    login: string;
    name: string | null;
    avatarUrl: string;
  }>;
  people: () => Promise<{
    teachers: OrgPerson[];
    students: OrgPerson[];
    /** Open invitations carry the ROLE they grant — an invited teacher is not
     *  an invited student, and nothing else can tell them apart. */
    pending: OrgInvitation[];
  }>;
  basePermission: () => Promise<string>;
  groups: () => Promise<Group[]>;
  orgRepos: () => Promise<
    Map<string, { pushedAt: string | null; createdAt: string | null }>
  >;
  members: () => Promise<ClassMember[]>;
};
