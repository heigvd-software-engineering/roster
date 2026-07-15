import { Download, Search, UserPlus, X } from "lucide-react";
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
import { CloneAllDialog } from "~/components/custom/classes/groups/teacher/clone-all-dialog";
import { LabStats } from "~/components/custom/classes/groups/teacher/lab-stats";
import {
  AvatarCluster,
  LastPush,
  STATUS_SPINE,
  StatusChip,
} from "~/components/custom/classes/groups/teacher/roster";
import { ConfirmDialog } from "~/components/custom/confirm-dialog";
import { DisabledReason } from "~/components/custom/disabled-reason";
import { DisclosureToggle } from "~/components/custom/disclosure-toggle";
import { Hint } from "~/components/custom/hint";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { CAPS_LABEL, Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
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
import { usersByGithubId } from "~/lib/format";
import { type PersonIdentity, personIdentity } from "~/lib/identity";
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
  const g = useLabGroups(classId, lab.id);
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
      ...group.members.flatMap((m) => {
        const { name, handle } = personIdentity(
          m,
          userByGithubId.get(String(m.id)),
        );
        return [name, handle];
      }),
    ]
      .join(" ")
      .toLowerCase(),
  }));

  const attention = rows.filter((r) => !GOOD_STATUSES.includes(r.status));
  const late = rows.filter((r) => r.status === "late");
  const missingRepos = rows.filter((r) => r.status === "no_repo");
  // Every work repo of this lab, filter-independent: "clone all" means all.
  const repos = rows
    .map((r) => r.repo)
    .filter((repo): repo is string => repo !== null);
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
          repos={repos}
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
 *  batch repo creation, create a group, and clone every work repo. */
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
  repos,
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
  /** Full names of every work repo in this lab — the clone block's scope. */
  repos: string[];
}) {
  const [cloneOpen, setCloneOpen] = useState(false);
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
        // Repo creation LOCKS each group (students can't join/leave after) —
        // worth an explicit confirm on the batch, like the drawer's Delete.
        <ConfirmDialog
          title="Create the missing repositories?"
          description="Every complete group that lacks a repository gets one. Creating a repository locks its group: students can no longer join or leave on their own."
          confirmLabel="Create repositories"
          onConfirm={() => g.createMissingRepos()}
          trigger={
            <Button
              size="sm"
              type="button"
              disabled={g.busy}
              title="Create the work repository for every complete group that lacks one"
            >
              Create {missingCount} missing{" "}
              {missingCount === 1 ? "repository" : "repositories"}
            </Button>
          }
        />
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
      <Button
        variant="outline"
        size="sm"
        type="button"
        // Nothing to clone before the first repo exists.
        disabled={repos.length === 0}
        title={
          repos.length === 0
            ? "No work repositories to clone yet"
            : "Copy a git clone command for every work repository in this lab"
        }
        onClick={() => setCloneOpen(true)}
      >
        <Download className="size-3.5 text-muted-foreground" />
        Clone
        <Count n={repos.length} />
      </Button>
      <CloneAllDialog
        repos={repos}
        open={cloneOpen}
        onOpenChange={setCloneOpen}
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
          <AvatarCluster members={group.members} users={g.users} />
        </TableCell>
        <TableCell>
          {repo ? (
            <RepoLink fullName={repo} />
          ) : status === "no_repo" ? (
            // Same confirm gate as the batch toolbar button: creating the
            // repo LOCKS the group, one click shouldn't do that silently.
            <ConfirmDialog
              title="Create the work repository?"
              description="This locks the group: once the repository exists, students can no longer join or leave on their own."
              confirmLabel="Create repository"
              onConfirm={() => g.createRepo(group.id)}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={g.busy}
                  title="Create the group's work repository and grant it access"
                >
                  Create repository
                </Button>
              }
            />
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
          <DisclosureToggle
            expanded={expanded}
            onToggle={onToggle}
            label={`Manage ${group.name}`}
            title="Manage this group's members and lab participation"
          />
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
  const userByGithubId = usersByGithubId(g.users);
  return (
    <div className="mx-4 mb-4 grid gap-6 rounded-md bg-muted/50 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
      <Stack gap="md">
        <Row gap="xs">
          <Text variant="overline">Members</Text>
          {repo !== null ? (
            // The teacher's roster verbs stay UNLOCKED on a repo-owning
            // group (only student self-service froze) — surface the
            // consequences without a confirm on every click.
            <Hint
              variant="warning"
              text="repo exists"
              title="This group already has its work repository"
            >
              Membership changes here still work — only student self-service is
              locked. A student you add immediately sees everything the group
              has pushed; a student you remove loses access but keeps whatever
              they already cloned.
            </Hint>
          ) : null}
        </Row>
        <GroupMembers
          members={group.members}
          users={g.users}
          // Card-like rows: consistent width, the remove × pinned to the
          // right edge instead of trailing the (variable-length) name.
          memberClassName="w-full max-w-80 rounded-md bg-card px-3 py-2 ring-1 ring-foreground/10"
          memberAction={(member) => (
            <Row gap="xs">
              {userByGithubId.has(String(member.id)) ? null : (
                // The join flow requires a SWITCH sign-in — an unlinked
                // member entered the org some other way (e.g. a direct
                // GitHub invitation) and their identity is only a login.
                <Hint
                  variant="warning"
                  label={`Unverified GitHub account @${member.login}`}
                  title="No SWITCH identity"
                >
                  This GitHub account isn't linked to any SWITCH edu-ID sign-in,
                  so it can't be matched to an enrolled student. It likely
                  entered the organization outside the app — e.g. a direct
                  GitHub invitation.
                </Hint>
              )}
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
            </Row>
          )}
        />
        <AddFromPool
          candidates={addCandidates}
          identityFor={(s) => personIdentity(s, userByGithubId.get(s.githubId))}
          disabled={g.busy}
          onAdd={(login) => g.addMember(group.id, login)}
        />
      </Stack>
      <Stack
        gap="md"
        className="sm:min-w-48 sm:border-border sm:border-l sm:pl-6"
      >
        <Text variant="overline">Group actions</Text>
        <DisabledReason
          reason={
            repo !== null
              ? "The group's work repository exists — it can't be deleted"
              : null
          }
        >
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
                    ? undefined
                    : "Delete this group (and its GitHub team)"
                }
              >
                Delete group
              </Button>
            }
          />
        </DisabledReason>
      </Stack>
    </div>
  );
}

