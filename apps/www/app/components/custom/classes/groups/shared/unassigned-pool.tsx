import { useId, useState } from "react";
import { DisclosureToggle } from "~/components/custom/disclosure-toggle";
import { EmailsMenu } from "~/components/custom/identity/emails-menu";
import { UserIdentity } from "~/components/custom/identity/user-identity";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import type { ClassItem, LabStudent } from "~/lib/api";
import { usersByGithubId } from "~/lib/format";
import { personIdentity } from "~/lib/identity";

/**
 * The "students without a group for this lab" pool — shared by BOTH lab
 * pages: the teacher's radar, and the students' organizing aid (who still
 * needs a team). It IS a warning, so it wears the warning tint. Sourced
 * from the class_members display cache riding on the lab-groups response;
 * hidden entirely once everyone is placed.
 *
 * It has to read the same at 1 student and at 30, so it is ALWAYS the summary
 * line — the label and the count, nothing else — with the names one chevron
 * away. The strip is therefore a fixed height whatever the class size, and the
 * roster below it never moves. Revealed names are a grid, not a wrap: columns
 * you can scan down.
 */
export function UnassignedPool({
  students,
  users,
}: {
  /** Already filtered to students in NO participating group. */
  students: LabStudent[];
  users?: ClassItem["users"] | undefined;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  if (students.length === 0) return null;
  const userByGithubId = usersByGithubId(users);

  // A pool of 30 in arrival order is a linear search; by name it's an index.
  const sorted = students
    .map((student) => ({
      githubId: student.githubId,
      ...personIdentity(student, userByGithubId.get(student.githubId)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const reveal =
    sorted.length === 1
      ? "Show the student"
      : `Show all ${sorted.length} students`;

  return (
    <Stack
      gap="sm"
      className="w-full rounded-md bg-warning/8 px-4 py-2.5 ring-1 ring-warning/40"
    >
      <Row gap="sm" justify="between" className="w-full">
        <Text variant="overline" as="span" className="text-warning">
          Students without a group for this lab · {sorted.length}
        </Text>
        <DisclosureToggle
          expanded={open}
          onToggle={() => setOpen(!open)}
          label={open ? "Hide the student list" : reveal}
          // Only while the region exists — a dangling idref is invalid ARIA.
          controls={open ? listId : undefined}
        />
      </Row>
      {open ? (
        <div
          id={listId}
          // Auto-fill columns rather than a free wrap: every row is the same
          // width, so the identities line up into scannable columns.
          className="grid w-full grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2"
        >
          {sorted.map(({ githubId, emails, ...identity }) => (
            // The very row the group roster uses — a student reads the same
            // whether they're in a group or waiting for one. The emails
            // menu sits NEXT to the identity, like everywhere else.
            <Row
              key={githubId}
              gap="sm"
              align="center"
              className="min-w-0 rounded-md bg-card px-3 py-2 ring-1 ring-foreground/10"
            >
              <UserIdentity {...identity} className="min-w-0 flex-1" />
              <EmailsMenu name={identity.name} emails={emails} />
            </Row>
          ))}
        </div>
      ) : null}
    </Stack>
  );
}
