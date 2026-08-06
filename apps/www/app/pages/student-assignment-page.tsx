import { Link, Navigate, useParams } from "react-router";
import { AssignmentHeader } from "~/components/custom/classes/assignments/assignment-header";
import { useAssignmentGroups } from "~/components/custom/classes/groups/shared/use-assignment-groups";
import { StudentAssignmentGroups } from "~/components/custom/classes/groups/student/student-assignment-groups";
import { Page } from "~/components/custom/layout/page";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { errorStatus } from "~/lib/api";
import { assignmentStarted, formatDeadline } from "~/lib/format";

/**
 * /classes/:classId/assignments/:assignmentId: the student's assignment page,
 * where they accept the assignment. Both modes render through
 * StudentAssignmentGroups (one structure: the individual assignment is a solo
 * group, visually too). Its own page rather than a role branch, because F8+
 * grows it into the student's repo and standing. A caller who teaches this
 * class is redirected to the manage page.
 *
 * One request: the groups response carries the assignment, class identity, role
 * and live membership state, so a pending invitee gets the header and the
 * accept-invitation prompt, never a 404.
 */
export function StudentAssignmentPage() {
  const { classId = "", assignmentId = "" } = useParams();
  const g = useAssignmentGroups(classId, assignmentId);

  const notFound = errorStatus(g.error) === 404;
  const pending = g.membershipState === "pending";

  return (
    <Loading loading={g.isLoading} className="flex-1">
      {g.role === "teacher" ? (
        <Navigate
          to={`/classes/${classId}/assignments/${assignmentId}/manage`}
          replace
        />
      ) : g.error || !g.assignment ? (
        <Page>
          <Text variant="error">
            {!notFound && g.error
              ? "Couldn't load this assignment. Refresh to retry."
              : "This assignment doesn't exist (or you're not in its class)."}
          </Text>
          <Link to="/classes" className="text-sm underline">
            ‹ Back to classes
          </Link>
        </Page>
      ) : (
        <Page>
          <AssignmentHeader
            className={g.className ?? "Class"}
            assignment={g.assignment}
            kind="enrolled"
          />
          {pending ? (
            <Text variant="body2">
              Accept your invitation on GitHub first. Then you can accept this
              assignment.
            </Text>
          ) : g.assignment.startAt && !assignmentStarted(g.assignment) ? (
            // The server already answers head-only pre-start; this is the
            // matching face: what's next and when, nothing to act on yet.
            <Text variant="body2">
              This assignment starts{" "}
              {formatDeadline(new Date(g.assignment.startAt))}. You can form
              groups and get the starter code then.
            </Text>
          ) : (
            <StudentAssignmentGroups
              classId={classId}
              assignment={g.assignment}
            />
          )}
        </Page>
      )}
    </Loading>
  );
}
