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
        {/* Paint-time theme bootstrap; everything after hydration lives in
            ThemeProvider. React runs after first paint, so a context alone
            would flash the wrong scheme, and an inline script in JSX needs
            dangerouslySetInnerHTML (string children of <script> are
            escaped). */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static scheme snippet, no user input
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=localStorage.getItem("theme");var dark=s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark)})();`,
          }}
        />
      </head>
      <body className="min-h-screen">
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
  let message = "Something went wrong";
  let details = "The app hit an unexpected error.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "That page doesn't exist."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16">
      <Container>
        <Stack gap="lg" align="start">
          <Text variant="title">{message}</Text>
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
