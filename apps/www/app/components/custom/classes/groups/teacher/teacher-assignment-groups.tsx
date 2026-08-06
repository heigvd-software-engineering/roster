import { Download, MoreHorizontal, Search, X } from "lucide-react";
import { type ComponentProps, useState } from "react";
import {
  GROUP_WALL,
  GroupCard,
} from "~/components/custom/classes/groups/shared/group-card";
import { NewGroupDialog } from "~/components/custom/classes/groups/shared/new-group-dialog";
import { SeatButton } from "~/components/custom/classes/groups/shared/seats";
import { UnassignedPool } from "~/components/custom/classes/groups/shared/unassigned-pool";
import {
  type GroupAssignmentStatus,
  useAssignmentGroups,
} from "~/components/custom/classes/groups/shared/use-assignment-groups";
import {
  MissingRepoBadge,
  RepoLink,
} from "~/components/custom/classes/groups/shared/work-repo";
import { AssignmentStats } from "~/components/custom/classes/groups/teacher/assignment-stats";
import { CloneAllDialog } from "~/components/custom/classes/groups/teacher/clone-all-dialog";
import {
  LastPush,
  StatusChip,
} from "~/components/custom/classes/groups/teacher/group-status";
import { ConfirmDialog } from "~/components/custom/confirm-dialog";
import { DeleteDialog, STAKES } from "~/components/custom/delete-dialog";
import { Hint } from "~/components/custom/hint";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { AssignmentItem, GroupItem } from "~/lib/api";
import { assignmentStarted, usersByGithubId } from "~/lib/format";
import { type PersonIdentity, personIdentity } from "~/lib/identity";
import { cn } from "~/lib/utils";

type StatusFilter = "all" | "attention" | "late";
type AssignmentGroups = ReturnType<typeof useAssignmentGroups>;
type RosterRow = {
  group: GroupItem;
  repo: string | null;
  pushedAt: string | null;
  status: GroupAssignmentStatus;
};
/** Statuses that need nothing from anyone. Everything else is attention. */
const GOOD_STATUSES: GroupAssignmentStatus[] = ["on_track", "on_time", "ready"];
/** The pool members a teacher may add to a group (linked login required). */
type AddCandidate = AssignmentGroups["unplaced"][number] & { login: string };

/**
 * The TEACHER's assignment page is a GROUP WALL: summary stats, the
 * without-a-group pool, then one CARD per group of THIS assignment, with the
 * full roster inline (~30 students in ~12 groups fit one screen; nothing hides
 * behind a disclosure), open seats for the remaining capacity, repo + last push
 * pinned at the bottom, status badge in the corner. Management lives ON the
 * card: an open seat is the add-from-pool picker, each member wears its remove
 * ×, the kebab holds the one rare verb (delete). The toolbar's search + status
 * segments DIM non-matching cards rather than hide them, so the wall keeps its
 * shape and the eye's map of the class survives filtering.
 */
export function TeacherAssignmentGroups({
  classId,
  assignment,
}: {
  classId: string;
  assignment: AssignmentItem;
}) {
  const g = useAssignmentGroups(classId, assignment.id);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  // Add-member candidates = everyone unplaced (never double-books), by login.
  // Teachers included, so removing one from a group is reversible.
  const addCandidates = g.unplaced.filter(
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
        const { name } = personIdentity(m, userByGithubId.get(String(m.id)));
        return [name, m.login];
      }),
    ]
      .join(" ")
      .toLowerCase(),
  }));

  const attention = rows.filter((r) => !GOOD_STATUSES.includes(r.status));
  const late = rows.filter((r) => r.status === "late");
  const missingRepos = rows.filter((r) => r.status === "no_repo");
  // Every work repo of this assignment, filter-independent: "clone all" means
  // all.
  const repos = rows
    .map((r) => r.repo)
    .filter((repo): repo is string => repo !== null);
  const matchesFilter = (status: GroupAssignmentStatus) =>
    filter === "all" ||
    (filter === "late" ? status === "late" : !GOOD_STATUSES.includes(status));
  const needle = query.toLowerCase();

  const started = assignmentStarted(assignment);

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
      <AssignmentStats
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
          assignmentId={assignment.id}
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          total={rows.length}
          attentionCount={attention.length}
          lateCount={late.length}
          missingCount={missingRepos.length}
          repos={repos}
          started={started}
        />

        {rows.length === 0 ? (
          <Text variant="body2">
            No groups in this assignment yet — create one above.
          </Text>
        ) : (
          <div className={GROUP_WALL}>
            {rows.map((row) => (
              <TeacherGroupCard
                key={row.group.id}
                g={g}
                row={row}
                deadline={assignment.deadline}
                started={started}
                addCandidates={addCandidates}
                dimmed={
                  !(matchesFilter(row.status) && row.haystack.includes(needle))
                }
              />
            ))}
          </div>
        )}
      </Stack>
    </>
  );
}

