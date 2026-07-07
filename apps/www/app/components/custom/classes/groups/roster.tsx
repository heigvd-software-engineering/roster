import type { GroupLabStatus } from "~/components/custom/classes/groups/use-lab-groups";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { AvatarGroup } from "~/components/ui/avatar";
import type { GroupItem } from "~/lib/api";
import { cn } from "~/lib/utils";

/** The row's left spine — the same state as the chip, scannable as a color
 *  column without reading (the class cards' role-spine trick). */
export const STATUS_SPINE: Record<GroupLabStatus, string> = {
  ready: "border-l-role-enrolled",
  no_repo: "border-l-warning",
  under_min: "border-l-muted-foreground/40",
};

const CHIP: Record<GroupLabStatus, { label: string; className: string }> = {
  ready: {
    label: "repo created",
    className: "bg-role-enrolled/10 text-role-enrolled",
  },
  no_repo: { label: "no repo", className: "bg-warning/12 text-warning" },
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
