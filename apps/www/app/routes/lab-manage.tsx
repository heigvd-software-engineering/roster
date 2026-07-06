import { Auth } from "~/components/custom/shell/auth";
import { TeacherLabPage } from "~/pages/teacher-lab-page";

/** /classes/:classId/labs/:labId/manage — the teacher's lab page. */
export default function LabManage() {
  return (
    <Auth>
      <TeacherLabPage />
    </Auth>
  );
}
