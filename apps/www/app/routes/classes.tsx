import { Auth } from "~/components/custom/shell/auth";
import { pageTitle } from "~/lib/title";
import { ClassesPage } from "~/pages/classes-page";
import type { Route } from "./+types/classes";

export const meta: Route.MetaFunction = () => [{ title: pageTitle("Classes") }];

/** /classes: the teacher hub. */
export default function Classes() {
  return (
    <Auth>
      <ClassesPage />
    </Auth>
  );
}
