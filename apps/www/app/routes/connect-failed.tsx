import { Auth } from "~/components/custom/shell/auth";
import { ConnectFailedPage } from "~/pages/connect-failed-page";

export default function ConnectFailed() {
  return (
    <Auth>
      <ConnectFailedPage />
    </Auth>
  );
}
