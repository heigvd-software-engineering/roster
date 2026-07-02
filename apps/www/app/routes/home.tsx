import { Navigate } from "react-router";
import { useAuth } from "~/lib/auth-context";
import { LoginPage } from "~/pages/login-page";

/** Index route: login when signed out, else send to the classes hub. */
export default function Home() {
  const { isLoading, authed } = useAuth();

  if (isLoading) {
    return null;
  }
  return authed ? <Navigate to="/classes" replace /> : <LoginPage />;
}
