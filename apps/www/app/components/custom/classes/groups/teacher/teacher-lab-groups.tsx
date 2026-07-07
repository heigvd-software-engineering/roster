import { ChevronDown, Search, UserPlus, X } from "lucide-react";
import { Fragment, useState } from "react";
import {
  GroupMembers,
  RepoLink,
} from "~/components/custom/classes/groups/shared/group-tile";
import { NewGroupDialog } from "~/components/custom/classes/groups/shared/new-group-dialog";
import { UnassignedPool } from "~/components/custom/classes/groups/shared/unassigned-pool";
import {
  type GroupLabStatus,
  useLabGroups,
} from "~/components/custom/classes/groups/shared/use-lab-groups";
import { LabStats } from "~/components/custom/classes/groups/teacher/lab-stats";
import {
  AvatarCluster,
  LastPush,
  STATUS_SPINE,
  StatusChip,
} from "~/components/custom/classes/groups/teacher/roster";
import { ConfirmDialog } from "~/components/custom/confirm-dialog";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { CAPS_LABEL, Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { GroupItem, LabItem } from "~/lib/api";
import { switchDisplayName, usersByGithubId } from "~/lib/format";
import { cn } from "~/lib/utils";

const HEAD = cn(CAPS_LABEL, "h-9 font-medium text-muted-foreground");

type StatusFilter = "all" | "attention" | "late";
type LabGroups = ReturnType<typeof useLabGroups>;
type RosterRow = {
  group: GroupItem;
  repo: string | null;
  pushedAt: string | null;
  status: GroupLabStatus;
};
/** Statuses that need nothing from anyone — everything else is attention. */
const GOOD_STATUSES: GroupLabStatus[] = ["on_track", "on_time", "ready"];
/** The pool members a teacher may add to a group (linked login required). */
type AddCandidate = LabGroups["unassignedStudents"][number] & { login: string };

/**
 * The TEACHER's lab page is an ASSIGNMENT ROSTER (GitHub-Classroom-like):
 * summary stats, the without-a-group pool, then one table row per group of
 * THIS lab — members, repo, status chip + colored spine. Management is
 * progressive disclosure: the row expands into a drawer with the roster
 * verbs (add from the pool, remove, delete group). The toolbar filters one
 * list (search + status segments), creates a group, and batches the
 * start-of-lab chore (create missing repos).
 */
export function TeacherLabGroups({
  classId,
  lab,
}: {
  classId: string;
  lab: LabItem;
}) {
  const g = useLabGroups(classId, lab);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Add-member candidates = the pool (never double-books), by login.
  const addCandidates = g.unassignedStudents.filter(
    (s): s is AddCandidate => s.login !== null,
  );
  const userByGithubId = usersByGithubId(g.users);

  const rows: (RosterRow & { haystack: string })[] = g.groups.map((group) => ({
    group,
    repo: g.repoFor(group.id),
    pushedAt: group.pushedAt,
    status: g.statusFor(group),
    haystack: [
      group.name,
      ...group.members.map((m) => m.login),
      ...group.members.map((m) => {
        const linked = userByGithubId.get(String(m.id));
        return linked ? switchDisplayName(linked) : "";
      }),
    ]
      .join(" ")
      .toLowerCase(),
  }));

  const attention = rows.filter((r) => !GOOD_STATUSES.includes(r.status));
  const late = rows.filter((r) => r.status === "late");
  const missingRepos = rows.filter((r) => r.status === "no_repo");
  const matchesFilter = (status: GroupLabStatus) =>
    filter === "all" ||
    (filter === "late" ? status === "late" : !GOOD_STATUSES.includes(status));
  const needle = query.toLowerCase();
  const visible = rows.filter(
    (r) => matchesFilter(r.status) && r.haystack.includes(needle),
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
      <LabStats
        stats={[
          { value: g.groups.length, label: "groups" },
          {
            value: g.placedCount,
            total: g.placedCount + g.unassignedStudents.length,
            label: "students placed",
          },
          {
            value: rows.filter((r) => r.repo).length,
            total: rows.length,
            label: "repositories",
          },
          { value: late.length, label: "late", alert: true },
        ]}
      />

      <UnassignedPool students={g.unassignedStudents} users={g.users} />

      <Stack gap="md" className="w-full">
        <RosterToolbar
          g={g}
          classId={classId}
          labId={lab.id}
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          total={rows.length}
          attentionCount={attention.length}
          lateCount={late.length}
          missingCount={missingRepos.length}
        />

        {rows.length === 0 ? (
          <Text variant="body2">
            No groups in this lab yet — create one above.
          </Text>
        ) : (
          <Card className="w-full gap-0 overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={cn(HEAD, "pl-4")}>Group</TableHead>
                  <TableHead className={HEAD}>Members</TableHead>
                  <TableHead className={HEAD}>Repository</TableHead>
                  <TableHead className={HEAD}>Last push</TableHead>
                  <TableHead className={HEAD}>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <GroupRow
                    key={row.group.id}
                    g={g}
                    row={row}
                    max={g.max}
                    deadline={lab.deadline}
                    expanded={expandedId === row.group.id}
                    onToggle={() =>
                      setExpandedId(
                        expandedId === row.group.id ? null : row.group.id,
                      )
                    }
                    addCandidates={addCandidates}
                  />
                ))}
                {visible.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={6}
                      className="py-6 text-center text-muted-foreground text-sm"
                    >
                      No groups match — clear the search or filter.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
        )}
      </Stack>
    </>
  );
}

