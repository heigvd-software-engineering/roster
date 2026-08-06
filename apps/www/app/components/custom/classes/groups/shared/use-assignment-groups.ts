import { useMessages } from "~/contexts/message-context";
import {
  api,
  assignmentGroupsApi,
  type GroupItem,
  useAction,
  useApi,
} from "~/lib/api";

/**
 * A group's standing in one assignment, ONE derivation for both role UIs (the
 * teacher's roster chips, the student's start-assignment gate). Blocked states
 * first (under_min, no_repo), then push-based activity: on_track/on_time
 * (last push respects the deadline, open/closed), late (pushed after it),
 * no_pushes (repo untouched). "ready" = repo exists but activity unknown
 * because the org listing failed: chips degrade, the roster never does.
 */

/** Pushes within this window of the repo's creation read as the creation
 *  commit (auto-init and template generation bump `pushed_at` too), not as
 *  group activity. A real push inside the window stays invisible until the
 *  group pushes again; the "no pushes yet" tooltip explains this. */
export const CREATION_PUSH_GRACE_MS = 2 * 60_000;

export type GroupAssignmentStatus =
  | "under_min"
  | "no_repo"
  | "no_pushes"
  | "on_track"
  | "on_time"
  | "late"
  | "ready";

/** The assignment page's action failures, by the server's 409 `error` code. Every
 *  create/join/leave verb on this page routes its conflict through this one
 *  table, so a code can't drift to two different messages across the file. */
// Named because the batch repo-create reuses them for its skip warnings: one
// wording, whether the create was clicked alone or as "create all".
const GROUP_INCOMPLETE_MESSAGE =
  "This group needs more members before it can get its repository. Check the assignment's minimum size.";

const CONFLICT_MESSAGE: Record<string, string> = {
  member_already_participating:
    "You're already in another group for this assignment. Leave it first.",
  group_incomplete: GROUP_INCOMPLETE_MESSAGE,
  // Repo creation is CREATE-only, never adopting an existing repo even one
  // assignments could read back (see lib/groups.ts createWorkRepo), so a name
  // collision always refuses. The collision is USUALLY the group's own work,
  // waiting under its old name after the group (or its assignment) was deleted,
  // or after an interrupted create — so name that first. Retrying can't help
  // and renaming abandons the work, but the GitHub sync links it back, which is
  // why the create path can stay create-only: the teacher sees the repository
  // there and approves it, where an automatic adoption would be blind. A
  // student can't open that page, so this base wording sends them to someone
  // who can (teachers get their own below).
  repo_name_taken:
    "A repository already exists under this group's name, usually this group's own work from before. Ask your teacher to link it back from the class's GitHub sync.",
  template_error:
    "The assignment's starter-code template can't be used: it is probably empty or unavailable. Ask your teacher to add a file to it, or to remove the template.",
  app_permissions:
    "roster can't create repositories yet: the GitHub App needs updated permissions, and an administrator must approve them.",
  // Join and leave only: deletion is refused nowhere, so a locked group is
  // one you can't move in or out of, not one that's permanent.
  has_repo:
    "This group already has its work repository, so only the teacher can change its roster now.",
  group_full: "That group is full. Pick another or start your own.",
  name_taken: "A group with that name already exists in this assignment.",
  // Students only: teachers bypass the start gate entirely.
  not_started:
    "This assignment hasn't started yet. Groups and repositories open at the start time.",
  // unlinkGroupRepo re-verifies live before clearing the link, so this means
  // someone recreated a repo under the same name between page load and click.
  still_exists:
    "That repository still exists on GitHub. Refresh to see its current state.",
  // The page thought this was an individual assignment and the server
  // disagrees: the teacher changed its mode while it was open. Reloading is the
  // fix, so say that rather than describing the mismatch.
  group_assignment:
    "This assignment works in groups, not individually. Reload the page to see its groups.",
  // Accepting an individual assignment, when the solo group already exists but
  // its live GitHub team doesn't confirm it's the caller's. Three distinct
  // causes, and the student can fix none of them, so each says who can rather
  // than inviting a retry that will fail identically.
  solo_team_empty:
    "Your group for this assignment exists, but you're not in it on GitHub: you were removed either from the organization or from the group. Ask your teacher to add you back.",
  solo_team_missing:
    "Your group for this assignment has lost its team on GitHub. Ask your teacher to repair it from the class's GitHub sync.",
  solo_name_taken:
    "A group named after your GitHub account already exists in this assignment and belongs to someone else. Ask your teacher to sort it out.",
};

