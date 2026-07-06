import { api, type LabItem, labGroupsApi, useAction, useApi } from "~/lib/api";

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
  const { busy, act } = useAction(mutate, (body) =>
    body.error === "member_already_participating"
      ? "Someone in that group already participates through another group."
      : `That group doesn't fit this lab (takes ${sizeLabel} members).`,
  );

  const groups = data?.groups ?? [];
  const attachedIds = new Set(data?.attachedIds ?? []);
  const attached = groups.filter((g) => attachedIds.has(g.id));
  const unattached = groups.filter((g) => !attachedIds.has(g.id));
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
    min: lab.groupMode === "individual" ? 1 : (lab.minMembers ?? 1),
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
    acceptIndividual: () =>
      act(() =>
        api.api.classes[":id"].labs[":labId"].accept.$post({
          param: { id: classId, labId: lab.id },
        }),
      ),
  };
}
