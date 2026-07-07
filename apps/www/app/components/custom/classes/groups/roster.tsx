import type { GroupLabStatus } from "~/components/custom/classes/groups/use-lab-groups";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { AvatarGroup } from "~/components/ui/avatar";
import type { GroupItem } from "~/lib/api";
import { formatDeadline } from "~/lib/format";
import { cn } from "~/lib/utils";

/** The row's left spine — the same state as the chip, scannable as a color
 *  column without reading (the class cards' role-spine trick). */
export const STATUS_SPINE: Record<GroupLabStatus, string> = {
  on_track: "border-l-role-enrolled",
  on_time: "border-l-role-enrolled",
  ready: "border-l-role-enrolled",
  late: "border-l-brand",
  no_pushes: "border-l-warning",
  no_repo: "border-l-warning",
  under_min: "border-l-muted-foreground/40",
};

const GOOD = "bg-role-enrolled/10 text-role-enrolled";
const WARN = "bg-warning/12 text-warning";
const CHIP: Record<GroupLabStatus, { label: string; className: string }> = {
  on_track: { label: "on track", className: GOOD },
  on_time: { label: "on time", className: GOOD },
  ready: { label: "repo created", className: GOOD },
  late: { label: "late", className: "bg-brand/10 text-brand" },
  no_pushes: { label: "no pushes", className: WARN },
  no_repo: { label: "no repo", className: WARN },
  under_min: {
    label: "under min",
    className: "bg-foreground/6 text-muted-foreground",
  },
};

/** Dot + mono label pill encoding the group's lab status. */
export function StatusChip({ status }: { status: GroupLabStatus }) {
  const chip = CHIP[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        chip.className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {chip.label}
    </span>
  );
}

/** Coarse distance for the push-vs-deadline note: "42min" / "5h" / "3d". */
function coarse(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** The roster's activity cell: the last push (as a moment) with its
 *  relation to the deadline — the context that makes "late" concrete. */
export function LastPush({
  pushedAt,
  status,
  deadline,
}: {
  pushedAt: string | null;
  status: GroupLabStatus;
  deadline: string;
}) {
  if (status === "no_pushes") {
    return (
      <span className="font-mono text-muted-foreground text-xs">
        no pushes yet
      </span>
    );
  }
  if (!pushedAt || status === "no_repo" || status === "under_min") {
    return <span className="font-mono text-muted-foreground text-xs">—</span>;
  }
  const pushed = new Date(pushedAt);
  const diff = Date.parse(deadline) - pushed.getTime();
  return (
    <span className="whitespace-nowrap font-mono text-xs tabular-nums">
      {formatDeadline(pushed)}
      <span className="block text-[11px] text-muted-foreground">
        {diff >= 0
          ? `${coarse(diff)} before deadline`
          : `${coarse(-diff)} after deadline`}
      </span>
    </span>
  );
}

/** The roster cell's compact face: overlapping member avatars. The full
 *  identities live one click away in the row's drawer. */
export function AvatarCluster({ members }: { members: GroupItem["members"] }) {
  return (
    <AvatarGroup>
      {members.map((member) => (
        <UserAvatar
          key={member.id}
          name={member.login}
          src={member.avatarUrl}
          size="sm"
        />
      ))}
    </AvatarGroup>
  );
}
