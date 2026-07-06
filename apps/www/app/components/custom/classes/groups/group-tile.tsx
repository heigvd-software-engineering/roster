import type { ReactNode } from "react";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Card } from "~/components/ui/card";
import type { ClassItem, GroupItem } from "~/lib/api";
import { switchDisplayName } from "~/lib/format";
import { cn } from "~/lib/utils";

/** The groups grid: 3 columns on desktop, collapsing below. */
export const GROUPS_GRID =
  "grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

/**
 * One group as a grid tile — the shared SHELL: name (+ status notes) and a
 * role-specific `actions` slot up top, the live roster below. The teacher
 * and student sections compose it with their own actions/notes; `highlight`
 * marks the student's own group in their role color.
 */
export function GroupTile({
  group,
  users,
  highlight = false,
  notes,
  actions,
  memberAction,
}: {
  group: GroupItem;
  users?: ClassItem["users"];
  highlight?: boolean;
  /** Status lines under the name (e.g. "your group", "needs N more"). */
  notes?: ReactNode;
  /** Top-right controls (role-specific). */
  actions?: ReactNode;
  memberAction?: (member: GroupItem["members"][number]) => ReactNode;
}) {
  return (
    <Card className={cn("gap-0 p-4", highlight && "ring-role-enrolled/60")}>
      <Stack gap="md" className="w-full">
        <Row justify="between" wrap className="w-full">
          <Stack gap="none">
            <Text variant="label" className="font-medium">
              {group.name}
            </Text>
            {notes}
          </Stack>
          <Row gap="xs">{actions}</Row>
        </Row>
        <GroupMembers
          members={group.members}
          users={users}
          memberAction={memberAction}
        />
      </Stack>
    </Card>
  );
}

/** "needs N more member(s)" — brand red: it's actionable before accept. */
export function MissingMembersNote({
  group,
  min,
}: {
  group: GroupItem;
  min: number;
}) {
  const missing = min - group.members.length;
  if (missing <= 0) return null;
  return (
    <span className="font-mono text-brand text-xs">
      needs {missing} more member{missing === 1 ? "" : "s"}
    </span>
  );
}

/**
 * A group's live roster as small identity blocks: the member's SWITCH
 * identity (real first + last name — THE identity inside the app) over the
 * mono GitHub login. `users` are the raw linked-user rows riding on the
 * groups response, correlated here by github id (an unlinked member falls
 * back to the login). `memberAction` appends a per-member control (e.g.
 * the teacher's remove ×).
 */
export function GroupMembers({
  members,
  users,
  memberAction,
}: {
  members: GroupItem["members"];
  users?: ClassItem["users"];
  memberAction?: (member: GroupItem["members"][number]) => ReactNode;
}) {
  const userByGithubId = new Map(users?.map((u) => [u.githubId, u.user]));
  if (members.length === 0) {
    return (
      <Text variant="caption" className="font-mono">
        empty
      </Text>
    );
  }
  return (
    <Stack gap="sm">
      {members.map((member) => {
        const linked = userByGithubId.get(String(member.id));
        return (
          <MemberBlock
            key={member.id}
            member={member}
            name={linked ? switchDisplayName(linked) : member.login}
            action={memberAction?.(member)}
          />
        );
      })}
    </Stack>
  );
}

/** A roster member as a small identity block: SWITCH name (THE identity
 *  inside the app) over the mono GitHub login. */
export function MemberBlock({
  member,
  name,
  action,
}: {
  member: { id: number; login: string; avatarUrl: string | null };
  name: string;
  action?: ReactNode;
}) {
  return (
    <Row gap="xs">
      <UserAvatar name={name} src={member.avatarUrl} size="sm" />
      <Stack gap="none">
        <Text variant="caption" className="font-medium text-foreground">
          {name}
        </Text>
        <Text variant="caption" className="font-mono">
          @{member.login}
        </Text>
      </Stack>
      {action}
    </Row>
  );
}