/** "Add from the pool" — a searchable picker (built for ~30 students): a
 *  filter input over the without-a-group pool, scrollable, each row the
 *  student's SWITCH identity over their login. Stays open for multi-add. */
function AddFromPool({
  candidates,
  identityFor,
  disabled,
  onAdd,
}: {
  candidates: AddCandidate[];
  identityFor: (s: AddCandidate) => PersonIdentity;
  disabled: boolean;
  onAdd: (login: string) => Promise<unknown>;
}) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const needle = query.toLowerCase();
  const filtered = candidates.filter((s) =>
    `${identityFor(s).name} ${s.login}`.toLowerCase().includes(needle),
  );

  async function add(login: string) {
    setPending(login);
    try {
      await onAdd(login);
    } finally {
      setPending(null);
    }
  }
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            type="button"
            className="self-start"
            disabled={disabled || candidates.length === 0}
            title="Add a student without a group to this group"
          />
        }
      >
        <UserPlus className="size-3.5 text-muted-foreground" />
        Add from the pool ({candidates.length})
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-border border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter students…"
            aria-label="Filter students"
            className="h-8"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <Text variant="caption" className="px-2 py-3 text-center">
              No student matches.
            </Text>
          ) : (
            filtered.map((s) => (
              <button
                key={s.githubId}
                type="button"
                onClick={() => add(s.login)}
                disabled={pending !== null}
                className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
              >
                <UserIdentity
                  {...identityFor(s)}
                  action={
                    pending === s.login ? (
                      <span className="font-mono text-muted-foreground text-xs">
                        adding…
                      </span>
                    ) : null
                  }
                />
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
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
