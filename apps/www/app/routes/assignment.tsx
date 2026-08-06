import { Auth } from "~/components/custom/shell/auth";
import { StudentAssignmentPage } from "~/pages/student-assignment-page";

/** /classes/:classId/assignments/:assignmentId: the student's assignment page (accept flows). */
export default function Assignment() {
  return (
    <Auth>
      <StudentAssignmentPage />
    </Auth>
  );
}
