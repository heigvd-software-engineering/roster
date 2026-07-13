import {
  GROUPS_GRID,
  GroupTile,
  MissingMembersNote,
} from "~/components/custom/classes/groups/shared/group-tile";
import { NewGroupDialog } from "~/components/custom/classes/groups/shared/new-group-dialog";
import { UnassignedPool } from "~/components/custom/classes/groups/shared/unassigned-pool";
import { useLabGroups } from "~/components/custom/classes/groups/shared/use-lab-groups";
import { StartLabCard } from "~/components/custom/classes/groups/student/start-lab-card";
import { DisabledReason } from "~/components/custom/disabled-reason";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";
import type { LabItem } from "~/lib/api";

/**
 * The STUDENT's lab surface, BOTH modes — one structure, mode-specific copy:
 *
 * INDIVIDUAL — your solo tile (1/3, a ghost until accepted) beside the
 * start-lab card (2/3), whose accept state creates group + repo in one click.
 *
 * GROUP, BROWSE (not in a group yet) — this lab's groups, each joinable if
 * it has room, plus "new group" (a fresh group for THIS lab; you auto-join).
 *
 * GROUP, YOURS — the others disappear; your group tile (1/3) sits beside
 * the same start-lab card (2/3) that owns the work repo.
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
    // the student — render exactly that, in the group flow's own skeleton.
    // Before accepting, the tile is a GHOST of the same shape (dimmed you),
    // so accepting changes state, never layout.
    const solo = mine ?? {
      id: "ghost",
      name: me ?? "you",
      slug: "",
      members: github
        ? [{ id: github.id, login: github.login, avatarUrl: github.avatarUrl }]
        : [],
      repoFullName: null,
      pushedAt: null,
      repoCreatedAt: null,
    };
    const repo = mine ? g.repoFor(mine.id) : null;
    return (
      <Stack gap="md" className="w-full">
        <Text variant="overline">Your lab</Text>
        <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3">
          <GroupTile
            group={solo}
            users={g.users}
            highlight={mine !== undefined}
            memberClassName={mine ? undefined : "opacity-55"}
            notes={
              <span
                className={
                  mine
                    ? "font-mono text-role-enrolled text-xs"
                    : "font-mono text-muted-foreground text-xs"
                }
              >
                {mine ? "your solo lab" : "your solo lab — not accepted yet"}
              </span>
            }
          />
          <div className="lg:col-span-2">
            <StartLabCard
              mode="individual"
              accepted={mine !== undefined}
              repoFullName={repo}
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
    // Once the work repo exists the group is LOCKED — the server refuses
    // join/leave (409 has_repo); the disabled state just says so up front
    // (same pattern as the teacher's Delete button).
    const locked = mine.repoFullName !== null;
    return (
      <>
        {/* Who still needs a team — the students' organizing aid. */}
        <UnassignedPool students={g.unassignedStudents} users={g.users} />
        <Stack gap="md" className="w-full">
          <Text variant="overline">Your group</Text>
          <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3">
            <GroupTile
              group={mine}
              users={g.users}
              highlight
              notes={
                <>
                  <span className="font-mono text-role-enrolled text-xs">
                    your group
                  </span>
                  <MissingMembersNote group={mine} min={g.min} />
                </>
              }
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
            />
            {/* The lab starts here once the group reaches the minimum size —
                and STAYS once the repo exists: a locked group can drop below
                min via the teacher, and the survivors still need their repo. */}
            {mine.members.length >= g.min || locked ? (
              <div className="lg:col-span-2">
                <StartLabCard
                  repoFullName={g.repoFor(mine.id)}
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
      {/* Who still needs a team — the students' organizing aid. */}
      <UnassignedPool students={g.unassignedStudents} users={g.users} />
      <Stack gap="md" className="w-full">
        <Text variant="overline">Groups in this lab</Text>
        {g.groups.length === 0 ? (
          <Text variant="body2">
            No groups in this lab yet — start one below.
          </Text>
        ) : null}
        <div className={GROUPS_GRID}>
          {g.groups.map((group) => {
            // Same lock as the "mine" branch above: repo exists ⇒ only the
            // teacher changes membership.
            const locked = group.repoFullName !== null;
            return (
              <GroupTile
                key={group.id}
                group={group}
                users={g.users}
                notes={<MissingMembersNote group={group} min={g.min} />}
                actions={
                  group.members.length < g.max ? (
                    <DisabledReason
                      reason={
                        locked
                          ? "This group's repository exists — only your teacher can add members."
                          : null
                      }
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={g.busy || locked}
                        title={
                          locked ? undefined : "Join this group for the lab"
                        }
                        onClick={() => g.join(group.id)}
                      >
                        Join
                      </Button>
                    </DisabledReason>
                  ) : null
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
