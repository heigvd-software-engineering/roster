import { useSession } from "~/lib/auth";
import { HomePage } from "~/pages/home-page";
import { LoginPage } from "~/pages/login-page";

/**
 * Index route. Routing/session glue only — it picks which page to render.
 * (A real route guard / separate authed routes arrive with GitHub onboarding.)
 */
export default function Home() {
  const { data, isPending } = useSession();

  if (isPending) {
    return null;
  }

  return data?.user ? <HomePage /> : <LoginPage />;
}
