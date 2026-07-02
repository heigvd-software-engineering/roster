import { Link } from "react-router";
import { SwitchIdentity } from "~/components/custom/identity/switch-identity";
import { Container } from "~/components/custom/layout/container";
import { Row } from "~/components/custom/layout/row";
import { useAuth } from "~/lib/auth-context";

/**
 * The app's top bar: the `labs` wordmark on the left, the account menu pinned
 * top-right, a brand-red hairline underneath. Full-bleed border; inner content
 * aligns to the page Container. Renders nothing until there's a signed-in user
 * (so the login screen stays chrome-free).
 */
export function AppHeader() {
  const { account } = useAuth();
  if (!account) {
    return null;
  }

  return (
    <header className="w-full border-b border-border bg-background">
      <Container className="py-3">
        <Row justify="between">
          <Link to="/classes" className="font-bold tracking-tight">
            labs
          </Link>
          <SwitchIdentity />
        </Row>
      </Container>
      <div className="h-0.5 w-full bg-brand" />
    </header>
  );
}
