import { ClipboardList } from "lucide-react";
import { Link } from "react-router";
import { Container } from "~/components/custom/layout/container";
import { Row } from "~/components/custom/layout/row";
import { MainSwitchIdentity } from "~/components/custom/shell/main-switch-identity";
import { useAuth } from "~/contexts/auth-context";

/**
 * The app's top bar: the Roster wordmark on the left, the account menu pinned
 * top-right. Full-bleed border; inner content aligns to the page Container.
 * Renders nothing until there's a signed-in user (so the login screen stays
 * chrome-free). Wears the card surface, so it stays white above the page's
 * gray in light and stays a step lighter than it in dark.
 */
export function AppHeader() {
  const { user } = useAuth();
  if (!user) {
    return null;
  }

  return (
    <header className="w-full border-b border-border bg-card">
      <Container className="py-3">
        <Row justify="between">
          <Link
            to="/classes"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <ClipboardList aria-hidden className="size-5" />
            Roster
          </Link>
          <MainSwitchIdentity />
        </Row>
      </Container>
    </header>
  );
}
