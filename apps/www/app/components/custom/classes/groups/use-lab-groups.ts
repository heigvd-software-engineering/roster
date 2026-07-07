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
 * The lab page's group data + actions, shared by the teacher and student
 * group sections (their UIs diverge; the wire and the mutations don't).
 * One request: all class groups with live rosters, linked SWITCH users,
 * and which groups participate in this lab. Every action revalidates it;
 * failures surface on the global message strip.
 */
export function useLabGroups(classId: string, lab: LabItem) {
  const { data, isLoading, error, mutate } = useApi(labGroupsApi, {
    param: { id: classId, labId: lab.id },
  });

  const sizeLabel =
    lab.groupMode === "individual"
      ? "1"
      : `${lab.minMembers}–${lab.maxMembers}`;
  const { busy, act } = useAction(mutate, (body) => {
    switch (body.error) {
      case "member_already_participating":
        return "Someone in that group already participates through another group.";
      case "group_incomplete":
        return "The group hasn't reached this lab's minimum size yet.";
      case "repo_name_taken":
        return "A repository with that name already exists in the organization — ask your teacher.";
      case "app_permissions":
        return "labs can't create repositories yet — the GitHub App needs updated permissions (an administrator must approve them).";
      case "has_repo":
        return "This group already has its repository for the lab — it can't be detached.";
      default:
        return `That group doesn't fit this lab (takes ${sizeLabel} members).`;
    }
  });

  const groups = data?.groups ?? [];
  const pairings = data?.attached ?? [];
  const attachedIds = new Set(pairings.map((p) => p.groupId));
  const attached = groups.filter((g) => attachedIds.has(g.id));
  const unattached = groups.filter((g) => !attachedIds.has(g.id));
  /** The group↔lab pairing row: repo + its push/creation timestamps. */
  const pairingFor = (groupId: string) =>
    pairings.find((p) => p.groupId === groupId) ?? null;
  /** The group's work repo full name, once created. */
  const repoFor = (groupId: string) =>
    pairingFor(groupId)?.repoFullName ?? null;
  const min = lab.groupMode === "individual" ? 1 : (lab.minMembers ?? 1);
  const statusFor = (group: GroupItem): GroupLabStatus => {
    const pairing = pairingFor(group.id);
    if (!pairing?.repoFullName) {
      return group.members.length >= min ? "no_repo" : "under_min";
    }
    if (pairing.pushedAt === null && pairing.repoCreatedAt === null) {
      return "ready"; // repo exists, activity unknown
    }
    const pushedAt = pairing.pushedAt ? Date.parse(pairing.pushedAt) : null;
    const createdAt = pairing.repoCreatedAt
      ? Date.parse(pairing.repoCreatedAt)
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
  // The "without a group for this lab" pool: enrolled students (from the
  // class_members display cache) who are in NO participating group.
  const inGroup = new Set(
    attached.flatMap((g) => g.members.map((m) => String(m.id))),
  );
  const unassignedStudents = (data?.students ?? []).filter(
    (s) => !inGroup.has(s.githubId),
  );

  const groupParam = (groupId: string) => ({ param: { id: classId, groupId } });
  const pairParam = (groupId: string) => ({
    param: { id: classId, labId: lab.id, groupId },
  });
  const classGroupsApi = api.api.classes[":id"].groups;

  return {
    isLoading,
    error,
    busy,
    act,
    users: data?.users,
    groups,
    attached,
    unattached,
    unassignedStudents,
    /** Students in SOME participating group (the pool's complement). */
    placedCount: inGroup.size,
    pairingFor,
    repoFor,
    statusFor,
    min,
    max: lab.groupMode === "individual" ? 1 : (lab.maxMembers ?? Infinity),
    sizeLabel,
    attach: (groupId: string) =>
      act(() => labGroupsApi[":groupId"].$put(pairParam(groupId))),
    detach: (groupId: string) =>
      act(() => labGroupsApi[":groupId"].$delete(pairParam(groupId))),
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
    /** The explicit accept-completion step: create the pairing's repo. */
    createRepo: (groupId: string) =>
      act(() => labGroupsApi[":groupId"].repo.$post(pairParam(groupId))),
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
