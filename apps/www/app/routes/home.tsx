import { Navigate, useLocation } from "react-router";
import { Auth } from "~/components/custom/shell/auth";

/** /: login when signed out (rendered in place), else the classes hub.
 *  The GitHub App setup callback reports failures as `/?error=…`; those
 *  route to the connect-failed explainer, not the hub.
 *
 *  No `meta`: this route either redirects or shows the login screen, and
 *  root's plain "Roster" is the right tab for both. */
export default function Home() {
  const { search } = useLocation();
  const error = new URLSearchParams(search).get("error");
  return (
    <Auth>
      {error ? (
        <Navigate
          to={`/classes/connect-failed?reason=${encodeURIComponent(error)}`}
          replace
        />
      ) : (
        <Navigate to="/classes" replace />
      )}
    </Auth>
  );
}
