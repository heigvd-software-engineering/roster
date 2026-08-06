import { Auth } from "~/components/custom/shell/auth";
import { TeacherAssignmentPage } from "~/pages/teacher-assignment-page";

/** /classes/:classId/assignments/:assignmentId/manage: the teacher's assignment page. */
export default function AssignmentManage() {
  return (
    <Auth>
      <TeacherAssignmentPage />
    </Auth>
  );
}
