import { Trash2 } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useLabGroups } from "~/components/custom/classes/groups/shared/use-lab-groups";
import { TeacherLabGroups } from "~/components/custom/classes/groups/teacher/teacher-lab-groups";
import { LabHeader } from "~/components/custom/classes/labs/lab-header";
import { DeleteDialog, STAKES } from "~/components/custom/delete-dialog";
import { Page } from "~/components/custom/layout/page";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import {
  api,
  errorStatus,
  type GroupItem,
  type LabItem,
  useAction,
} from "~/lib/api";
import { count } from "~/lib/format";

/**
 * /classes/:classId/labs/:labId/manage: the teacher's lab page, with the
 * without-a-group pool and full group management. Its own page rather than a
 * role branch, because F8+ grows it into repos, progress and grading. A
 * caller who is only enrolled here is redirected to the student page.
 *
 * One request: the groups response carries the lab, class identity and the
 * caller's role, so the header costs no extra /api/classes fetch.
 */
export function TeacherLabPage() {
  const { classId = "", labId = "" } = useParams();
  const g = useLabGroups(classId, labId);

  // 404 = the class/lab doesn't exist or the caller isn't in it, distinct
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
            action={
              <DeleteLabAction
                classId={classId}
                lab={g.lab}
                groups={g.groups}
                placedCount={g.placedCount}
              />
            }
          />
          <TeacherLabGroups classId={classId} lab={g.lab} />
        </Page>
      )}
    </Loading>
  );
}

/**
 * Deleting the lab, and the reason this page owns the verb rather than the
 * class hub's edit pencil: the groups it would take are on the screen behind
 * the dialog, so `stakes` can count them instead of guessing.
 */
function DeleteLabAction({
  classId,
  lab,
  groups,
  placedCount,
}: {
  classId: string;
  lab: LabItem;
  groups: GroupItem[];
  /** Distinct students in some group of this lab, derived once by the hook. */
  placedCount: number;
}) {
  const navigate = useNavigate();
  // Leaving IS the refresh: on success the lab this page renders no longer
  // exists, so `useAction`'s revalidate step navigates instead of refetching.
  // Failures still surface on the global strip, as everywhere else.
  const { busy, act } = useAction(async () => {
    await navigate("/classes");
  });

  return (
    <DeleteDialog
      trigger={
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={busy}
          // Named apart from the dialog's own "Delete lab": one opens the
          // question, the other answers it, and a screen reader shouldn't
          // meet the same words twice.
          aria-label="Delete this lab"
          title="Delete this lab"
        >
          <Trash2 className="text-muted-foreground" />
          Delete lab
        </Button>
      }
      what="lab"
      name={lab.title}
      stakes={labStakes(groups, placedCount)}
      onDelete={() =>
        act(() =>
          api.api.classes[":id"].labs[":labId"].$delete({
            param: { id: classId, labId: lab.id },
          }),
        )
      }
    />
  );
}

/** What deleting a lab takes and leaves, counted from what the page already
 *  loaded. An empty lab says so rather than listing three zeroes. */
function labStakes(groups: GroupItem[], placedCount: number): string[] {
  if (groups.length === 0) return ["No groups have formed in it yet."];
  const repos = groups.filter((g) => g.repoFullName !== null).length;
  return [
    STAKES.teams(groups.length),
    ...(placedCount > 0
      ? [STAKES.students(placedCount, "this lab and their place in it")]
      : []),
    ...(repos > 0
      ? [
          STAKES.reposSurvive(
            count(repos, "work repository", "work repositories"),
            repos > 1,
          ),
          STAKES.reposReturn,
        ]
      : []),
  ];
}
