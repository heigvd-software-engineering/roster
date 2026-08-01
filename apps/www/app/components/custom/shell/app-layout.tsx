import { useMatches } from "react-router";
import { Container } from "~/components/custom/layout/container";
import { AppHeader } from "~/components/custom/shell/app-header";
import { MessageViewport } from "~/contexts/message-context";

/** A route opts into the wide content column by exporting
 *  `handle = { wide: true }` (see routes/lab-manage.tsx). */
type RouteHandle = { wide?: boolean } | undefined;

/**
 * AppLayout — the frame shared by every page. Fills the viewport height and
 * hosts the shared top bar (AppHeader, shown once signed in) above the centered
 * content column (via Container). Global messages overlay the content right
 * below the header (the wrapper is the positioning context — nothing moves).
 * The graph-paper backdrop is app-wide in root.tsx; pages control their own
 * vertical arrangement with `flex-1`.
 */
type AppLayoutProps = {
  children: React.ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  // Header and content share the width decision, or the top bar's edges
  // would misalign with a wide page's content column.
  const wide = useMatches().some(
    (match) => (match.handle as RouteHandle)?.wide === true,
  );
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader wide={wide} />
      <div className="relative flex flex-1 flex-col">
        <MessageViewport />
        <main className="flex flex-1 flex-col">
          <Container wide={wide} className="flex flex-1 flex-col">
            {children}
          </Container>
        </main>
      </div>
    </div>
  );
}
