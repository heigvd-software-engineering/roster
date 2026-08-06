import type { ComponentProps, ReactNode } from "react";
import {
  GROUP_WALL,
  GroupCard,
} from "~/components/custom/classes/groups/shared/group-card";
import { NewGroupDialog } from "~/components/custom/classes/groups/shared/new-group-dialog";
import {
  SeatButton,
  SeatSlot,
} from "~/components/custom/classes/groups/shared/seats";
import { UnassignedPool } from "~/components/custom/classes/groups/shared/unassigned-pool";
import { useAssignmentGroups } from "~/components/custom/classes/groups/shared/use-assignment-groups";
import { StartAssignmentCard } from "~/components/custom/classes/groups/student/start-assignment-card";
import { DisabledReason } from "~/components/custom/disabled-reason";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";
import type { AssignmentItem } from "~/lib/api";
import { cn } from "~/lib/utils";

/**
 * The STUDENT's assignment surface, BOTH modes: one structure, mode-specific
 * copy.
 *
 * INDIVIDUAL: your solo card (1/3, a ghost until accepted) beside the
 * start-assignment card (2/3), whose accept state creates group + repo in one
 * click.
 *
 * GROUP, BROWSE (not in a group yet): the same GROUP WALL the teacher sees,
 * without the management verbs. Every group's full roster, and an OPEN SEAT
 * is the join affordance, because taking a seat is what joining is. A seat
 * still needed to reach the minimum says so. Plus "new group", a fresh group
 * for THIS assignment that you auto-join.
 *
 * GROUP, YOURS: the others disappear, and your group card (1/3) sits beside the
 * same start-assignment card (2/3) that owns the work repo. Your open seats are
 * placeholders, not verbs: classmates seat themselves.
 */
