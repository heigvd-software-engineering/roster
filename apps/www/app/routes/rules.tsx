import { Auth } from "~/components/custom/shell/auth";
import { pageTitle } from "~/lib/title";
import { RulesPage } from "~/pages/rules-page";
import type { Route } from "./+types/rules";

/* The words of the account-menu item that leads here, and of the page's own
   heading. */
export const meta: Route.MetaFunction = () => [
  { title: pageTitle("How roster works") },
];

export default function Rules() {
  return (
    <Auth>
      <RulesPage />
    </Auth>
  );
}
