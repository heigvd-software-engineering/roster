import { Auth } from "~/components/custom/shell/auth";
import { LabPage } from "~/pages/lab-page";

/** /classes/:classId/labs/:labId — the per-lab management view. */
export default function Lab() {
  return (
    <Auth>
      <LabPage />
    </Auth>
  );
}
