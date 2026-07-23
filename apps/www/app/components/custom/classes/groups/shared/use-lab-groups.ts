import {
  api,
  type GroupItem,
  labGroupsApi,
  useAction,
  useApi,
} from "~/lib/api";

/**
 * A group's standing in one lab — ONE derivation for both role UIs (the
 * teacher's roster chips, the student's start-lab gate). Blocked states
 * first (under_min, no_repo), then push-based activity: on_track/on_time
 * (last push respects the deadline, open/closed), late (pushed after it),
 * no_pushes (repo untouched). "ready" = repo exists but activity unknown
 * (the org listing failed) — chips degrade, the roster never does.
 */
export type GroupLabStatus =
  /** The GitHub team is gone: the roster is unknowable and the students have
   *  lost push on the work repo, because the grant lived on that team. */
  | "under_min"
  | "no_repo"
  | "no_pushes"
  | "on_track"
  | "on_time"
  | "late"
  | "ready";

/** The lab page's action failures, by the server's 409 `error` code — every
 *  create/join/leave verb on this page routes its conflict through this one
 *  table, so a code can't drift to two different messages across the file. */
const CONFLICT_MESSAGE: Record<string, string> = {
  member_already_participating:
    "You're already in another group for this lab — leave it first.",
  group_incomplete:
    "This group needs more members before it can get its repository — check the lab's minimum size.",
  // Repo creation is CREATE-only (never adopts an existing repo, even one
  // labs could read back — see lib/groups.ts createWorkRepo): a name
  // collision always refuses. A genuine interrupted create is recovered by
  // the teacher on the reconciler audit page, never automatically.
  repo_name_taken:
    "A repository with that name already exists in the organization — rename the group and try again.",
  template_error:
    "The lab's starter-code template can't be used — it's likely empty or unavailable. Ask your teacher to add a file to it (or remove the template).",
  app_permissions:
    "labs can't create repositories yet — the GitHub App needs updated permissions (an administrator must approve them).",
  // Read by BOTH roles (a teacher's stale delete lands here too) — stay
  // role-neutral.
  has_repo:
    "This group already has its work repository — membership and deletion are locked.",
  group_full: "That group is already full — pick another or start your own.",
  name_taken: "A group with that name already exists in this lab.",
  // Students only — teachers bypass the start gate entirely.
  not_started:
    "This lab hasn't started yet — groups and repositories open at the start time.",
  // unlinkGroupRepo re-verifies live before clearing the link — this means
  // someone recreated a repo under the same name between page load and click.
  still_exists:
    "That repository still exists on GitHub — refresh to see its current state.",
  // The page thought this was an individual lab and the server disagrees —
  // the teacher changed its mode while it was open. Reloading is the fix, so
  // say that rather than describing the mismatch.
  group_lab:
    "This lab works in groups, not individually — reload the page to see its groups.",
  // Accepting an individual lab, when the solo group already exists but its
  // live GitHub team doesn't confirm it's the caller's. Three distinct causes,
  // and NONE of them is something the student can fix themselves — so each says
  // who can, rather than inviting a retry that will fail identically.
  solo_team_empty:
    "Your group for this lab exists, but you're not in it on GitHub — either you were removed from the organization, or you were removed from the group. Ask your teacher to add you back.",
  solo_team_missing:
    "Your group for this lab has lost its team on GitHub. Ask your teacher to repair it from the class's GitHub sync.",
  solo_name_taken:
    "A group named after your GitHub account already exists in this lab and belongs to someone else. Ask your teacher to sort it out.",
};

/** For codes no table knows — kept OUT of the table so an unknown code can
 *  never collide with a real one named "default". */
const DEFAULT_CONFLICT_MESSAGE =
  "That didn't go through — refresh and try again.";

/** The codes whose ADVICE splits by role — an override layer over the shared
 *  table, not a second copy of it (a code absent here falls through).
 *
 *  `group_full` reaches a teacher at all only because the size cap now binds
 *  addGroupMember too, and the student's remedy ("pick another") is not one a
 *  teacher has: the lab's maximum is theirs, so name the lever they own. */
const TEACHER_CONFLICT_MESSAGE: Record<string, string> = {
  group_full:
    "That group is already at the lab's maximum size — raise the lab's maximum in the lab settings to add more members.",
};

/**
 * The lab page's group data + actions (per-lab model, spec 2026-07-07):
 * groups belong to THIS lab, so the list IS the lab's groups — no attach,
 * no cross-lab reach. Each group carries its live roster + work repo + push
 * activity, and the response carries the lab row, class identity, and the
 * caller's role — the page's ONE request. Shared by the teacher and student
 * sections; every action revalidates; failures surface on the global
 * message strip.
 */
