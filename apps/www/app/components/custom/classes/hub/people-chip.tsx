import { EmailsMenu } from "~/components/custom/identity/emails-menu";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Row } from "~/components/custom/layout/row";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { ClassItem } from "~/lib/api";
import { switchDisplayName } from "~/lib/format";

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
 * that opens the live people list as a two-column table: the SWITCH identity
 * (THE identity inside the app — GitHub is secondary) and the GitHub login,
 * linked to the profile. Org members whose GitHub account isn't linked to a
 * labs user yet read "not linked".
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
      <PopoverContent align="start" className="w-96 p-2">
        {people.length === 0 ? (
          <Text variant="body2" className="px-2 py-1">
            {emptyText}
          </Text>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Switch identity</TableHead>
                <TableHead>GitHub identity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => (
                <TableRow
                  key={p.login}
                  className={p.pending ? "opacity-60" : undefined}
                >
                  <TableCell>
                    {p.user ? (
                      // SWITCH identity: initials, never a photo. The GitHub
                      // login is part of the identity; the private email is
                      // gone — affiliation (professional) emails live in the
                      // chevron's menu NEXT to the identity.
                      <Row gap="sm">
                        <UserIdentity
                          name={switchDisplayName(p.user)}
                          handle={p.login}
                          className="min-w-0 flex-1"
                        />
                        <EmailsMenu
                          name={switchDisplayName(p.user)}
                          emails={p.user.affiliations}
                        />
                      </Row>
                    ) : (
                      <Text variant="body2">not linked</Text>
                    )}
                  </TableCell>
                  <TableCell>
                    <Row gap="sm">
                      <a
                        href={`https://github.com/${p.login}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        <Text variant="body2" as="span">
                          @{p.login}
                        </Text>
                      </a>
                      {p.pending ? (
                        <Badge variant="outline" className="font-normal">
                          pending
                        </Badge>
                      ) : null}
                    </Row>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PopoverContent>
    </Popover>
  );
}
