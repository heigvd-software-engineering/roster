import { Auth } from "~/components/custom/shell/auth";
import { StudentLabPage } from "~/pages/student-lab-page";

/** /classes/:classId/labs/:labId: the student's lab page (accept flows). */
export default function Lab() {
  return (
    <Auth>
      <StudentLabPage />
    </Auth>
  );
}
