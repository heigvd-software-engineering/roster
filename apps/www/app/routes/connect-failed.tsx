import { Auth } from "~/components/custom/shell/auth";
import { pageTitle } from "~/lib/title";
import { ConnectFailedPage } from "~/pages/connect-failed-page";
import type { Route } from "./+types/connect-failed";

export const meta: Route.MetaFunction = () => [
  { title: pageTitle("Connection failed") },
];

export default function ConnectFailed() {
  return (
    <Auth>
      <ConnectFailedPage />
    </Auth>
  );
}
