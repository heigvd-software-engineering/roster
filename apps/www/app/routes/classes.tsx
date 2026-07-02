import { Auth } from "~/components/custom/shell/auth";
import { ClassesPage } from "~/pages/classes-page";

/** /classes — the teacher hub. */
export default function Classes() {
  return (
    <Auth>
      <ClassesPage />
    </Auth>
  );
}
