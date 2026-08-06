import { Container } from "~/components/custom/layout/container";
import { AppHeader } from "~/components/custom/shell/app-header";
import { MessageViewport } from "~/contexts/message-context";

/**
 * The frame shared by every page. Fills the viewport height and hosts the
 * shared top bar (AppHeader, shown once signed in) above the centered content
 * column (via Container). Global messages overlay the content right below the
 * header, with the wrapper as the positioning context, so nothing moves.
 * Pages control their own vertical arrangement with `flex-1`.
 */
type AppLayoutProps = {
  children: React.ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <div className="relative flex flex-1 flex-col">
        <MessageViewport />
        <main className="flex flex-1 flex-col">
          <Container className="flex flex-1 flex-col">{children}</Container>
        </main>
      </div>
    </div>
  );
}
