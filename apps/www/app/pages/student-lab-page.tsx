import { Link, Navigate, useParams } from "react-router";
import { useLabGroups } from "~/components/custom/classes/groups/shared/use-lab-groups";
import { StudentLabGroups } from "~/components/custom/classes/groups/student/student-lab-groups";
import { LabHeader } from "~/components/custom/classes/labs/lab-header";
import { Page } from "~/components/custom/layout/page";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { errorStatus } from "~/lib/api";

/**
 * /classes/:classId/labs/:labId — the STUDENT's lab page: accept the lab.
 * BOTH modes render through StudentLabGroups (one structure — the individual
 * lab is a solo group, visually too). Deliberately its own page (not a role
 * branch): F8+ grows it into the student's repo and standing. A caller who
 * TEACHES this class is redirected to the manage page.
 *
 * ONE request: the groups response carries the lab, class identity, role,
 * and live membership state — a PENDING invitee gets the header and the
 * accept-invitation prompt, never a 404.
 */
export function StudentLabPage() {
  const { classId = "", labId = "" } = useParams();
  const g = useLabGroups(classId, labId);

  const notFound = errorStatus(g.error) === 404;
  const pending = g.membershipState === "pending";

  return (
    <Loading loading={g.isLoading} className="flex-1">
      {g.role === "teacher" ? (
        <Navigate to={`/classes/${classId}/labs/${labId}/manage`} replace />
      ) : g.error || !g.lab ? (
        <Page>
          <Text variant="error">
            {!notFound && g.error
              ? "Couldn't load this lab — refresh to retry."
              : "This lab doesn't exist (or you're not in its class)."}
          </Text>
          <Link to="/classes" className="text-sm underline">
            ‹ Back to classes
          </Link>
        </Page>
      ) : (
        <Page>
          <LabHeader
            className={g.className ?? "Class"}
            lab={g.lab}
            kind="enrolled"
          />
          {pending ? (
            <Text variant="body2">
              Accept your invitation on GitHub first — then you can accept this
              lab.
            </Text>
          ) : (
            <StudentLabGroups classId={classId} lab={g.lab} />
          )}
        </Page>
      )}
    </Loading>
  );
}
