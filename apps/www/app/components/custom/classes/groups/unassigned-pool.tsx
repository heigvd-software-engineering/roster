import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Text } from "~/components/custom/typography/text";
import type { ClassItem, LabStudent } from "~/lib/api";
import { switchDisplayName, usersByGithubId } from "~/lib/format";

/**
 * The "students without a group for this lab" pool — shared by BOTH lab
 * pages: the teacher's radar, and the students' organizing aid (who still
 * needs a team). It IS a warning, so it wears the warning tint. Sourced
 * from the class_members display cache riding on the lab-groups response;
 * hidden entirely once everyone is placed.
 */
export function UnassignedPool({
  students,
  users,
}: {
  /** Already filtered to students in NO participating group. */
  students: LabStudent[];
  users?: ClassItem["users"];
}) {
  if (students.length === 0) return null;
  const userByGithubId = usersByGithubId(users);

  return (
    <Row
      gap="sm"
      wrap
      className="w-full rounded-md bg-warning/8 px-4 py-2.5 ring-1 ring-warning/40"
    >
      <Text variant="overline" as="span" className="text-warning">
        Students without a group for this lab · {students.length}
      </Text>
      {students.map((student) => {
        const linked = userByGithubId.get(student.githubId);
        const login = student.login ?? "unknown";
        return (
          <span
            key={student.githubId}
            className="inline-flex items-center gap-1.5 rounded-full bg-card py-0.5 pr-2.5 pl-0.5 text-xs ring-1 ring-foreground/10"
            title={`@${login}`}
          >
            <UserAvatar
              name={linked ? switchDisplayName(linked) : login}
              src={student.avatarUrl}
              size="sm"
            />
            {linked ? switchDisplayName(linked) : `@${login}`}
          </span>
        );
      })}
    </Row>
  );
}
