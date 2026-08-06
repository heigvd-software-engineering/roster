import { Auth } from "~/components/custom/shell/auth";
import { JoinPage } from "~/pages/join-page";

/** /join/:token: the student's class join link.
 *  No `meta`: the tab follows the page's heading, which changes with the
 *  link's state (`useDocumentTitle`). */
export default function Join() {
  return (
    <Auth>
      <JoinPage />
    </Auth>
  );
}