/** For codes no table knows. Kept OUT of the table so an unknown code can
 *  never collide with a real one named "default". */
const DEFAULT_CONFLICT_MESSAGE =
  "That didn't go through. Refresh and try again.";

/** Why the batch skipped a group, in the batch's voice ("<name> was skipped:
 *  …"), so these read as clauses. `group_incomplete` reuses the single-create
 *  wording; `repo_name_taken` says the same thing as the teacher's version
 *  above, shortened to the frame; `group_gone` has no single-create sibling
 *  (there the roster read failing 503s instead). */
const REPO_SKIP_MESSAGE: Record<string, string> = {
  repo_name_taken:
    "a repository already exists under its name, usually its own work from before. Link it back from the class's GitHub sync, or rename the group if that repository belongs to someone else.",
  group_incomplete: GROUP_INCOMPLETE_MESSAGE,
  group_gone:
    "its GitHub team no longer exists. Repair the class from its GitHub sync.",
};

/** One warning per group the batch repo-create SKIPPED. The 200 response
 * carries them (`{created, skipped}`), and silence here is how a teacher ships
 * an assignment believing every repo exists. Named by group, since the id alone
 * helps nobody, and reason-worded like the single-create conflicts. */
export function repoSkipMessages(
  skipped: Array<{ groupId: string; reason: string }>,
  groups: Array<{ id: string; name: string }>,
): string[] {
  return skipped.map((s) => {
    const name = groups.find((g) => g.id === s.groupId)?.name ?? "A group";
    return `${name} was skipped: ${REPO_SKIP_MESSAGE[s.reason] ?? DEFAULT_CONFLICT_MESSAGE}`;
  });
}

/** The codes whose ADVICE splits by role: an override layer over the shared
 *  table, not a second copy of it, so a code absent here falls through.
 *
 *  `group_full` reaches a teacher at all only because the size cap now binds
 *  addGroupMember too, and the student's remedy ("pick another") is not one a
 *  teacher has: the assignment's maximum is theirs, so name the lever they own.
 *
 *  `repo_name_taken` splits for the same reason: the GitHub sync that links
 *  the waiting repository back is a teacher-only page, so only they can be
 *  sent to it. They also get the escape hatch the student has no use for —
 *  renaming, for the case where the repository really is someone else's. */
const TEACHER_CONFLICT_MESSAGE: Record<string, string> = {
  group_full:
    "That group is at the assignment's maximum size. Raise the maximum in the assignment settings to add more members.",
  repo_name_taken:
    "A repository already exists under this group's name, usually this group's own work, left behind when a group or assignment was deleted. Open the class's GitHub sync to see which repository it is and link it back. Rename the group only if that repository belongs to someone else.",
};

/**
 * The assignment page's group data + actions (per-assignment model, spec
 * 2026-07-07): groups belong to THIS assignment, so the list IS the
 * assignment's groups, with no attach and no cross-assignment reach. Each group
 * carries its live roster + work repo + push activity, and the response carries
 * the assignment row, class identity, and the caller's role, making it the
 * page's ONE request. Shared by the teacher and student sections; every action
 * revalidates; failures surface on the global message strip.
 */
