import { Link, Navigate, useParams } from "react-router";
import { TeacherLabGroups } from "~/components/custom/classes/groups/teacher/teacher-lab-groups";
import { LabHeader } from "~/components/custom/classes/labs/lab-header";
import { Page } from "~/components/custom/layout/page";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { api, useApi } from "~/lib/api";

/**
 * /classes/:classId/labs/:labId/manage — the TEACHER's lab page: the
 * without-a-group pool and full group management. Deliberately its own page
 * (not a role branch): F8+ grows it into repos, progress, and grading. A
 * caller who is only ENROLLED here is redirected to the student page.
 */
export function TeacherLabPage() {
  const { classId = "", labId = "" } = useParams();
  const { data, isLoading, error } = useApi(api.api.classes);

  const teaching = data?.classes.find((c) => c.id === classId);
  const lab = teaching?.labs.find((l) => l.id === labId);
  const enrolledInstead = !teaching
    ? data?.enrolled.some((c) => c.id === classId)
    : false;

  return (
    <Loading loading={isLoading} className="flex-1">
      {enrolledInstead ? (
        <Navigate to={`/classes/${classId}/labs/${labId}`} replace />
      ) : error || !teaching || !lab ? (
        <Page>
          <Text variant="error">
            {error
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
            className={teaching.name ?? teaching.login}
            lab={lab}
            kind="teaching"
          />
          <TeacherLabGroups classId={classId} lab={lab} />
        </Page>
      )}
    </Loading>
  );
}