/** The escape hatch, labeled as such: while the assignment hasn't started, both
 *  repo-create confirms carry this extra sentence, because a repository
 *  created now hands its group the starter code before the start time.
 *  Empty once started. */
function preStartRepoWarning(started: boolean, scope: "one" | "many") {
  if (started) return "";
  return scope === "one"
    ? " This assignment hasn't started: creating the repository now gives this group access to the starter code before the start time."
    : " This assignment hasn't started: creating repositories now gives their groups access to the starter code before the start time.";
}

/** Search + status segments (they DIM, never hide) plus the toolbar verbs:
 *  batch repo creation, create a group, and clone every work repo. */
function RosterToolbar({
  g,
  classId,
  assignmentId,
  query,
  onQuery,
  filter,
  onFilter,
  total,
  attentionCount,
  lateCount,
  missingCount,
  repos,
  started,
}: {
  g: AssignmentGroups;
  classId: string;
  assignmentId: string;
  query: string;
  onQuery: (query: string) => void;
  filter: StatusFilter;
  onFilter: (filter: StatusFilter) => void;
  total: number;
  attentionCount: number;
  lateCount: number;
  /** Complete groups still lacking their repo: the batch button's scope. */
  missingCount: number;
  /** Full names of every work repo in this assignment: the clone block's scope. */
  repos: string[];
  /** False before the assignment's startAt, so the batch confirm names the leak. */
  started: boolean;
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
        // Repo creation LOCKS each group (students can't join/leave after),
        // worth an explicit confirm on the batch, like the card's Delete.
        <ConfirmDialog
          title="Create the missing repositories?"
          description={
            "Every complete group that lacks a repository gets one. Creating a repository locks its group: students can no longer join or leave on their own." +
            preStartRepoWarning(started, "many")
          }
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
        assignmentId={assignmentId}
        autoJoins={false}
        triggerLabel="New group"
        trigger={
          <Button
            variant="outline"
            size="sm"
            type="button"
            title="Create a new group for this assignment"
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
            : "Copy a git clone command for every work repository in this assignment"
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

/**
 * One group on the wall: the shared GroupCard shell composed with the
 * teacher's verbs. The delete confirm is CONTROLLED: its trigger is a menu
 * item that unmounts when the menu closes.
 */
function TeacherGroupCard({
  g,
  row: { group, repo, pushedAt, status },
  deadline,
  started,
  addCandidates,
  dimmed,
}: {
  g: AssignmentGroups;
  row: RosterRow;
  deadline: string;
  /** False before the assignment's startAt, so the create confirm names the leak. */
  started: boolean;
  addCandidates: AddCandidate[];
  /** Filtered out, but the wall dims instead of hiding. */
  dimmed: boolean;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const userByGithubId = usersByGithubId(g.users);
  const size = group.members.length;
  const over = size > g.max;
  return (
    <>
      <GroupCard
        group={group}
        users={g.users}
        min={g.min}
        max={g.max}
        className={cn(dimmed && "opacity-40")}
        notes={
          <Row gap="xs" align="center">
            {repo !== null ? (
              // The teacher's roster verbs stay UNLOCKED on a repo-owning
              // group (only student self-service froze), so the warning stays
              // visible: the seats below still add and remove silently.
              <Hint
                variant="warning"
                text="repo exists"
                title="This group already has its work repository"
              >
                Membership changes here still work — only student self-service
                is locked. A student you add immediately sees everything the
                group has pushed; a student you remove loses access but keeps
                whatever they already cloned.
              </Hint>
            ) : null}
            {over ? (
              // Lowering the assignment's max never evicts anyone
              // (updateAssignment leaves attached groups untouched, by design),
              // so an oversized group is a state the teacher must be TOLD
              // about, or the only trace is a "4/3" count that reads like a
              // typo.
              <Hint
                variant="warning"
                text="over max"
                title={`This group has ${size} members and the assignment allows ${g.max}`}
              >
                The assignment's maximum was lowered after this group formed —
                nobody was removed, and the group keeps working. Remove{" "}
                {size - g.max} member
                {size - g.max > 1 ? "s" : ""} to fit the assignment, or raise
                the assignment's maximum in its settings if the size is fine.
              </Hint>
            ) : null}
          </Row>
        }
        actions={<StatusChip status={status} />}
        memberAction={(member) => (
          <Row gap="xs">
            {userByGithubId.has(String(member.id)) ? null : (
              // The identity lookup is by GitHub account id, and the link
              // forms on its own the moment the student signs in with SWITCH
              // and connects this account. Inform, don't alarm.
              <Hint
                label={`@${member.login} hasn't signed in yet`}
                title="No SWITCH identity yet"
              >
                This GitHub account isn't connected to a SWITCH edu-ID sign-in
                yet, so only the login can be shown. Once the student signs in
                to the app with SWITCH and connects this GitHub account, their
                real name appears here automatically.
              </Hint>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              disabled={g.busy}
              aria-label={`Remove ${member.login} from ${group.name}`}
              // The teacher's roster verbs stay UNLOCKED on a repo-owning
              // group (only student self-service froze), so the title carries
              // the consequence instead of a confirm on every click.
              title={
                repo !== null
                  ? `Remove @${member.login} from this group — they lose access to the repository but keep whatever they already cloned`
                  : `Remove @${member.login} from this group`
              }
              onClick={() => g.removeMember(group.id, member.login)}
            >
              <X className="size-3 text-muted-foreground" />
            </Button>
          </Row>
        )}
        renderOpenSeat={(required) => (
          <AddFromPool
            required={required}
            groupName={group.name}
            candidates={addCandidates}
            identityFor={(s) =>
              personIdentity(s, userByGithubId.get(s.githubId))
            }
            disabled={g.busy}
            onAdd={(login) => g.addMember(group.id, login)}
          />
        )}
        footer={
          // The kebab lives DOWN here, not in the header: the header's width
          // belongs to the group's name.
          <Row gap="sm" align="end" justify="between" className="w-full">
            <div className="min-w-0 flex-1">
              <CardFooter
                g={g}
                group={group}
                repo={repo}
                pushedAt={pushedAt}
                status={status}
                deadline={deadline}
                started={started}
              />
            </div>
            <CardMenu name={group.name} onDelete={() => setDeleteOpen(true)} />
          </Row>
        }
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        what="group"
        name={group.name}
        stakes={groupStakes(group.members.length, repo)}
        onDelete={() => g.deleteGroup(group.id)}
      />
    </>
  );
}

/** The teacher's seat NATURE: placing a student here, the add-picker's
 *  anchor. */
function AddMemberSeat({
  required = false,
  ...props
}: ComponentProps<typeof SeatButton>) {
  return (
    <SeatButton required={required} {...props}>
      {required ? "Add member — required to form" : "Add member"}
    </SeatButton>
  );
}

/** What deleting a group takes and leaves. The repo line matters most: it is
 *  the difference between "the work is gone" (it isn't) and "the students
 *  can't reach it" (they can't, until the group comes back). */
function groupStakes(members: number, repo: string | null): string[] {
  return [
    STAKES.team,
    ...(members > 0
      ? [STAKES.students(members, "their place in this assignment")]
      : []),
    ...(repo !== null
      ? [STAKES.reposSurvive(repo), STAKES.reposReturn]
      : ["Students can form a new group for this assignment afterwards."]),
  ];
}

/** The card's kebab, holding the one rare verb (groups are per-assignment, so delete
 * IS "remove from this assignment"). Never disabled: deletion is refused
 * nowhere in this app, and `DeleteDialog` is the whole gate. */
function CardMenu({ name, onDelete }: { name: string; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label={`Actions for ${name}`}
            title="Group actions"
          />
        }
      >
        <MoreHorizontal className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          Delete group
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The card's bottom-pinned repo facts: the link (plus the 404 badge when the
 *  repo was deleted directly on GitHub) over the last push, or the create
 *  action once the group is complete, or the forms-when-complete note. */
function CardFooter({
  g,
  group,
  repo,
  pushedAt,
  status,
  deadline,
  started,
}: {
  g: AssignmentGroups;
  group: GroupItem;
  repo: string | null;
  pushedAt: string | null;
  status: GroupAssignmentStatus;
  deadline: string;
  started: boolean;
}) {
  if (repo !== null) {
    return (
      <Stack gap="xs">
        <Row gap="xs" align="center" className="w-full">
          <RepoLink fullName={repo} />
          {group.repoStatus === "missing" ? (
            <MissingRepoBadge
              onUnlink={() => g.unlinkRepo(group.id)}
              busy={g.busy}
            />
          ) : null}
        </Row>
        <LastPush
          pushedAt={pushedAt}
          status={status}
          deadline={deadline}
          lastCommit={group.lastCommit}
        />
      </Stack>
    );
  }
  if (status === "no_repo") {
    return (
      // Same confirm gate as the batch toolbar button: creating the repo
      // LOCKS the group, one click shouldn't do that silently.
      <ConfirmDialog
        title="Create the work repository?"
        description={
          "This locks the group: once the repository exists, students can no longer join or leave on their own." +
          preStartRepoWarning(started, "one")
        }
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
    );
  }
  return <Text variant="caption">Repo forms when the group is complete</Text>;
}

/** An open seat that IS the "add from the pool" picker: the seat anchors a
 * popover whose CONTENT holds the search state. The popover unmounts when
 * closed, so the ~36 closed seats of a fresh assignment cost nothing per
 * render. An empty pool disables the seat, since nobody is left to place. */
function AddFromPool({
  required,
  groupName,
  candidates,
  identityFor,
  disabled,
  onAdd,
}: {
  required: boolean;
  groupName: string;
  candidates: AddCandidate[];
  identityFor: (s: AddCandidate) => PersonIdentity;
  disabled: boolean;
  onAdd: (login: string) => Promise<unknown>;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <AddMemberSeat
            required={required}
            disabled={disabled || candidates.length === 0}
            aria-label={`Add a member to ${groupName}`}
            title={
              candidates.length === 0
                ? "Everyone is placed — nobody is without a group"
                : "Add a student without a group to this group"
            }
          />
        }
      />
      <PopoverContent align="start" className="w-72 p-0">
        <PoolPicker
          candidates={candidates}
          identityFor={identityFor}
          onAdd={onAdd}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The picker's body (built for ~30 students): a filter input over the
 *  without-a-group pool, scrollable, each row the student's SWITCH identity
 *  over their login. Stays open for multi-add. Mounted only while its popover
 *  is open, so the filtering runs for one picker at a time. */
function PoolPicker({
  candidates,
  identityFor,
  onAdd,
}: {
  candidates: AddCandidate[];
  identityFor: (s: AddCandidate) => PersonIdentity;
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
    <>
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
          filtered.map((s) => {
            // Inside a <button>: display only, no emails menu here, because
            // nested interactive elements are invalid HTML.
            const { email: _email, ...identity } = identityFor(s);
            return (
              <button
                key={s.githubId}
                type="button"
                onClick={() => add(s.login)}
                disabled={pending !== null}
                className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
              >
                <Row gap="sm" align="center">
                  <UserIdentity {...identity} className="min-w-0 flex-1" />
                  {s.state === "teacher" ? (
                    <Badge variant="outline" className="font-normal">
                      teacher
                    </Badge>
                  ) : null}
                  {pending === s.login ? (
                    <Text variant="caption" as="span">
                      adding…
                    </Text>
                  ) : null}
                </Row>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

/** The segmented filter's count. */
function Count({ n }: { n: number }) {
  return (
    <span className="text-muted-foreground text-xs tabular-nums">{n}</span>
  );
}
