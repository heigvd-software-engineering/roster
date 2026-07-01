import { Container } from "~/components/custom/layout/container";

/**
 * AppLayout — the frame shared by every page. Fills the viewport height and
 * hosts the centered content column (via Container); the app is centered all
 * around. The graph-paper backdrop is app-wide in root.tsx; shared chrome
 * (e.g. a top nav) will live here later. Pages control their own vertical
 * arrangement with `flex-1`.
 */
type AppLayoutProps = {
  children: React.ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <Container className="flex flex-1 flex-col">{children}</Container>
    </main>
  );
}
