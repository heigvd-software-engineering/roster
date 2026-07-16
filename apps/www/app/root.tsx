import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { Container } from "~/components/custom/layout/container";
import { Stack } from "~/components/custom/layout/stack";
import { AppLayout } from "~/components/custom/shell/app-layout";
import { BrandHeader } from "~/components/custom/typography/brand-header";
import { Text } from "~/components/custom/typography/text";
import { AuthProvider } from "~/contexts/auth-context";
import { MessageProvider } from "~/contexts/message-context";
import { ThemeProvider } from "~/contexts/theme-context";
import type { Route } from "./+types/root";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Paint-time theme bootstrap ONLY — everything after hydration lives
            in ThemeProvider. React runs after first paint, so a context alone
            would flash the wrong scheme; and an inline script in JSX requires
            dangerouslySetInnerHTML (string children of <script> are escaped).
            Static string, no user input. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static scheme snippet, no user input
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=localStorage.getItem("theme");var t=s==="terminal";var dark=t||s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var c=document.documentElement.classList;c.toggle("dark",dark);c.toggle("terminal",t)})();`,
          }}
        />
      </head>
      <body className="graph-paper min-h-screen">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MessageProvider>
        <AuthProvider>
          <AppLayout>
            <Outlet />
          </AppLayout>
        </AuthProvider>
      </MessageProvider>
    </ThemeProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16">
      <Container>
        <Stack gap="lg" align="start">
          <BrandHeader title={message} />
          <Text variant="subtitle">{details}</Text>
          {stack && (
            <pre className="w-full overflow-x-auto rounded-lg border border-border p-4">
              <code>{stack}</code>
            </pre>
          )}
        </Stack>
      </Container>
    </main>
  );
}
