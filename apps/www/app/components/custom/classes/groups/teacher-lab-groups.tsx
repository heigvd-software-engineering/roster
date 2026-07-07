import { Link2Off, UserPlus, X } from "lucide-react";
import {
  GROUPS_GRID,
  GroupTile,
  MissingMembersNote,
  RepoLink,
} from "~/components/custom/classes/groups/group-tile";
import { NewGroupDialog } from "~/components/custom/classes/groups/new-group-dialog";
import { UnassignedPool } from "~/components/custom/classes/groups/unassigned-pool";
import { useLabGroups } from "~/components/custom/classes/groups/use-lab-groups";
import { ConfirmDialog } from "~/components/custom/confirm-dialog";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
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
import type { LabItem } from "~/lib/api";

/**
 * The TEACHER's group management for one lab: the students-without-a-group
 * pool (shared with the student page; hidden when everyone's placed), the
 * participating groups with full roster management (add from the pool only
 * — the server refuses double-booking anyway — remove anyone, detach behind
 * a confirm), attach any class group, create groups without joining them.
 */
export function TeacherLabGroups({
  classId,
  lab,
}: {
  classId: string;
  lab: LabItem;
}) {
  const g = useLabGroups(classId, lab);
  // Add-member candidates = the pool (never double-books), by login.
  const addCandidates = g.unassignedStudents.filter(
    (s): s is typeof s & { login: string } => s.login !== null,
  );

  if (g.error) {
    return (
      <Text variant="error">Couldn't load the groups — refresh to retry.</Text>
    );
  }
  if (g.isLoading) {
    return <Text variant="body2">Loading groups…</Text>;
  }

  return (
    <>
      <UnassignedPool students={g.unassignedStudents} users={g.users} />

      <Stack gap="md" className="w-full">
        <Text variant="overline">Participating groups</Text>
        {g.attached.length === 0 && g.unattached.length === 0 ? (
          <Text variant="body2">No groups in this lab yet.</Text>
        ) : null}
        <div className={GROUPS_GRID}>
          {g.attached.map((group) => (
            <GroupTile
              key={group.id}
              group={group}
              users={g.users}
              notes={<MissingMembersNote group={group} min={g.min} />}
              footer={
                g.repoFor(group.id) ? (
                  <RepoLink fullName={g.repoFor(group.id) ?? ""} />
                ) : group.members.length >= g.min ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    className="self-start"
                    disabled={g.busy}
                    title="Create the group's work repository and grant it access"
                    onClick={() => g.createRepo(group.id)}
                  >
                    Create repository
                  </Button>
                ) : null
              }
              actions={
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
                          disabled={g.busy || addCandidates.length === 0}
                        />
                      }
                    >
                      <UserPlus className="size-4 text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {addCandidates.map((s) => (
                        <DropdownMenuItem
                          key={s.githubId}
                          onClick={() => g.addMember(group.id, s.login)}
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
                  <ConfirmDialog
                    title={`Detach ${group.name}?`}
                    description="The group itself remains and keeps its members — it just stops participating in this lab. You can re-attach it anytime."
                    confirmLabel="Detach group"
                    onConfirm={() => g.detach(group.id)}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        disabled={g.busy}
                        aria-label={`Detach ${group.name} from this lab`}
                        title="Detach this group from the lab (the group itself remains)"
                      >
                        <Link2Off className="size-4 text-muted-foreground" />
                      </Button>
                    }
                  />
                </>
              }
              memberAction={(member) => (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  disabled={g.busy}
                  aria-label={`Remove ${member.login} from ${group.name}`}
                  title={`Remove @${member.login} from this group`}
                  onClick={() => g.removeMember(group.id, member.login)}
                >
                  <X className="size-3 text-muted-foreground" />
                </Button>
              )}
            />
          ))}
          {g.unattached.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <GhostTile
                    disabled={g.busy}
                    title="Attach one of the class's groups to this lab"
                  />
                }
              >
                <span className="font-mono">+</span> Attach a group
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {g.unattached.map((group) => {
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
            autoJoins={false}
            triggerLabel="New group"
            onCreated={(group) => g.attach(group.id)}
          />
        </div>
      </Stack>
    </>
  );
}
