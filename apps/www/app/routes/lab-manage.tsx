import { Auth } from "~/components/custom/shell/auth";
import { TeacherLabPage } from "~/pages/teacher-lab-page";

/** The wall earns the wide column: ~12 group cards want 2 rows, not 3. */
export const handle = { wide: true };

/** /classes/:classId/labs/:labId/manage — the teacher's lab page. */
export default function LabManage() {
  return (
    <Auth>
      <TeacherLabPage />
    </Auth>
  );
}
