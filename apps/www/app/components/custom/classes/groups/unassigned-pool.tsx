import { MemberBlock } from "~/components/custom/classes/groups/group-tile";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Card } from "~/components/ui/card";
import type { ClassItem, LabStudent } from "~/lib/api";
import { switchDisplayName } from "~/lib/format";

/**
 * The "students without a group for this lab" pool — shared by BOTH lab
 * pages: the teacher's radar, and the students' organizing aid (who still
 * needs a team). Sourced from the class_members display cache riding on the
 * lab-groups response; hidden entirely once everyone is placed.
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
  const userByGithubId = new Map(users?.map((u) => [u.githubId, u.user]));

  return (
    <Stack gap="md" className="w-full">
      <Text variant="overline">
        Students without a group for this lab · {students.length}
      </Text>
      <Card className="w-full gap-0 p-4">
        <Row gap="md" wrap>
          {students.map((student) => {
            const linked = userByGithubId.get(student.githubId);
            const login = student.login ?? "unknown";
            return (
              <MemberBlock
                key={student.githubId}
                member={{
                  id: Number(student.githubId),
                  login,
                  avatarUrl: student.avatarUrl,
                }}
                name={linked ? switchDisplayName(linked) : login}
              />
            );
          })}
        </Row>
      </Card>
    </Stack>
  );
}
