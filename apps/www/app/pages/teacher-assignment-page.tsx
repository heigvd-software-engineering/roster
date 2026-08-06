import { Trash2 } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { AssignmentHeader } from "~/components/custom/classes/assignments/assignment-header";
import { useAssignmentGroups } from "~/components/custom/classes/groups/shared/use-assignment-groups";
import { TeacherAssignmentGroups } from "~/components/custom/classes/groups/teacher/teacher-assignment-groups";
import { DeleteDialog, STAKES } from "~/components/custom/delete-dialog";
import { Page } from "~/components/custom/layout/page";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import {
  type AssignmentItem,
  api,
  errorStatus,
  type GroupItem,
  useAction,
} from "~/lib/api";
import { count } from "~/lib/format";

/**
 * /classes/:classId/assignments/:assignmentId/manage: the teacher's assignment
 * page, with the without-a-group pool and full group management. Its own page
 * rather than a role branch, because F8+ grows it into repos, progress and
 * grading. A caller who is only enrolled here is redirected to the student
 * page.
 *
 * One request: the groups response carries the assignment, class identity and
 * the caller's role, so the header costs no extra /api/classes fetch.
 */
export function TeacherAssignmentPage() {
  const { classId = "", assignmentId = "" } = useParams();
  const g = useAssignmentGroups(classId, assignmentId);

  // 404 = the class/assignment doesn't exist or the caller isn't in it,
  // distinct from a transient failure, which gets the refresh message.
  const notFound = errorStatus(g.error) === 404;

  return (
    <Loading loading={g.isLoading} className="flex-1">
      {g.role === "student" ? (
        <Navigate
          to={`/classes/${classId}/assignments/${assignmentId}`}
          replace
        />
      ) : g.error || !g.assignment ? (
        <Page>
          <Text variant="error">
            {!notFound && g.error
              ? "Couldn't load this assignment. Refresh to retry."
              : "This assignment doesn't exist (or you don't teach its class)."}
          </Text>
          <Link to="/classes" className="text-sm underline">
            ‹ Back to classes
          </Link>
        </Page>
      ) : (
        <Page>
          <AssignmentHeader
            className={g.className ?? ""}
            assignment={g.assignment}
            kind="teaching"
            action={
              <DeleteAssignmentAction
                classId={classId}
                assignment={g.assignment}
                groups={g.groups}
                placedCount={g.placedCount}
              />
            }
          />
          <TeacherAssignmentGroups
            classId={classId}
            assignment={g.assignment}
          />
        </Page>
      )}
    </Loading>
  );
}

/**
 * Deleting the assignment, and the reason this page owns the verb rather than
 * the class hub's edit pencil: the groups it would take are on the screen
 * behind the dialog, so `stakes` can count them instead of guessing.
 */
function DeleteAssignmentAction({
  classId,
  assignment,
  groups,
  placedCount,
}: {
  classId: string;
  assignment: AssignmentItem;
  groups: GroupItem[];
  /** Distinct students in some group of this assignment, derived once by the hook. */
  placedCount: number;
}) {
  const navigate = useNavigate();
  // Leaving IS the refresh: on success the assignment this page renders no
  // longer exists, so `useAction`'s revalidate step navigates instead of
  // refetching. Failures still surface on the global strip, as everywhere else.
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
          // Named apart from the dialog's own "Delete assignment": one opens
          // the question, the other answers it, and a screen reader shouldn't
          // meet the same words twice.
          aria-label="Delete this assignment"
          title="Delete this assignment"
        >
          <Trash2 className="text-muted-foreground" />
          Delete assignment
        </Button>
      }
      what="assignment"
      name={assignment.title}
      stakes={assignmentStakes(groups, placedCount)}
      onDelete={() =>
        act(() =>
          api.api.classes[":id"].assignments[":assignmentId"].$delete({
            param: { id: classId, assignmentId: assignment.id },
          }),
        )
      }
    />
  );
}

/** What deleting an assignment takes and leaves, counted from what the page already
 *  loaded. An empty assignment says so rather than listing three zeroes. */
function assignmentStakes(groups: GroupItem[], placedCount: number): string[] {
  if (groups.length === 0) return ["No groups have formed in it yet."];
  const repos = groups.filter((g) => g.repoFullName !== null).length;
  return [
    STAKES.teams(groups.length),
    ...(placedCount > 0
      ? [STAKES.students(placedCount, "this assignment and their place in it")]
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
