import { Auth } from "~/components/custom/shell/auth";
import { ClassConfirmPage } from "~/pages/class-confirm-page";

/** /classes/:id/confirm: finish connecting a class.
 *  No `meta`: the tab names the organization, which only the fetched page
 *  knows (`useDocumentTitle`). */
export default function ClassConfirm() {
  return (
    <Auth>
      <ClassConfirmPage />
    </Auth>
  );
}
