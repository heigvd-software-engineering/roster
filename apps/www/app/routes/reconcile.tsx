import { Auth } from "~/components/custom/shell/auth";
import { ReconcilePage } from "~/pages/reconcile-page";

/** /classes/:id/reconcile: audit the class against GitHub, apply what's accepted. */
export default function Reconcile() {
  return (
    <Auth>
      <ReconcilePage />
    </Auth>
  );
}
