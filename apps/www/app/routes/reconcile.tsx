import { Auth } from "~/components/custom/shell/auth";
import { ReconcilePage } from "~/pages/reconcile-page";

/** /classes/:id/reconcile: audit the class against GitHub, apply what's accepted.
 *  No `meta`: the tab names the class, which only the fetched page knows
 *  (`useDocumentTitle`). */
export default function Reconcile() {
  return (
    <Auth>
      <ReconcilePage />
    </Auth>
  );
}
