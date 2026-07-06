import { Link2Off, UserPlus, X } from "lucide-react";
import type { ReactNode } from "react";
import { NewGroupDialog } from "~/components/custom/classes/new-group-dialog";
import type { Role } from "~/components/custom/classes/role-marker";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { GhostTile } from "~/components/custom/layout/ghost-tile";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useAuth } from "~/contexts/auth-context";
import {
  api,
  type ClassItem,
  type GroupItem,
  type LabItem,
  labGroupsApi,
  useAction,
  useApi,
} from "~/lib/api";
import { switchDisplayName } from "~/lib/format";
import { cn } from "~/lib/utils";

const classGroupsApi = api.api.classes[":id"].groups;

/** The groups grid: 3 columns on desktop, collapsing below. */
const GROUPS_GRID =
  "grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

type LabGroupsSectionProps = {
  classId: string;
  lab: LabItem;
  /** Caller's role (named `kind`: a `role` prop reads as an ARIA attr). */
  kind: Role;
  /** Teacher-only: the class's students (add-member candidates + the
   *  "without a group" pool) and their linked SWITCH users. */
  students?: ClassItem["students"];
  users?: ClassItem["users"];
};

/**
 * THE group surface (user-decided 2026-07-06): on the lab page, where a
 * group meets its lab. ONE request feeds it (all class groups + rosters +
 * which participate here). Student language is ACCEPTING the lab: join a
 * participating group, accept with one of your groups (misfits shown
 * disabled with the reason), or accept with a new group (created groups
 * attach immediately). Under-min groups participate marked "needs N more" —
 * min bites at F8's repo creation. Teachers attach any group, manage any
 * roster, detach. The server re-checks everything.
 */
