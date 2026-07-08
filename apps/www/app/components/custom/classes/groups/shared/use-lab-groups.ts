import {
  api,
  type GroupItem,
  type LabItem,
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
 * activity. Shared by the teacher and student sections; every action
 * revalidates; failures surface on the global message strip.
 */
export function useLabGroups(classId: string, lab: LabItem) {
  const { data, isLoading, error, mutate } = useApi(labGroupsApi, {
    param: { id: classId, labId: lab.id },
  });

  const { busy, act } = useAction(mutate, (body) => {
    switch (body.error) {
      case "member_already_participating":
        return "You're already in another group for this lab — leave it first.";
      case "group_incomplete":
        return "The group hasn't reached this lab's minimum size yet.";
      case "repo_name_taken":
        // An existing repo is normally ADOPTED — this only fires when labs
        // can't read it back, which is an access problem, not a naming one.
        return "A repository with that name exists in the organization but labs can't access it — ask your teacher.";
      case "template_error":
        return "The lab's starter-code template can't be used — it's likely empty or unavailable. Ask your teacher to add a file to it (or remove the template).";
      case "app_permissions":
        return "labs can't create repositories yet — the GitHub App needs updated permissions (an administrator must approve them).";
      case "has_repo":
        return "This group already has its work repository — it can't be deleted.";
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
  const min = lab.groupMode === "individual" ? 1 : (lab.minMembers ?? 1);
  const statusFor = (group: GroupItem): GroupLabStatus => {
    if (!group.repoFullName) {
      return group.members.length >= min ? "no_repo" : "under_min";
    }
    if (group.pushedAt === null && group.repoCreatedAt === null) {
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
  // The "without a group for this lab" pool: enrolled students (class_members
  // display cache) who are in NO group of this lab.
  const inGroup = new Set(
    groups.flatMap((g) => g.members.map((m) => String(m.id))),
  );
  const unassignedStudents = (data?.students ?? []).filter(
    (s) => !inGroup.has(s.githubId),
  );

  const groupParam = (groupId: string) => ({ param: { id: classId, groupId } });
  const labGroupParam = (groupId: string) => ({
    param: { id: classId, labId: lab.id, groupId },
  });
  const classGroupsApi = api.api.classes[":id"].groups;

  return {
    isLoading,
    error,
    busy,
    act,
    revalidate: mutate,
    users: data?.users,
    groups,
    unassignedStudents,
    /** Students in SOME group of this lab (the pool's complement). */
    placedCount: inGroup.size,
    repoFor,
    statusFor,
    min,
    max: lab.groupMode === "individual" ? 1 : (lab.maxMembers ?? Infinity),
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
          param: { id: classId, labId: lab.id },
        }),
      ),
    acceptIndividual: () =>
      act(() =>
        api.api.classes[":id"].labs[":labId"].accept.$post({
          param: { id: classId, labId: lab.id },
        }),
      ),
  };
}
