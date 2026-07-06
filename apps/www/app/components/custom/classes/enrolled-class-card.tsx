import { LabRow, LabsHeader } from "~/components/custom/classes/lab-row";
import { PeopleChip } from "~/components/custom/classes/people-chip";
import { RoleChip, roleSpine } from "~/components/custom/classes/role-marker";
import { OrgIdentity } from "~/components/custom/identity/org-identity";
import { Row } from "~/components/custom/layout/row";
import { Text } from "~/components/custom/typography/text";
import { Card } from "~/components/ui/card";
import type { EnrolledClassItem } from "~/lib/api";
import { cn } from "~/lib/utils";

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
          {/* State (urgency red) stays separate from role (identity teal). */}
          {cls.state === "pending" ? (
            <span className="font-mono text-brand text-xs">
              invitation pending
            </span>
          ) : null}
          <RoleChip kind="enrolled" />
        </Row>
      </Row>

      <div className="w-full overflow-x-auto border-border border-t">
        {/* No add-row below the table here, so the last row's hairline would
            double up with the card edge — drop it. */}
        <div className="min-w-[660px] [&>a:last-child]:border-b-0">
          {cls.labs.length === 0 ? (
            <Text variant="body2" className="px-5 py-3">
              No labs yet.
            </Text>
          ) : (
            <>
              <LabsHeader />
              {cls.labs.map((lab) => (
                <LabRow key={lab.id} lab={lab} />
              ))}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
