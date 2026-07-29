import { Auth } from "~/components/custom/shell/auth";
import { RulesPage } from "~/pages/rules-page";

export default function Rules() {
  return (
    <Auth>
      <RulesPage />
    </Auth>
  );
}
