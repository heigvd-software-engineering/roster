import type { ReactNode } from "react";
import { Hint } from "~/components/custom/hint";
import { EmailsMenu } from "~/components/custom/identity/emails-menu";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import type { ClassItem } from "~/lib/api";
import { personIdentity } from "~/lib/identity";

// Derived from the inferred /api/classes response — no hand-modeled shapes.
type Member = ClassItem["students"][number];
type LinkedUser = ClassItem["users"][number]["user"];

type PeopleChipProps = {
  /** e.g. "3 students · 1 pending" */
  label: string;
  /** Org members, each correlated (by the caller) with their roster user. */
  people: Array<Member & { user: LinkedUser | null; pending?: boolean }>;
  emptyText: string;
  /** Tooltip explaining what the popover will show. */
  title?: string;
  /**
   * What "pending" MEANS for this list — the caller decides, because the two
   * pending groups do not describe the same situation. A pending student came
   * through the join link, so they are already signed in with GitHub linked
   * and only owe GitHub an acceptance. A pending teacher may never have opened
   * roster at all, and owes two separate steps.
   */
  pendingHint?: ReactNode;
};

/**
 * A quiet mono stat in the class-card header (people as data, not buttons)
 * that opens the live people list. Each person is the SAME hybrid identity
 * row used everywhere else — `personIdentity` resolves the linked / GitHub-
 * only / edu-ID-only state, and the emails chevron sits beside it.
 *
 * A pending invite gets an explaining `Hint` rather than a dimmed row: the
 * state is not the person being less important, it's the app waiting on
 * something only GitHub can resolve, which is worth saying in words.
 */
export function PeopleChip({
  label,
  people,
  emptyText,
  title = "Show the people list",
  pendingHint = (
    <>
      They've been sent an invitation to this class's GitHub organisation and
      stay listed here until they accept it. Only they can do that, on GitHub —
      nothing here can confirm it for them. Once they accept, they become a full
      member automatically.
    </>
  ),
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
                <Row key={p.login} gap="sm" className="px-1 py-0.5">
                  <UserIdentity {...identity} className="min-w-0 flex-1" />
                  <EmailsMenu name={identity.name} emails={emails} />
                  {p.pending ? (
                    <Hint text="pending" title="Waiting on GitHub">
                      {pendingHint}
                    </Hint>
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
