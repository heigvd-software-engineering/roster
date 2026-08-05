import { Auth } from "~/components/custom/shell/auth";
import { ClassConfirmPage } from "~/pages/class-confirm-page";

/** /classes/:id/confirm: finish connecting a class. */
export default function ClassConfirm() {
  return (
    <Auth>
      <ClassConfirmPage />
    </Auth>
  );
}
