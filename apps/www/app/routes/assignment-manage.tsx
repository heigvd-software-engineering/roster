import { Auth } from "~/components/custom/shell/auth";
import { TeacherAssignmentPage } from "~/pages/teacher-assignment-page";

/** /classes/:classId/assignments/:assignmentId/manage: the teacher's assignment page.
 *  No `meta`: the tab is named after the assignment, which only the fetched
 *  page knows (`useDocumentTitle`). */
export default function AssignmentManage() {
  return (
    <Auth>
      <TeacherAssignmentPage />
    </Auth>
  );
}
