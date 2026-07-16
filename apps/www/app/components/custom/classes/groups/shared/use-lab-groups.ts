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

  const { busy, act } = useAction(mutate, (body) => {
    switch (body.error) {
      case "member_already_participating":
        return "You're already in another group for this lab — leave it first.";
      case "group_incomplete":
        return "The group hasn't reached this lab's minimum size yet.";
      case "repo_name_taken":
        // Repo creation is CREATE-only (never adopts an existing repo, even
        // one labs could read back — see lib/groups.ts createWorkRepo): a
        // name collision always refuses. A genuine interrupted create is
        // recovered by the teacher on the reconciler audit page, never
        // automatically.
        return "A repository with that name already exists in the organization — rename the group and try again.";
      case "template_error":
        return "The lab's starter-code template can't be used — it's likely empty or unavailable. Ask your teacher to add a file to it (or remove the template).";
      case "app_permissions":
        return "labs can't create repositories yet — the GitHub App needs updated permissions (an administrator must approve them).";
      case "has_repo":
        // Read by BOTH roles (a teacher's stale delete lands here too) —
        // stay role-neutral.
        return "This group already has its work repository — membership and deletion are locked.";
      case "group_full":
        return "That group is already full — pick another or start your own.";
      case "name_taken":
        return "A group with that name already exists in this lab.";
      default:
        return "That didn't go through — refresh and try again.";
    }
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
    role: data?.role,
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
