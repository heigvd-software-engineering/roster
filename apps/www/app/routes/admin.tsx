import { Auth } from "~/components/custom/shell/auth";
import { AdminPage } from "~/pages/admin-page";

export default function Admin() {
  return (
    <Auth>
      <AdminPage />
    </Auth>
  );
}
