import { GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { EmailsMenu } from "~/components/custom/identity/emails-menu";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Card } from "~/components/ui/card";
import type { ClassItem, GroupItem } from "~/lib/api";
import { usersByGithubId } from "~/lib/format";
import { personIdentity } from "~/lib/identity";
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
  footer,
  memberAction,
  memberClassName,
}: {
  group: GroupItem;
  users?: ClassItem["users"] | undefined;
  highlight?: boolean;
  /** Status lines under the name (e.g. "your group", "needs N more"). */
  notes?: ReactNode;
  /** Top-right controls (role-specific). */
  actions?: ReactNode;
  /** Below the roster: the work-repo link or its create action (F8). */
  footer?: ReactNode;
  memberAction?:
    | ((member: GroupItem["members"][number]) => ReactNode)
    | undefined;
  /** Restyles each member row (e.g. the individual ghost tile dims you). */
  memberClassName?: string | undefined;
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
          memberClassName={memberClassName}
        />
        {footer}
      </Stack>
    </Card>
  );
}

/** The group's work repo, linked (opens on GitHub). */
export function RepoLink({ fullName }: { fullName: string }) {
  return (
    <a
      href={`https://github.com/${fullName}`}
      target="_blank"
      rel="noreferrer"
      title="Open the work repository on GitHub"
      className="inline-flex items-center gap-1.5 self-start font-mono text-foreground text-xs hover:underline"
    >
      <GitBranch className="size-3.5 text-muted-foreground" />
      {fullName}
    </a>
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
 * A group's live roster as identity rows. `users` are the raw linked-user rows
 * riding on the groups response, correlated here by github id; `personIdentity`
 * turns that into who we name the member by (and therefore whether they wear a
 * photo or their initials). `memberAction` appends a per-member control (e.g.
 * the teacher's remove ×).
 */
export function GroupMembers({
  members,
  users,
  memberAction,
  memberClassName,
}: {
  members: GroupItem["members"];
  users?: ClassItem["users"] | undefined;
  memberAction?:
    | ((member: GroupItem["members"][number]) => ReactNode)
    | undefined;
  /** Restyles each row (e.g. the drawer's card-like member rows). */
  memberClassName?: string | undefined;
}) {
  const userByGithubId = usersByGithubId(users);
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
        const { emails, ...identity } = personIdentity(
          member,
          userByGithubId.get(String(member.id)),
        );
        return (
          // The identity is pure display; everything interactive (emails
          // menu, the teacher's remove ×) sits NEXT to it, clustered at
          // the row's right edge.
          <Row
            key={member.id}
            gap="sm"
            align="center"
            className={memberClassName}
          >
            <UserIdentity {...identity} className="min-w-0 flex-1" />
            <EmailsMenu name={identity.name} emails={emails} />
            {memberAction?.(member)}
          </Row>
        );
      })}
    </Stack>
  );
}
