import { AppHeader } from "~/components/custom/app-header";
import { Container } from "~/components/custom/layout/container";

/**
 * AppLayout — the frame shared by every page. Fills the viewport height and
 * hosts the shared top bar (AppHeader, shown once signed in) above the centered
 * content column (via Container). The graph-paper backdrop is app-wide in
 * root.tsx; pages control their own vertical arrangement with `flex-1`.
 */
type AppLayoutProps = {
  children: React.ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col">{children}</Container>
      </main>
    </div>
  );
}
