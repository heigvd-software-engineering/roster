import type { ReactNode } from "react";
import { Fragment } from "react";
import { SEAT_ROW_HEIGHT } from "~/components/custom/classes/groups/shared/seats";
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

/** The wall grid: as many columns as fit a readable card, capped at 3. The
 *  column min is at least a third of the row minus its two gaps, so a fourth
 *  never fits, and auto-fill still collapses to 2/1 below 220px each with no
 *  breakpoint ladder to maintain. The gap is named ONCE (--wall-gap) and
 *  consumed by both the cap's calc and the gap utility, so editing it can't
 *  silently readmit a fourth column. Rows stretch (no align-items): every
 *  card in a row is the same height, and the card pins its footer to the
 *  bottom to absorb it. */
export const GROUP_WALL =
  "grid w-full [--wall-gap:0.75rem] gap-(--wall-gap) grid-cols-[repeat(auto-fill,minmax(max(220px,calc((100%_-_2*var(--wall-gap))/3)),1fr))]";

/**
 * Which open seats a group's card shows, as required-to-form flags. A capped
 * assignment renders the group at its full capacity: filled members plus one
 * slot per remaining seat, the first `min - size` of them required. An uncapped
 * assignment has no capacity to draw, so it renders the required seats while
 * forming, then a single optional slot, since the add affordance must survive
 * completion. A group OVER the cap renders no open seats.
 */
function openSeatsFor(size: number, min: number, max: number): boolean[] {
  const required = Math.max(0, min - size);
  const total = Number.isFinite(max)
    ? Math.max(0, max - size)
    : Math.max(required, 1);
  return Array.from({ length: total }, (_, i) => i < required);
}

/** The count beside the name: destructive whenever the SIZE is the problem
 * (short of the min, past the max), muted otherwise. An uncapped assignment has
 * no denominator to show, since `max` is Infinity and renders literally. The
 * needs-N-more / over-max wording lives in the seats and hints; here it's the
 * numbers alone. */
function SizeCount({
  size,
  min,
  max,
}: {
  size: number;
  min: number;
  max: number;
}) {
  return (
    <Text
      variant="caption"
      as="span"
      className={cn(
        "flex-none tabular-nums",
        (size < min || size > max) && "text-destructive",
      )}
      title={`${size}${Number.isFinite(max) ? ` of ${max}` : ""} members`}
    >
      {size}
      {Number.isFinite(max) ? `/${max}` : ""}
    </Text>
  );
}

/**
 * One group of the wall, the shared role-agnostic SHELL: header (name + size
 * count, `notes` under it, `actions` at the right edge), the FULL roster
 * inline (the wall's whole point: no expanding to see who's where), open
 * seats after the members, and a bottom-pinned `footer` for the repo facts.
 * Everything role-specific arrives through the slots: the teacher composes
 * the status badge into `actions`, the add-picker into `renderOpenSeat`, and
 * its kebab into `footer` because the header's width belongs to the name;
 * the student composes join/leave. Seat natures build on seats.tsx's bases,
 * next to their role file.
 */
export function GroupCard({
  group,
  users,
  min,
  max,
  notes,
  actions,
  footer,
  memberAction,
  memberClassName,
  renderOpenSeat,
  highlight = false,
  className,
}: {
  group: GroupItem;
  users?: ClassItem["users"] | undefined;
  min: number;
  max: number;
  /** Status lines under the name (e.g. warning hints). */
  notes?: ReactNode;
  /** Top-right controls (role-specific), e.g. status chip + kebab. */
  actions?: ReactNode;
  /** Bottom-pinned: the work-repo link / its create action. */
  footer?: ReactNode;
  memberAction?:
    | ((member: GroupItem["members"][number]) => ReactNode)
    | undefined;
  /** Restyles each member row (e.g. the solo ghost tile dims you). */
  memberClassName?: string | undefined;
  /** Renders each open seat (required = still needed to reach the min). */
  renderOpenSeat?: (required: boolean) => ReactNode;
  /** Marks the viewer's OWN group with a stronger outline. */
  highlight?: boolean;
  className?: string;
}) {
  const seats = openSeatsFor(group.members.length, min, max);
  return (
    <Card
      className={cn(
        "h-full gap-0 p-0",
        highlight && "ring-foreground/40",
        className,
      )}
    >
      <Stack gap="sm" className="h-full w-full px-4 pt-3 pb-3.5">
        <Row gap="xs" align="start" className="w-full">
          <Stack gap="none" className="min-w-0 flex-1">
            <Row gap="sm" align="baseline" className="min-w-0">
              {/* The tooltip carries the full name: truncation is the narrow
                  card's escape valve, not information loss. */}
              <Text
                variant="label"
                as="span"
                className="truncate font-medium"
                title={group.name}
              >
                {group.name}
              </Text>
              <SizeCount size={group.members.length} min={min} max={max} />
            </Row>
            {notes}
          </Stack>
          {actions}
        </Row>
        <Stack gap="sm" className="w-full">
          {/* No "empty" fallback here: an empty group IS its open seats.
              GroupMembers keeps the caption for the reuse dialog, where an
              expanded roster showing nothing would read as broken. */}
          {group.members.length > 0 ? (
            <GroupMembers
              members={group.members}
              users={users}
              memberAction={memberAction}
              memberClassName={cn(SEAT_ROW_HEIGHT, memberClassName)}
            />
          ) : null}
          {seats.map((required, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a seat has no identity but its position, and the list is positional, growing and shrinking only at the tail
            <Fragment key={i}>{renderOpenSeat?.(required)}</Fragment>
          ))}
        </Stack>
        {footer !== undefined ? (
          <div className="mt-auto w-full border-border border-t pt-2.5">
            {footer}
          </div>
        ) : null}
      </Stack>
    </Card>
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
  /** Restyles each row (e.g. the card's seat-height member rows). */
  memberClassName?: string | undefined;
}) {
  const userByGithubId = usersByGithubId(users);
  if (members.length === 0) {
    return <Text variant="caption">Empty</Text>;
  }
  return (
    <Stack gap="sm">
      {members.map((member) => {
        const { email, ...identity } = personIdentity(
          member,
          userByGithubId.get(String(member.id)),
        );
        return (
          // The identity is pure display; everything interactive (emails
          // menu, the teacher's remove ×) sits NEXT to it, clustered at the
          // row's right edge.
          <Row
            key={member.id}
            gap="sm"
            align="center"
            className={memberClassName}
          >
            <UserIdentity {...identity} className="min-w-0 flex-1" />
            <EmailsMenu name={identity.name} email={email} />
            {memberAction?.(member)}
          </Row>
        );
      })}
    </Stack>
  );
}
