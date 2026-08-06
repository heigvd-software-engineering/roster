import {
  CREATION_PUSH_GRACE_MS,
  type GroupAssignmentStatus,
} from "~/components/custom/classes/groups/shared/use-assignment-groups";
import { Hint } from "~/components/custom/hint";
import { Badge } from "~/components/ui/badge";
import { formatDeadline } from "~/lib/format";

/** The group's assignment status as a shadcn Badge. "late" is the one state a
 *  teacher must act on, so it is the only one that takes the destructive
 *  variant; settled states are secondary, unsettled ones outline. */
const CHIP: Record<
  GroupAssignmentStatus,
  { label: string; variant: "secondary" | "destructive" | "outline" }
> = {
  on_track: { label: "on track", variant: "secondary" },
  on_time: { label: "on time", variant: "secondary" },
  ready: { label: "repo created", variant: "secondary" },
  late: { label: "late", variant: "destructive" },
  no_pushes: { label: "no pushes", variant: "outline" },
  no_repo: { label: "no repo", variant: "outline" },
  under_min: { label: "under min", variant: "outline" },
};

export function StatusChip({ status }: { status: GroupAssignmentStatus }) {
  const chip = CHIP[status];
  return <Badge variant={chip.variant}>{chip.label}</Badge>;
}

/** Coarse distance for the push-vs-deadline note: "42min" / "5h" / "3d". */
function coarse(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Who wrote the repo's last default-branch commit, and what it said.
 *  Labeled by the commit, not the push: a teammate can push someone else's
 *  commit, and main can trail a feature branch. */
export type LastCommitInfo = {
  login: string | null;
  name: string | null;
  message: string;
};

function CommitByline({ commit }: { commit: LastCommitInfo }) {
  const who = commit.login ? `@${commit.login}` : commit.name;
  if (!who) return null;
  return (
    <span
      className="block max-w-48 truncate text-[11px] text-muted-foreground"
      title={`Last commit on the default branch, by ${who}: ${commit.message}`}
    >
      {who} · {commit.message}
    </span>
  );
}

/** The card footer's activity line: the last push as a moment, its relation
 *  to the deadline (the context that makes "late" concrete), and the last
 *  commit's author + headline when GitHub gave us one. */
export function LastPush({
  pushedAt,
  status,
  deadline,
  lastCommit,
}: {
  pushedAt: string | null;
  status: GroupAssignmentStatus;
  deadline: string;
  lastCommit?: LastCommitInfo | null;
}) {
  if (status === "no_pushes") {
    // The verdict is a heuristic, since a push inside the creation grace
    // window reads as the starter commit, so it must carry its own caveat
    // visibly: a Hint, not a hover tooltip nobody finds.
    const graceMin = Math.round(CREATION_PUSH_GRACE_MS / 60_000);
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground text-xs">
        no pushes yet
        <Hint label="How pushes are counted" title="How pushes are counted">
          The starter commit bumps the repo's push clock too, so only pushes
          made more than {graceMin} minutes after the repo's creation count. A
          real push inside that window stays invisible until the group pushes
          again.
        </Hint>
      </span>
    );
  }
  if (!pushedAt || status === "no_repo" || status === "under_min") {
    return <span className="text-muted-foreground text-xs">–</span>;
  }
  const pushed = new Date(pushedAt);
  const diff = Date.parse(deadline) - pushed.getTime();
  return (
    <span className="whitespace-nowrap text-xs tabular-nums">
      {formatDeadline(pushed)}
      <span className="block text-[11px] text-muted-foreground">
        {diff >= 0
          ? `${coarse(diff)} before deadline`
          : `${coarse(-diff)} after deadline`}
      </span>
      {lastCommit ? <CommitByline commit={lastCommit} /> : null}
    </span>
  );
}
