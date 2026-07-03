import { Auth } from "~/components/custom/shell/auth";
import { JoinPage } from "~/pages/join-page";

/** /join/:token — the student's class join link. */
export default function Join() {
  return (
    <Auth>
      <JoinPage />
    </Auth>
  );
}
