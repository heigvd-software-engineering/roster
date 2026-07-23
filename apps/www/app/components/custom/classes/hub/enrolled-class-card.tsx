import { PeopleChip } from "~/components/custom/classes/hub/people-chip";
import { LabsTimeline } from "~/components/custom/classes/labs/labs-timeline";
import { RoleChip, roleSpine } from "~/components/custom/classes/role-marker";
import { Hint } from "~/components/custom/hint";
import { OrgIdentity } from "~/components/custom/identity/org-identity";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Card } from "~/components/ui/card";
import type { EnrolledClassItem } from "~/lib/api";
import { cn } from "~/lib/utils";

/**
 * "You joined, but you are not in the organisation yet."
 *
 * Pending is not a decoration: it is the student one step short of everything
 * the class is for, and the remaining step is on GitHub, not here. Stating the
 * status alone leaves them to discover the consequences by hitting them — the
 * lab page shows no groups, joining one 404s — so this says what they cannot
 * do yet, and hands them the link that fixes it.
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
          organisation invitation yet — so you aren't a member of it.
        </span>
        <span>
          Until you do, you can open the class and its labs, but you can't join
          a group or get your lab repository.
        </span>
        {/* Absent only until a teacher path refreshes the org identity cache;
            better to drop the link than to build one around "unknown". */}
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
 * the teacher's ClassCard, read-only — org identity + a quiet enrollment
 * state instead of people stats and actions, and inert lab rows (the student
 * lab flow arrives with accept, F8). Org identity comes from the DB cache;
 * it can be momentarily null until any teacher path refreshes it.
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
    <Card
      className={cn(
        "w-full gap-0 py-0 transition-shadow hover:ring-foreground/20",
        roleSpine("enrolled"),
      )}
    >
      <Row justify="between" wrap className="px-5 py-4">
        {cls.login ? (
          <a
            href={`https://github.com/${cls.login}`}
            target="_blank"
            rel="noreferrer"
            className="-m-2 rounded-md p-2 transition-colors hover:bg-muted/60"
          >
            {identity}
          </a>
        ) : (
          identity
        )}
        <Row gap="sm">
          {/* The class's teachers, from the enrollment cache — the same
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
          <RoleChip kind="enrolled" />
        </Row>
      </Row>

      <div className="w-full overflow-x-auto border-border border-t">
        <div className="min-w-[720px]">
          {cls.labs.length === 0 ? (
            <Text variant="body2" className="px-5 py-3">
              No labs yet.
            </Text>
          ) : (
            <LabsTimeline labs={cls.labs} />
          )}
        </div>
      </div>
    </Card>
  );
}
