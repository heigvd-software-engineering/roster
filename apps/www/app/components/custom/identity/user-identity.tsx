import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
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
  /** Omit for a SWITCH (edu-ID) identity — it has no picture, so: initials.
   *  `personIdentity` decides this for roster people. */
  avatarUrl?: string | null;
  /** "sm" for lists (rosters, pools, pickers); "lg" for the top bar and the
   *  join page's you→class pair. */
  size?: "sm" | "lg";
  /** Rides the row's right edge when the row has width (remove ×, "adding…"). */
  action?: ReactNode;
  /** Affiliation emails, behind a chevron that opens a floating menu —
   *  `personIdentity` supplies these for roster people; empty/omitted
   *  renders no chevron. The row itself never shows an email. */
  emails?: string[];
  className?: string;
} & SecondLine;

/**
 * One person, everywhere they appear: their avatar, their name, and a second
 * line identifying them further. The single person-identity component in the
 * app — the group roster, the unassigned pool, the add-from-pool picker, the
 * people table, the join page and the account menu all render this.
 *
 * Organizations use OrgIdentity instead (square avatar — GitHub's convention).
 */
export function UserIdentity({
  name,
  handle,
  subtitle,
  avatarUrl,
  size = "sm",
  action,
  emails,
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
          className={cn("truncate", !large && "font-medium text-foreground")}
        >
          {name}
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
      {emails !== undefined && emails.length > 0 ? (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                aria-label={`Show ${name}'s emails`}
              />
            }
          >
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto min-w-52 p-2">
            <Stack gap="xs">
              {emails.map((email) => (
                <Text key={email} variant="caption" as="span">
                  {email}
                </Text>
              ))}
            </Stack>
          </PopoverContent>
        </Popover>
      ) : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </Row>
  );
}
