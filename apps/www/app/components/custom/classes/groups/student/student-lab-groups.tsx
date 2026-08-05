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
import { useLabGroups } from "~/components/custom/classes/groups/shared/use-lab-groups";
import { StartLabCard } from "~/components/custom/classes/groups/student/start-lab-card";
import { DisabledReason } from "~/components/custom/disabled-reason";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";
import type { LabItem } from "~/lib/api";
import { cn } from "~/lib/utils";

/**
 * The STUDENT's lab surface, BOTH modes: one structure, mode-specific copy.
 *
 * INDIVIDUAL: your solo card (1/3, a ghost until accepted) beside the
 * start-lab card (2/3), whose accept state creates group + repo in one click.
 *
 * GROUP, BROWSE (not in a group yet): the same GROUP WALL the teacher sees,
 * without the management verbs. Every group's full roster, and an OPEN SEAT
 * is the join affordance, because taking a seat is what joining is. Amber
 * seats mark groups still short of the minimum. Plus "new group", a fresh
 * group for THIS lab that you auto-join.
 *
 * GROUP, YOURS: the others disappear, and your group card (1/3) sits beside
 * the same start-lab card (2/3) that owns the work repo. Your open seats are
 * placeholders, not verbs: classmates seat themselves.
 */
export function StudentLabGroups({
  classId,
  lab,
}: {
  classId: string;
  lab: LabItem;
}) {
  const { github } = useAuth();
  const me = github?.login;
  const g = useLabGroups(classId, lab.id);

  const mine = g.groups.find((group) =>
    group.members.some((m) => m.login === me),
  );

  if (g.error) {
    return (
      <Text variant="error">Couldn't load the groups — refresh to retry.</Text>
    );
  }
  if (g.isLoading) {
    return <Text variant="body2">Loading groups…</Text>;
  }

  if (lab.groupMode === "individual") {
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
        <Text variant="overline">Your lab</Text>
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
                {mine ? "your solo lab" : "your solo lab — not accepted yet"}
              </MineNote>
            }
          />
          <div className="lg:col-span-2">
            <StartLabCard
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
          <Text variant="overline">Your group</Text>
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
                      ? "The group's work repository exists — ask your teacher to move you."
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
            {/* The lab starts here once the group reaches the minimum size,
                and STAYS once the repo exists: a locked group can drop below
                min via the teacher, and the survivors still need their repo. */}
            {mine.members.length >= g.min || locked ? (
              <div className="lg:col-span-2">
                <StartLabCard
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
        <Text variant="overline">Groups in this lab</Text>
        {g.groups.length === 0 ? (
          <Text variant="body2">
            No groups in this lab yet — start one below.
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
            labId={lab.id}
            autoJoins
            triggerLabel="New group"
            onCreated={g.revalidate}
          />
        </div>
      </Stack>
    </>
  );
}

/** The "this one is yours" line under the card's name: enrolled color while
 *  it's really yours, muted for the not-yet-accepted ghost. */
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
      className={cn("font-mono", active && "text-role-enrolled")}
    >
      {children}
    </Text>
  );
}

/** The student's seat NATURE: taking it IS joining, in the enrolled accent.
 *  The required variant keeps the base's warning tint. */
function JoinSeat({
  required = false,
  className,
  ...props
}: ComponentProps<typeof SeatButton>) {
  return (
    <SeatButton
      required={required}
      title="Join this group for the lab"
      className={cn(
        !required &&
          "hover:border-role-enrolled hover:bg-role-enrolled/5 hover:text-foreground",
        className,
      )}
      {...props}
    >
      {required ? "Join — needed to form" : "Join this group"}
    </SeatButton>
  );
}

/** Your own group's open spot: someone ELSE seats themselves here, so no
 *  verb on this card. */
function VacantSeat({ required = false }: { required?: boolean }) {
  return (
    <SeatSlot
      required={required}
      title="Classmates join from their own lab page — tell them your group's name"
    >
      {required ? "Needs a member to form" : "Open seat"}
    </SeatSlot>
  );
}

/** A seat behind the repo lock: capacity remains, but only the teacher moves
 *  people once the work repository exists. Brand red, because the lock is the
 *  seat's dominant fact whatever the group's size. */
function LockedSeat() {
  return (
    <SeatSlot
      className="border-brand/55 bg-brand/5 text-brand"
      title="This group's repository exists — only your teacher can add members"
    >
      Locked seat — ask your professor
    </SeatSlot>
  );
}
