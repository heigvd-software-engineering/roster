import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { cn } from "~/lib/utils";

/** The second line is either a GitHub handle (an identifier — mono, "@"-ed)
 *  or prose (an email). Never both, and never a bare styling flag: the prop
 *  you pick IS the rule, so the two can't drift apart. */
type SecondLine =
  | { handle: string; subtitle?: never }
  | { subtitle: string; handle?: never }
  | { handle?: never; subtitle?: never };

type UserIdentityProps = {
  name: string;
  /** When `name` IS a GitHub login (a person with no edu-ID), render it as a
   *  handle — mono, "@"-prefixed — so it reads as a login, not a person's
   *  name. The avatar still gets the raw `name` for its initials. */
  nameIsLogin?: boolean;
  /** Omit for a SWITCH (edu-ID) identity — it has no picture, so: initials.
   *  `personIdentity` decides this for roster people. */
  avatarUrl?: string | null;
  /** "sm" for lists (rosters, pools, pickers); "lg" for the top bar and the
   *  join page's you→class pair. */
  size?: "sm" | "lg";
  className?: string;
} & SecondLine;

/**
 * One person, everywhere they appear: their avatar, their name, and a second
 * line identifying them further. The single person-identity component in the
 * app — the group roster, the unassigned pool, the add-from-pool picker, the
 * people table, the join page and the account menu all render this.
 *
 * PURE DISPLAY on purpose: rows render inside buttons (the add-from-pool
 * picker), so anything interactive — the EmailsMenu chevron, a remove ×,
 * an "adding…" note — is a SIBLING the call site places next to it, never
 * a prop baked in here.
 *
 * Organizations use OrgIdentity instead (square avatar — GitHub's convention).
 */
export function UserIdentity({
  name,
  nameIsLogin,
  handle,
  subtitle,
  avatarUrl,
  size = "sm",
  className,
}: UserIdentityProps) {
  const large = size === "lg";
  return (
    <Row gap="sm" align="center" className={className}>
      <UserAvatar name={name} src={avatarUrl} size={large ? "lg" : "sm"} />
      <Stack gap="none" className="min-w-0">
        <Text
          variant={large ? "label" : "caption"}
          as="span"
          className={cn(
            "truncate",
            !large && "font-medium text-foreground",
            nameIsLogin && "font-mono",
          )}
        >
          {nameIsLogin ? `@${name}` : name}
        </Text>
        {handle !== undefined ? (
          <Text variant="caption" as="span" className="truncate font-mono">
            @{handle}
          </Text>
        ) : null}
        {subtitle !== undefined ? (
          <Text variant="caption" as="span" className="truncate">
            {subtitle}
          </Text>
        ) : null}
      </Stack>
    </Row>
  );
}