export function useAssignmentGroups(classId: string, assignmentId: string) {
  const { data, isLoading, error, mutate } = useApi(assignmentGroupsApi, {
    param: { id: classId, assignmentId },
  });
  const assignment = data?.assignment;
  const role = data?.role;

  const { push } = useMessages();
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
    !assignment || assignment.groupMode === "individual"
      ? 1
      : (assignment.minMembers ?? 1);
  const statusFor = (group: GroupItem): GroupAssignmentStatus => {
    // First: a group with no team has no meaningful size or activity.
    if (!group.repoFullName) {
      return group.members.length >= min ? "no_repo" : "under_min";
    }
    // `assignment` always accompanies `groups` in the response, so the
    // !assignment arm is for the type only.
    if (
      !assignment ||
      (group.pushedAt === null && group.repoCreatedAt === null)
    ) {
      return "ready"; // repo exists, activity unknown
    }
    const pushedAt = group.pushedAt ? Date.parse(group.pushedAt) : null;
    const createdAt = group.repoCreatedAt
      ? Date.parse(group.repoCreatedAt)
      : null;
    const hasPushes =
      pushedAt !== null &&
      (createdAt === null || pushedAt - createdAt > CREATION_PUSH_GRACE_MS);
    if (!hasPushes) return "no_pushes";
    const deadline = Date.parse(assignment.deadline);
    if ((pushedAt as number) > deadline) return "late";
    return Date.now() > deadline ? "on_time" : "on_track";
  };
  // Everyone placeable (class_members display cache: active students AND
  // teachers) who is in NO group of this assignment. The pool strip narrows to
  // students, since a teacher is not a missing student, but the add-picker
  // offers all of them, or removing a teacher would make them unaddable.
  const inGroup = new Set(
    groups.flatMap((g) => g.members.map((m) => String(m.id))),
  );
  const unplaced = (data?.students ?? []).filter(
    (s) => !inGroup.has(s.githubId),
  );
  const unassignedStudents = unplaced.filter((s) => s.state === "active");

  const groupParam = (groupId: string) => ({ param: { id: classId, groupId } });
  const assignmentGroupParam = (groupId: string) => ({
    param: { id: classId, assignmentId, groupId },
  });
  const classGroupsApi = api.api.classes[":id"].groups;

  return {
    isLoading,
    error,
    busy,
    act,
    revalidate: mutate,
    /** The assignment row, riding on the response, present once loaded. */
    assignment,
    /** The caller's role in this class (drives the page redirects). */
    role,
    /** Live org membership. "pending" renders the accept-invitation prompt. */
    membershipState: data?.membershipState,
    /** The class's display name for the breadcrumb. */
    className: data ? (data.class.name ?? data.class.login) : null,
    users: data?.users,
    groups,
    unassignedStudents,
    /** The add-picker's candidate source: unplaced students + teachers. */
    unplaced,
    /** Students in SOME group of this assignment (the pool's complement). */
    placedCount: inGroup.size,
    repoFor,
    statusFor,
    min,
    max:
      !assignment || assignment.groupMode === "individual"
        ? 1
        : (assignment.maxMembers ?? Infinity),
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
    /** Clear a repo link the server has confirmed is gone from GitHub: the
     *  escape hatch for a repo deleted directly on GitHub. */
    unlinkRepo: (groupId: string) =>
      act(() => classGroupsApi[":groupId"].repo.$delete(groupParam(groupId))),
    /** The explicit accept-completion step: create the group's repo. */
    createRepo: (groupId: string) =>
      act(() =>
        assignmentGroupsApi[":groupId"].repo.$post(
          assignmentGroupParam(groupId),
        ),
      ),
    /** Teacher toolbar: every missing repo in ONE request (one refetch).
     *  A 200 can still SKIP groups (name taken, under min, team gone), so
     *  surface each one, or the teacher reads silence as "all created". */
    createMissingRepos: () =>
      act(
        () =>
          api.api.classes[":id"].assignments[":assignmentId"].repos.$post({
            param: { id: classId, assignmentId },
          }),
        async (res) => {
          const { skipped } = (await res.json()) as {
            skipped: Array<{ groupId: string; reason: string }>;
          };
          for (const message of repoSkipMessages(skipped, groups)) {
            push(message, { variant: "warning" });
          }
        },
      ),
    acceptIndividual: () =>
      act(() =>
        api.api.classes[":id"].assignments[":assignmentId"].accept.$post({
          param: { id: classId, assignmentId },
        }),
      ),
  };
}