export function useLabGroups(classId: string, labId: string) {
  const { data, isLoading, error, mutate } = useApi(labGroupsApi, {
    param: { id: classId, labId },
  });
  const lab = data?.lab;
  const role = data?.role;

  const { busy, act } = useAction(mutate, (body) => {
    const code = body.error ?? "";
    return (
      (role === "teacher" ? TEACHER_CONFLICT_MESSAGE[code] : undefined) ??
      CONFLICT_MESSAGE[code] ??
      DEFAULT_CONFLICT_MESSAGE
    );
  });

  const groups = data?.groups ?? [];
  /** The group's work repo full name, once created. */
  const repoFor = (groupId: string) =>
    groups.find((g) => g.id === groupId)?.repoFullName ?? null;
  const min =
    !lab || lab.groupMode === "individual" ? 1 : (lab.minMembers ?? 1);
  const statusFor = (group: GroupItem): GroupLabStatus => {
    // First: a group with no team has no meaningful size or activity.
    if (!group.repoFullName) {
      return group.members.length >= min ? "no_repo" : "under_min";
    }
    // `lab` always accompanies `groups` in the response — the !lab arm is
    // for the type only.
    if (!lab || (group.pushedAt === null && group.repoCreatedAt === null)) {
      return "ready"; // repo exists, activity unknown
    }
    const pushedAt = group.pushedAt ? Date.parse(group.pushedAt) : null;
    const createdAt = group.repoCreatedAt
      ? Date.parse(group.repoCreatedAt)
      : null;
    // The creation commit (auto-init / template) bumps pushed_at too —
    // count only pushes meaningfully after the repo came to be.
    const hasPushes =
      pushedAt !== null &&
      (createdAt === null || pushedAt - createdAt > 2 * 60_000);
    if (!hasPushes) return "no_pushes";
    const deadline = Date.parse(lab.deadline);
    if ((pushedAt as number) > deadline) return "late";
    return Date.now() > deadline ? "on_time" : "on_track";
  };
  // Everyone placeable (class_members display cache: active students AND
  // teachers) who is in NO group of this lab. The pool strip narrows to
  // students — a teacher is not a missing student — but the add-picker
  // offers all of them, or removing a teacher would make them unaddable.
  const inGroup = new Set(
    groups.flatMap((g) => g.members.map((m) => String(m.id))),
  );
  const unplaced = (data?.students ?? []).filter(
    (s) => !inGroup.has(s.githubId),
  );
  const unassignedStudents = unplaced.filter((s) => s.state === "active");

  const groupParam = (groupId: string) => ({ param: { id: classId, groupId } });
  const labGroupParam = (groupId: string) => ({
    param: { id: classId, labId, groupId },
  });
  const classGroupsApi = api.api.classes[":id"].groups;

  return {
    isLoading,
    error,
    busy,
    act,
    revalidate: mutate,
    /** The lab row — rides on the response, present once loaded. */
    lab,
    /** The caller's role in this class (drives the page redirects). */
    role,
    /** Live org membership — "pending" renders the accept-invitation prompt. */
    membershipState: data?.membershipState,
    /** The class's display name for the breadcrumb. */
    className: data ? (data.class.name ?? data.class.login) : null,
    users: data?.users,
    groups,
    unassignedStudents,
    /** The add-picker's candidate source: unplaced students + teachers. */
    unplaced,
    /** Students in SOME group of this lab (the pool's complement). */
    placedCount: inGroup.size,
    repoFor,
    statusFor,
    min,
    max:
      !lab || lab.groupMode === "individual" ? 1 : (lab.maxMembers ?? Infinity),
    join: (groupId: string) =>
      act(() =>
        classGroupsApi[":groupId"].membership.$put(groupParam(groupId)),
      ),
    leave: (groupId: string) =>
      act(() =>
        classGroupsApi[":groupId"].membership.$delete(groupParam(groupId)),
      ),
    addMember: (groupId: string, login: string) =>
      act(() =>
        classGroupsApi[":groupId"].members[":login"].$put({
          param: { id: classId, groupId, login },
        }),
      ),
    removeMember: (groupId: string, login: string) =>
      act(() =>
        classGroupsApi[":groupId"].members[":login"].$delete({
          param: { id: classId, groupId, login },
        }),
      ),
    deleteGroup: (groupId: string) =>
      act(() => classGroupsApi[":groupId"].$delete(groupParam(groupId))),
    /** Clear a repo link the server has confirmed is gone from GitHub —
     *  the escape hatch for a repo deleted directly on GitHub. */
    unlinkRepo: (groupId: string) =>
      act(() => classGroupsApi[":groupId"].repo.$delete(groupParam(groupId))),
    /** The explicit accept-completion step: create the group's repo. */
    createRepo: (groupId: string) =>
      act(() => labGroupsApi[":groupId"].repo.$post(labGroupParam(groupId))),
    /** Teacher toolbar: every missing repo in ONE request (one refetch). */
    createMissingRepos: () =>
      act(() =>
        api.api.classes[":id"].labs[":labId"].repos.$post({
          param: { id: classId, labId },
        }),
      ),
    acceptIndividual: () =>
      act(() =>
        api.api.classes[":id"].labs[":labId"].accept.$post({
          param: { id: classId, labId },
        }),
      ),
  };
}
