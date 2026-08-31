import { Auth } from "~/components/custom/shell/auth";
import { pageTitle } from "~/lib/title";
import { ConnectAssistantPage } from "~/pages/connect-assistant-page";
import type { Route } from "./+types/connect-assistant";

/* Reached from the info Hint on the account menu's Connected assistants
   group; the heading below repeats the words the hint used. GitHub linking
   is not required: connecting an assistant never touches GitHub, the same
   reasoning as the consent route. */
export const meta: Route.MetaFunction = () => [
  { title: pageTitle("Connect an assistant") },
];

export default function ConnectAssistantRoute() {
  return (
    <Auth requireGithubLinked={false}>
      <ConnectAssistantPage />
    </Auth>
  );
}
