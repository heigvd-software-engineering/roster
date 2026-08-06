import { Auth } from "~/components/custom/shell/auth";
import { pageTitle } from "~/lib/title";
import { AdminPage } from "~/pages/admin-page";
import type { Route } from "./+types/admin";

export const meta: Route.MetaFunction = () => [
  { title: pageTitle("Super admin") },
];

export default function Admin() {
  return (
    <Auth>
      <AdminPage />
    </Auth>
  );
}
