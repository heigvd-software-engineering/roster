import { Page } from "~/components/custom/layout/page";
import { ConnectAssistant } from "~/components/custom/rules/connect-assistant";

/** /connect-assistant: the teacher's setup guide, its own page — linked
 *  from the Connected assistants info hint, out of the way everywhere else. */
export function ConnectAssistantPage() {
  return (
    <Page>
      <ConnectAssistant />
    </Page>
  );
}
