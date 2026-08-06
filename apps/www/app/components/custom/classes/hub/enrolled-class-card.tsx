import { AssignmentsTable } from "~/components/custom/classes/assignments/assignments-table";
import { PeopleChip } from "~/components/custom/classes/hub/people-chip";
import { Hint } from "~/components/custom/hint";
import { OrgIdentity } from "~/components/custom/identity/org-identity";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Card } from "~/components/ui/card";
import type { EnrolledClassItem } from "~/lib/api";

/**
 * "You joined, but you are not in the organisation yet."
 *
 * Pending is not a decoration: it is the student one step short of everything
 * the class is for, and the remaining step is on GitHub, not here. Stating the
 * status alone leaves them to discover the consequences by hitting them (the
 * assignment page shows no groups, joining one 404s), so this says what they
 * cannot do yet, and hands them the link that fixes it.
 *
 * Warning rather than info: nothing is broken, but they are blocked and only
 * they can unblock it.
 */
function PendingInvitationWarning({ orgLogin }: { orgLogin: string | null }) {
  return (
    <Hint variant="warning" text="invitation pending" title="Not a member yet">
      <Stack gap="sm">
        <span>
          You joined this class, but you haven't accepted the GitHub
          organization invitation yet, so you aren't a member of it.
        </span>
        <span>
          Until you do, you can open the class and its assignments, but you
          can't join a group or get your assignment repository.
        </span>
        {/* Absent only until a teacher path refreshes the org identity cache.
            Better to drop the link than to build one around "unknown". */}
        {orgLogin ? (
          <a
            href={`https://github.com/orgs/${orgLogin}/invitation`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Accept the invitation on GitHub
          </a>
        ) : null}
        <span className="text-muted-foreground">
          Only you can accept it, signed in as the GitHub account you joined
          with. Come back here afterwards and the class updates on its own.
        </span>
      </Stack>
    </Hint>
  );
}

/**
 * A class the caller is ENROLLED in (student side): the same flat surface as
 * the teacher's ClassCard, read-only. Org identity + a quiet enrollment state
 * instead of people stats and actions, and inert assignment rows (the student
 * assignment flow arrives with accept, F8). Org identity comes from the DB
 * cache, so it can be momentarily null until any teacher path refreshes it.
 */
export function EnrolledClassCard({ cls }: { cls: EnrolledClassItem }) {
  const name = cls.name ?? cls.login ?? "Class";
  const identity = (
    <OrgIdentity
      name={name}
      login={cls.login ?? "unknown"}
      avatarUrl={cls.avatarUrl}
      size="lg"
    />
  );
  return (
    <Card className="w-full gap-0 py-0">
      <Row justify="between" wrap className="px-5 py-4">
        {cls.login ? (
          <a
            href={`https://github.com/${cls.login}`}
            target="_blank"
            rel="noreferrer"
            className="-m-2 rounded-md p-2 hover:bg-muted"
          >
            {identity}
          </a>
        ) : (
          identity
        )}
        <Row gap="sm">
          {/* The class's teachers, from the enrollment cache, in the same
              popover the teaching card uses for its people. */}
          {cls.teachers.length > 0 ? (
            <PeopleChip
              label={`${cls.teachers.length} teacher${cls.teachers.length === 1 ? "" : "s"}`}
              title="Show the class's teachers"
              emptyText="No teachers found."
              people={cls.teachers.map((t) => ({
                id: Number(t.githubId),
                login: t.login ?? "unknown",
                avatarUrl: t.avatarUrl,
                user: t.user,
              }))}
            />
          ) : null}
          {cls.state === "pending" ? (
            <PendingInvitationWarning orgLogin={cls.login} />
          ) : null}
        </Row>
      </Row>

      <div className="w-full border-border border-t">
        {cls.assignments.length === 0 ? (
          <Text variant="body2" className="px-5 py-3">
            No assignments yet.
          </Text>
        ) : (
          <AssignmentsTable assignments={cls.assignments} />
        )}
      </div>
    </Card>
  );
}