export function LabGroupsSection({
  classId,
  lab,
  kind,
  students,
  users,
}: LabGroupsSectionProps) {
  const { github } = useAuth();
  const me = github?.login;
  const teacher = kind === "teaching";
  const { data, isLoading, error, mutate } = useApi(labGroupsApi, {
    param: { id: classId, labId: lab.id },
  });

  const min = lab.groupMode === "individual" ? 1 : (lab.minMembers ?? 1);
  const max = lab.groupMode === "individual" ? 1 : (lab.maxMembers ?? Infinity);
  const sizeLabel =
    lab.groupMode === "individual"
      ? "1"
      : `${lab.minMembers}–${lab.maxMembers}`;

  const action = useAction(mutate, (body) =>
    body.error === "member_already_participating"
      ? "Someone in that group already participates through another group."
      : `That group doesn't fit this lab (takes ${sizeLabel} members).`,
  );

  const attachedIds = new Set(data?.attachedIds ?? []);
  const attached = (data?.groups ?? []).filter((g) => attachedIds.has(g.id));
  const participating = attached.some((g) =>
    g.members.some((m) => m.login === me),
  );
  // Accept/attach candidates: unattached groups — a teacher may pick any,
  // a student only groups they're in. Over-max stays listed but disabled.
  const candidates = (data?.groups ?? []).filter(
    (g) =>
      !attachedIds.has(g.id) &&
      (teacher || g.members.some((m) => m.login === me)),
  );
  // Students who are already in: their path is done — no accept affordances.
  const offerAccept = teacher || !participating;
  // The teacher's overview pool: enrolled students in NO participating group.
  const unassigned = (students ?? []).filter(
    (s) => !attached.some((g) => g.members.some((m) => m.id === s.id)),
  );
  const classUserById = new Map(users?.map((u) => [u.githubId, u.user]));

  const groupParam = (groupId: string) => ({ param: { id: classId, groupId } });
  const pairParam = (groupId: string) => ({
    param: { id: classId, labId: lab.id, groupId },
  });
  const handlers: GroupHandlers = {
    attach: (groupId) =>
      action.act(() => labGroupsApi[":groupId"].$put(pairParam(groupId))),
    detach: (groupId) =>
      action.act(() => labGroupsApi[":groupId"].$delete(pairParam(groupId))),
    join: (groupId) =>
      action.act(() =>
        classGroupsApi[":groupId"].membership.$put(groupParam(groupId)),
      ),
    leave: (groupId) =>
      action.act(() =>
        classGroupsApi[":groupId"].membership.$delete(groupParam(groupId)),
      ),
    addMember: (groupId, login) =>
      action.act(() =>
        classGroupsApi[":groupId"].members[":login"].$put({
          param: { id: classId, groupId, login },
        }),
      ),
    removeMember: (groupId, login) =>
      action.act(() =>
        classGroupsApi[":groupId"].members[":login"].$delete({
          param: { id: classId, groupId, login },
        }),
      ),
  };

  return (
    <>
      {/* The prof's radar, ahead of the groups: who still has no group for
          this lab. Renders only while someone's actually missing (students
          see their own path via the accept tiles). */}
      {teacher && !isLoading && !error && unassigned.length > 0 ? (
        <Stack gap="md" className="w-full">
          <Text variant="overline">
            Students without a group for this lab · {unassigned.length}
          </Text>
          <Card className="w-full gap-0 p-4">
            <Row gap="md" wrap>
              {unassigned.map((student) => {
                const linked = classUserById.get(String(student.id));
                return (
                  <MemberBlock
                    key={student.id}
                    member={student}
                    name={linked ? switchDisplayName(linked) : student.login}
                  />
                );
              })}
            </Row>
          </Card>
        </Stack>
      ) : null}
      <Stack gap="md" className="w-full">
        <Text variant="overline">Participating groups</Text>
        {error ? (
          <Text variant="error">
            Couldn't load the groups — refresh to retry.
          </Text>
        ) : isLoading ? (
          <Text variant="body2">Loading groups…</Text>
        ) : (
          <>
            {attached.length === 0 && !offerAccept ? (
              <Text variant="body2">No groups in this lab yet.</Text>
            ) : null}
            <div className={GROUPS_GRID}>
              {attached.map((group) => (
                <AttachedGroupTile
                  key={group.id}
                  group={group}
                  users={data?.users}
                  me={me}
                  teacher={teacher}
                  busy={action.busy}
                  min={min}
                  max={max}
                  participating={participating}
                  addCandidates={unassigned}
                  handlers={handlers}
                />
              ))}
              {offerAccept && candidates.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <GhostTile
                        disabled={action.busy}
                        title={
                          teacher
                            ? "Attach one of the class's groups to this lab"
                            : "Pick one of your groups to participate with"
                        }
                      />
                    }
                  >
                    <span className="font-mono">+</span>{" "}
                    {teacher
                      ? "Attach a group"
                      : "Accept with one of your groups"}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {candidates.map((g) => {
                      const fits = g.members.length <= max;
                      return (
                        <DropdownMenuItem
                          key={g.id}
                          disabled={!fits}
                          onClick={() => handlers.attach(g.id)}
                        >
                          {g.name}
                          <span className="font-mono text-muted-foreground text-xs">
                            {fits
                              ? `${g.members.length} member${g.members.length === 1 ? "" : "s"}`
                              : `${g.members.length} members — this lab takes ${sizeLabel}`}
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {offerAccept ? (
                <NewGroupDialog
                  classId={classId}
                  autoJoins={!teacher}
                  triggerLabel={
                    teacher ? "New group" : "Accept with a new group"
                  }
                  onCreated={(group) => handlers.attach(group.id)}
                />
              ) : null}
            </div>
          </>
        )}
      </Stack>
    </>
  );
}

/** A roster member as a small identity block: SWITCH name (THE identity
 *  inside the app) over the mono GitHub login. */
function MemberBlock({
  member,
  name,
  action,
}: {
  member: { id: number; login: string; avatarUrl: string | null };
  name: string;
  action?: ReactNode;
}) {
  return (
    <Row gap="xs">
      <UserAvatar name={name} src={member.avatarUrl} size="sm" />
      <Stack gap="none">
        <Text variant="caption" className="font-medium text-foreground">
          {name}
        </Text>
        <Text variant="caption" className="font-mono">
          @{member.login}
        </Text>
      </Stack>
      {action}
    </Row>
  );
}

/** Prebuilt callbacks — only the section knows the API shape; tiles render. */
type GroupHandlers = {
  attach: (groupId: string) => void;
  detach: (groupId: string) => void;
  join: (groupId: string) => void;
  leave: (groupId: string) => void;
  addMember: (groupId: string, login: string) => void;
  removeMember: (groupId: string, login: string) => void;
};

type AttachedGroupTileProps = {
  group: GroupItem;
  users?: ClassItem["users"];
  me: string | undefined;
  teacher: boolean;
  busy: boolean;
  min: number;
  max: number;
  participating: boolean;
  /** Teacher add-member choices — the WITHOUT-A-GROUP pool only, so an add
   *  can never double-book a student (the server refuses it anyway). */
  addCandidates: ClassItem["students"];
  handlers: GroupHandlers;
};

/** One participating group as a grid tile: name (+ "needs N more" while
 *  under the lab's min) and role-driven actions up top, the roster below. */
function AttachedGroupTile({
  group,
  users,
  me,
  teacher,
  busy,
  min,
  max,
  participating,
  addCandidates,
  handlers,
}: AttachedGroupTileProps) {
  const isMember = group.members.some((m) => m.login === me);
  const mine = !teacher && isMember;
  const missing = min - group.members.length;

  return (
    // The student's OWN group stands out in their role color.
    <Card className={cn("gap-0 p-4", mine && "ring-role-enrolled/60")}>
      <Stack gap="md" className="w-full">
        <Row justify="between" wrap className="w-full">
          <Stack gap="none">
            <Text variant="label" className="font-medium">
              {group.name}
            </Text>
            {mine ? (
              <span className="font-mono text-role-enrolled text-xs">
                your group
              </span>
            ) : null}
            {missing > 0 ? (
              <span className="font-mono text-brand text-xs">
                needs {missing} more member{missing === 1 ? "" : "s"}
              </span>
            ) : null}
          </Stack>
          <Row gap="xs">
            {teacher ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-label={`Add a member to ${group.name}`}
                        title="Add a student without a group to this group"
                        disabled={busy || addCandidates.length === 0}
                      />
                    }
                  >
                    <UserPlus className="size-4 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {addCandidates.map((s) => (
                      <DropdownMenuItem
                        key={s.id}
                        onClick={() => handlers.addMember(group.id, s.login)}
                      >
                        <UserAvatar
                          name={s.login}
                          src={s.avatarUrl}
                          size="sm"
                        />
                        @{s.login}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  disabled={busy}
                  aria-label={`Detach ${group.name} from this lab`}
                  title="Detach this group from the lab (the group itself remains)"
                  onClick={() => handlers.detach(group.id)}
                >
                  <Link2Off className="size-4 text-muted-foreground" />
                </Button>
              </>
            ) : isMember ? (
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={busy}
                title="Leave this group"
                onClick={() => handlers.leave(group.id)}
              >
                Leave
              </Button>
            ) : !participating && group.members.length < max ? (
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={busy}
                title="Join this group and participate in the lab with it"
                onClick={() => handlers.join(group.id)}
              >
                Join
              </Button>
            ) : null}
          </Row>
        </Row>
        <GroupMembers
          members={group.members}
          users={users}
          memberAction={
            teacher
              ? (member) => (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${member.login} from ${group.name}`}
                    title={`Remove @${member.login} from this group`}
                    onClick={() =>
                      handlers.removeMember(group.id, member.login)
                    }
                  >
                    <X className="size-3 text-muted-foreground" />
                  </Button>
                )
              : undefined
          }
        />
      </Stack>
    </Card>
  );
}

/**
 * A group's live roster as small identity blocks: the member's SWITCH
 * identity (real first + last name — THE identity inside the app) over the
 * mono GitHub login. `users` are the raw linked-user rows riding on the
 * groups response, correlated here by github id (an unlinked member falls
 * back to the login). `memberAction` appends a per-member control (e.g.
 * the teacher's remove ×).
 */
function GroupMembers({
  members,
  users,
  memberAction,
}: {
  members: GroupItem["members"];
  users?: ClassItem["users"];
  memberAction?: (member: GroupItem["members"][number]) => ReactNode;
}) {
  const userByGithubId = new Map(users?.map((u) => [u.githubId, u.user]));
  if (members.length === 0) {
    return (
      <Text variant="caption" className="font-mono">
        empty
      </Text>
    );
  }
  return (
    <Stack gap="sm">
      {members.map((member) => {
        const linked = userByGithubId.get(String(member.id));
        return (
          <MemberBlock
            key={member.id}
            member={member}
            name={linked ? switchDisplayName(linked) : member.login}
            action={memberAction?.(member)}
          />
        );
      })}
    </Stack>
  );
}
