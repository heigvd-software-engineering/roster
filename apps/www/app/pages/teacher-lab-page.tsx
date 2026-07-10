import { Link, Navigate, useParams } from "react-router";
import { useLabGroups } from "~/components/custom/classes/groups/shared/use-lab-groups";
import { TeacherLabGroups } from "~/components/custom/classes/groups/teacher/teacher-lab-groups";
import { LabHeader } from "~/components/custom/classes/labs/lab-header";
import { Page } from "~/components/custom/layout/page";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { errorStatus } from "~/lib/api";

/**
 * /classes/:classId/labs/:labId/manage — the TEACHER's lab page: the
 * without-a-group pool and full group management. Deliberately its own page
 * (not a role branch): F8+ grows it into repos, progress, and grading. A
 * caller who is only ENROLLED here is redirected to the student page.
 *
 * ONE request: the groups response carries the lab, class identity, and the
 * caller's role — no /api/classes fetch just to render the header.
 */
export function TeacherLabPage() {
  const { classId = "", labId = "" } = useParams();
  const g = useLabGroups(classId, labId);

  // 404 = the class/lab doesn't exist or the caller isn't in it — distinct
  // from a transient failure, which gets the refresh message.
  const notFound = errorStatus(g.error) === 404;

  return (
    <Loading loading={g.isLoading} className="flex-1">
      {g.role === "student" ? (
        <Navigate to={`/classes/${classId}/labs/${labId}`} replace />
      ) : g.error || !g.lab ? (
        <Page>
          <Text variant="error">
            {!notFound && g.error
              ? "Couldn't load this lab — refresh to retry."
              : "This lab doesn't exist (or you don't teach its class)."}
          </Text>
          <Link to="/classes" className="text-sm underline">
            ‹ Back to classes
          </Link>
        </Page>
      ) : (
        <Page>
          <LabHeader
            className={g.className ?? ""}
            lab={g.lab}
            kind="teaching"
          />
          <TeacherLabGroups classId={classId} lab={g.lab} />
        </Page>
      )}
    </Loading>
  );
}