/** Search + status segments (they filter ONE list) + the toolbar verbs:
 *  batch repo creation, attach an existing group, create a new one. */
function RosterToolbar({
  g,
  classId,
  labId,
  query,
  onQuery,
  filter,
  onFilter,
  total,
  attentionCount,
  lateCount,
  missingCount,
}: {
  g: LabGroups;
  classId: string;
  labId: string;
  query: string;
  onQuery: (query: string) => void;
  filter: StatusFilter;
  onFilter: (filter: StatusFilter) => void;
  total: number;
  attentionCount: number;
  lateCount: number;
  /** Complete groups still lacking their repo — the batch button's scope. */
  missingCount: number;
}) {
  return (
    <Row gap="sm" wrap className="w-full">
      <div className="relative">
        <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filter groups or students…"
          aria-label="Filter groups or students"
          className="h-8 w-56 pl-8"
        />
      </div>
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        value={[filter]}
        onValueChange={(value: string[]) => {
          if (value.length > 0) onFilter(value[0] as StatusFilter);
        }}
        aria-label="Filter by status"
      >
        <ToggleGroupItem value="all" title="Show every participating group">
          All <Count n={total} />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="attention"
          title="Groups that are late, untouched, missing their repo, or under the minimum size"
        >
          Needs attention <Count n={attentionCount} />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="late"
          title="Groups whose last push came after the deadline"
        >
          Late <Count n={lateCount} />
        </ToggleGroupItem>
      </ToggleGroup>
      <span className="flex-1" />
      {missingCount > 0 ? (
        <Button
          size="sm"
          type="button"
          disabled={g.busy}
          title="Create the work repository for every complete group that lacks one"
          onClick={() => g.createMissingRepos()}
        >
          Create {missingCount} missing{" "}
          {missingCount === 1 ? "repository" : "repositories"}
        </Button>
      ) : null}
      <NewGroupDialog
        classId={classId}
        labId={labId}
        autoJoins={false}
        triggerLabel="New group"
        trigger={
          <Button
            variant="outline"
            size="sm"
            type="button"
            title="Create a new group for this lab"
          />
        }
        onCreated={g.revalidate}
      />
    </Row>
  );
}

/** One roster row (spine + chip carry the same status), plus its expanded
 *  management drawer when toggled open. */