export function StudentAssignmentGroups({
  classId,
  assignment,
}: {
  classId: string;
  assignment: AssignmentItem;
}) {
  const { github } = useAuth();
  const me = github?.login;
  const g = useAssignmentGroups(classId, assignment.id);

  const mine = g.groups.find((group) =>
    group.members.some((m) => m.login === me),
  );

  if (g.error) {
    return (
      <Text variant="error">Couldn't load the groups. Refresh to retry.</Text>
    );
  }
  if (g.isLoading) {
    return <Text variant="body2">Loading groups…</Text>;
  }

  if (assignment.groupMode === "individual") {
    // The server models an individual acceptance as a SOLO GROUP named after
    // the student, so render exactly that in the group flow's own skeleton.
    // Before accepting, the card is a GHOST of the same shape (dimmed you),
    // so accepting changes state, never layout. min = max = 1: no seats.
    const solo = mine ?? {
      id: "ghost",
      name: me ?? "you",
      slug: "",
      members: github
        ? [{ id: github.id, login: github.login, avatarUrl: github.avatarUrl }]
        : [],
      repoFullName: null,
      repoStatus: "ok" as const,
      pushedAt: null,
      repoCreatedAt: null,
      lastCommit: null,
    };
    const repo = mine ? g.repoFor(mine.id) : null;
    return (
      <Stack gap="md" className="w-full">
        <Text variant="heading">Your assignment</Text>
        <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3">
          <GroupCard
            group={solo}
            users={g.users}
            min={1}
            max={1}
            highlight={mine !== undefined}
            memberClassName={mine ? undefined : "opacity-55"}
            notes={
              <MineNote active={mine !== undefined}>
                {mine
                  ? "your solo assignment"
                  : "your solo assignment, not accepted yet"}
              </MineNote>
            }
          />
          <div className="lg:col-span-2">
            <StartAssignmentCard
              mode="individual"
              accepted={mine !== undefined}
              repoFullName={repo}
              repoStatus={mine?.repoStatus}
              busy={g.busy}
              onAccept={() => g.acceptIndividual()}
              onCreate={() => mine && g.createRepo(mine.id)}
            />
          </div>
        </div>
      </Stack>
    );
  }

  if (mine) {
    // Once the work repo exists the group is LOCKED: the server refuses
    // join/leave (409 has_repo), and the disabled state says so up front.
    const locked = mine.repoFullName !== null;
    return (
      <>
        <UnassignedPool students={g.unassignedStudents} users={g.users} />
        <Stack gap="md" className="w-full">
          <Text variant="heading">Your group</Text>
          <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3">
            <GroupCard
              group={mine}
              users={g.users}
              min={g.min}
              max={g.max}
              highlight
              notes={<MineNote>your group</MineNote>}
              actions={
                <DisabledReason
                  reason={
                    locked
                      ? "The group's work repository exists. Ask your teacher to move you."
                      : null
                  }
                >
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={g.busy || locked}
                    title={locked ? undefined : "Leave this group"}
                    onClick={() => g.leave(mine.id)}
                  >
                    Leave
                  </Button>
                </DisabledReason>
              }
              renderOpenSeat={(required) =>
                locked ? <LockedSeat /> : <VacantSeat required={required} />
              }
            />
            {/* The assignment starts here once the group reaches the minimum size,
                and STAYS once the repo exists: a locked group can drop below
                min via the teacher, and the survivors still need their repo. */}
            {mine.members.length >= g.min || locked ? (
              <div className="lg:col-span-2">
                <StartAssignmentCard
                  repoFullName={g.repoFor(mine.id)}
                  repoStatus={mine.repoStatus}
                  busy={g.busy}
                  onCreate={() => g.createRepo(mine.id)}
                />
              </div>
            ) : null}
          </div>
        </Stack>
      </>
    );
  }

  return (
    <>
      <UnassignedPool students={g.unassignedStudents} users={g.users} />
      <Stack gap="md" className="w-full">
        <Text variant="heading">Groups in this assignment</Text>
        {g.groups.length === 0 ? (
          <Text variant="body2">
            No groups in this assignment yet. Start one below.
          </Text>
        ) : null}
        <div className={GROUP_WALL}>
          {g.groups.map((group) => {
            // Same lock as the "mine" branch above: repo exists ⇒ only the
            // teacher changes membership. A FULL group has no open seat, so
            // the join affordance disappears with the room.
            const locked = group.repoFullName !== null;
            return (
              <GroupCard
                key={group.id}
                group={group}
                users={g.users}
                min={g.min}
                max={g.max}
                renderOpenSeat={(required) =>
                  // The seat survives the lock, since hiding it would make a
                  // 2/3 locked group read as full. Only its nature changes:
                  // the teacher is the path onto a locked team.
                  locked ? (
                    <LockedSeat />
                  ) : (
                    <JoinSeat
                      required={required}
                      disabled={g.busy}
                      onClick={() => g.join(group.id)}
                    />
                  )
                }
              />
            );
          })}
          <NewGroupDialog
            classId={classId}
            assignmentId={assignment.id}
            autoJoins
            triggerLabel="New group"
            onCreated={g.revalidate}
          />
        </div>
      </Stack>
    </>
  );
}

/** The "this one is yours" line under the card's name: at full strength
 *  while it's really yours, muted for the not-yet-accepted ghost. */
function MineNote({
  active = true,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Text
      variant="caption"
      as="span"
      className={cn(active && "font-medium text-foreground")}
    >
      {children}
    </Text>
  );
}

/** The student's seat NATURE: taking it IS joining. */
function JoinSeat({
  required = false,
  ...props
}: ComponentProps<typeof SeatButton>) {
  return (
    <SeatButton
      required={required}
      title="Join this group for the assignment"
      {...props}
    >
      {required ? "Join (required to form)" : "Join this group"}
    </SeatButton>
  );
}

/** Your own group's open spot: someone ELSE seats themselves here, so no
 *  verb on this card. */
function VacantSeat({ required = false }: { required?: boolean }) {
  return (
    <SeatSlot
      required={required}
      title="Classmates join from their own assignment page. Tell them your group's name."
    >
      {required ? "Needs a member to form" : "Open seat"}
    </SeatSlot>
  );
}

/** A seat behind the repo lock: capacity remains, but only the teacher moves
 *  people once the work repository exists. */
function LockedSeat() {
  return (
    <SeatSlot title="This group's repository exists, so only your teacher can add members">
      Locked seat: ask your teacher
    </SeatSlot>
  );
}
