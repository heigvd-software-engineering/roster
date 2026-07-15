import { EmailsMenu } from "~/components/custom/identity/emails-menu";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import type { ClassItem } from "~/lib/api";
import { personIdentity } from "~/lib/identity";
import { cn } from "~/lib/utils";

// Derived from the inferred /api/classes response — no hand-modeled shapes.
type Member = ClassItem["students"][number];
type LinkedUser = ClassItem["users"][number]["user"];

type PeopleChipProps = {
  /** e.g. "3 students · 1 pending" */
  label: string;
  /** Org members, each correlated (by the caller) with their labs user. */
  people: Array<Member & { user: LinkedUser | null; pending?: boolean }>;
  emptyText: string;
  /** Tooltip explaining what the popover will show. */
  title?: string;
};

/**
 * A quiet mono stat in the class-card header (people as data, not buttons)
 * that opens the live people list. Each person is the SAME hybrid identity
 * row used everywhere else — `personIdentity` resolves the linked / GitHub-
 * only / edu-ID-only state, the emails chevron sits beside it, and a pending
 * invite dims the row and adds a badge.
 */
export function PeopleChip({
  label,
  people,
  emptyText,
  title = "Show the people list",
}: PeopleChipProps) {
  return (
    <Popover>
      <PopoverTrigger
        title={title}
        className="cursor-pointer font-mono text-muted-foreground text-xs tabular-nums transition-colors hover:text-foreground"
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        {people.length === 0 ? (
          <Text variant="body2" className="px-2 py-1">
            {emptyText}
          </Text>
        ) : (
          <Stack gap="xs">
            {people.map((p) => {
              const { emails, ...identity } = personIdentity(
                { login: p.login, avatarUrl: p.avatarUrl },
                p.user ?? undefined,
              );
              return (
                <Row
                  key={p.login}
                  gap="sm"
                  className={cn("px-1 py-0.5", p.pending && "opacity-60")}
                >
                  <UserIdentity {...identity} className="min-w-0 flex-1" />
                  <EmailsMenu name={identity.name} emails={emails} />
                  {p.pending ? (
                    <Badge variant="outline" className="font-normal">
                      pending
                    </Badge>
                  ) : null}
                </Row>
              );
            })}
          </Stack>
        )}
      </PopoverContent>
    </Popover>
  );
}