function GroupRow({
  g,
  row: { group, repo, pushedAt, status },
  max,
  deadline,
  expanded,
  onToggle,
  addCandidates,
}: {
  g: LabGroups;
  row: RosterRow;
  max: number;
  deadline: string;
  expanded: boolean;
  onToggle: () => void;
  addCandidates: AddCandidate[];
}) {
  return (
    <Fragment>
      <TableRow>
        <TableCell className={cn("border-l-2 py-3 pl-4", STATUS_SPINE[status])}>
          <div className="max-w-48 truncate font-medium text-sm">
            {group.name}
          </div>
          <div
            className={cn(
              "font-mono text-xs",
              status === "under_min" ? "text-brand" : "text-muted-foreground",
            )}
          >
            {group.members.length}/{max} members
            {status === "under_min"
              ? ` · needs ${g.min - group.members.length} more`
              : ""}
          </div>
        </TableCell>
        <TableCell>
          <AvatarCluster members={group.members} />
        </TableCell>
        <TableCell>
          {repo ? (
            <RepoLink fullName={repo} />
          ) : status === "no_repo" ? (
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={g.busy}
              title="Create the group's work repository and grant it access"
              onClick={() => g.createRepo(group.id)}
            >
              Create repository
            </Button>
          ) : (
            <span
              className="font-mono text-muted-foreground text-xs"
              title="The repository forms when the group is complete"
            >
              —
            </span>
          )}
        </TableCell>
        <TableCell>
          <LastPush pushedAt={pushedAt} status={status} deadline={deadline} />
        </TableCell>
        <TableCell>
          <StatusChip status={status} />
        </TableCell>
        <TableCell className="pr-3 text-right">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-expanded={expanded}
            aria-label={`Manage ${group.name}`}
            title="Manage this group's members and lab participation"
            onClick={onToggle}
          >
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          </Button>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="hover:bg-transparent">
          <TableCell
            colSpan={6}
            className={cn("border-l-2 p-0", STATUS_SPINE[status])}
          >
            <GroupDrawer
              g={g}
              group={group}
              repo={repo}
              addCandidates={addCandidates}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

/** The row's management drawer: the full roster (remove ×, add from the
 *  pool) and the lab-participation verbs. */
function GroupDrawer({
  g,
  group,
  repo,
  addCandidates,
}: {
  g: LabGroups;
  group: GroupItem;
  repo: string | null;
  addCandidates: AddCandidate[];
}) {
  return (
    <div className="mx-4 mb-4 grid gap-6 rounded-md bg-muted/50 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
      <Stack gap="md">
        <Text variant="overline">Members</Text>
        <GroupMembers
          members={group.members}
          users={g.users}
          // Card-like rows: consistent width, the remove × pinned to the
          // right edge instead of trailing the (variable-length) name.
          memberClassName="w-full max-w-80 rounded-md bg-card px-3 py-2 ring-1 ring-foreground/10"
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
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                type="button"
                className="self-start"
                disabled={g.busy || addCandidates.length === 0}
                title="Add a student without a group to this group"
              />
            }
          >
            <UserPlus className="size-3.5 text-muted-foreground" />
            Add from the pool ({addCandidates.length})
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {addCandidates.map((s) => (
              <DropdownMenuItem
                key={s.githubId}
                onClick={() => g.addMember(group.id, s.login)}
              >
                <UserAvatar name={s.login} src={s.avatarUrl} size="sm" />@
                {s.login}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </Stack>
      <Stack
        gap="md"
        className="sm:min-w-48 sm:border-border sm:border-l sm:pl-6"
      >
        <Text variant="overline">Group actions</Text>
        <ConfirmDialog
          title={`Delete ${group.name}?`}
          description="The group and its GitHub team are removed. Students can form a new group for this lab afterwards."
          confirmLabel="Delete group"
          onConfirm={() => g.deleteGroup(group.id)}
          trigger={
            <Button
              variant="outline"
              size="sm"
              type="button"
              // The server refuses anyway (orphan protection, 409 has_repo)
              // — the disabled state just says so up front.
              disabled={g.busy || repo !== null}
              title={
                repo !== null
                  ? "The group's work repository exists — it can't be deleted"
                  : "Delete this group (and its GitHub team)"
              }
            >
              Delete group
            </Button>
          }
        />
      </Stack>
    </div>
  );
}

/** The segmented filter's mono count. */
function Count({ n }: { n: number }) {
  return (
    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
      {n}
    </span>
  );
}
