import {
  GROUPS_GRID,
  GroupTile,
  MissingMembersNote,
} from "~/components/custom/classes/groups/group-tile";
import { NewGroupDialog } from "~/components/custom/classes/groups/new-group-dialog";
import { StartLabCard } from "~/components/custom/classes/groups/start-lab-card";
import { UnassignedPool } from "~/components/custom/classes/groups/unassigned-pool";
import { useLabGroups } from "~/components/custom/classes/groups/use-lab-groups";
import { GhostTile } from "~/components/custom/layout/ghost-tile";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useAuth } from "~/contexts/auth-context";
import type { LabItem } from "~/lib/api";

/**
 * The STUDENT's group view for one lab, in two states:
 *
 * BROWSE (not participating yet) — the language is ACCEPTING the lab: join a
 * participating group with room, accept with one of your existing groups
 * (misfits listed disabled with the reason), or accept with a new group (it
 * attaches immediately).
 *
 * YOUR GROUP (participating) — the other groups disappear; your group tile
 * (1/3) sits beside the start-lab card (2/3) that owns the work repo:
 * create it, then clone it.
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
  const g = useLabGroups(classId, lab);

  const mine = g.attached.find((group) =>
    group.members.some((m) => m.login === me),
  );
  // Accept candidates: YOUR unattached groups only.
  const candidates = g.unattached.filter((group) =>
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
        <Text variant="overline">Participating groups</Text>
        {g.attached.length === 0 ? (
          <Text variant="body2">
            No groups in this lab yet — accept it below.
          </Text>
        ) : null}
        <div className={GROUPS_GRID}>
          {g.attached.map((group) => (
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
                    title="Join this group and participate in the lab with it"
                    onClick={() => g.join(group.id)}
                  >
                    Join
                  </Button>
                ) : null
              }
            />
          ))}
          {candidates.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <GhostTile
                    disabled={g.busy}
                    title="Pick one of your groups to participate with"
                  />
                }
              >
                <span className="font-mono">+</span> Accept with one of your
                groups
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {candidates.map((group) => {
                  const fits = group.members.length <= g.max;
                  return (
                    <DropdownMenuItem
                      key={group.id}
                      disabled={!fits}
                      onClick={() => g.attach(group.id)}
                    >
                      {group.name}
                      <span className="font-mono text-muted-foreground text-xs">
                        {fits
                          ? `${group.members.length} member${group.members.length === 1 ? "" : "s"}`
                          : `${group.members.length} members — this lab takes ${g.sizeLabel}`}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <NewGroupDialog
            classId={classId}
            autoJoins
            triggerLabel="Accept with a new group"
            onCreated={(group) => g.attach(group.id)}
          />
        </div>
      </Stack>
    </>
  );
}
