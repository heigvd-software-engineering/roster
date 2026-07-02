import { Navigate } from "react-router";
import { Auth } from "~/components/custom/shell/auth";

/** / — login when signed out (rendered in place), else the classes hub. */
export default function Home() {
  return (
    <Auth>
      <Navigate to="/classes" replace />
    </Auth>
  );
}
