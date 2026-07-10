import {
  GROUPS_GRID,
  GroupTile,
  MissingMembersNote,
} from "~/components/custom/classes/groups/shared/group-tile";
import { NewGroupDialog } from "~/components/custom/classes/groups/shared/new-group-dialog";
import { UnassignedPool } from "~/components/custom/classes/groups/shared/unassigned-pool";
import { useLabGroups } from "~/components/custom/classes/groups/shared/use-lab-groups";
import { StartLabCard } from "~/components/custom/classes/groups/student/start-lab-card";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";
import type { LabItem } from "~/lib/api";

/**
 * The STUDENT's group view for one lab (per-lab model), in two states:
 *
 * BROWSE (not in a group yet) — this lab's groups, each joinable if it has
 * room, plus "new group" (a fresh group for THIS lab; you auto-join it).
 *
 * YOUR GROUP (in a group) — the others disappear; your group tile (1/3)
 * sits beside the start-lab card (2/3) that owns the work repo.
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

  if (mine) {
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
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={g.busy}
                  title="Leave this group"
                  onClick={() => g.leave(mine.id)}
                >
                  Leave
                </Button>
              }
            />
            {/* The lab starts here once the group reaches the minimum size:
                create the work repo, then clone it. */}
            {mine.members.length >= g.min ? (
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
          {g.groups.map((group) => (
            <GroupTile
              key={group.id}
              group={group}
              users={g.users}
              notes={<MissingMembersNote group={group} min={g.min} />}
              actions={
                group.members.length < g.max ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={g.busy}
                    title="Join this group for the lab"
                    onClick={() => g.join(group.id)}
                  >
                    Join
                  </Button>
                ) : null
              }
            />
          ))}
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
