import { Auth } from "~/components/custom/shell/auth";
import { StudentAssignmentPage } from "~/pages/student-assignment-page";

/** /classes/:classId/assignments/:assignmentId: the student's assignment page (accept flows).
 *  No `meta`: the tab is named after the assignment, which only the fetched
 *  page knows (`useDocumentTitle`). */
export default function Assignment() {
  return (
    <Auth>
      <StudentAssignmentPage />
    </Auth>
  );
}
