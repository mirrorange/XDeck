import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
  useLocation,
} from "react-router";

import type { Route } from "./+types/root";
import { getRpcClient } from "~/lib/rpc-client";
import { useAuthStore } from "~/stores/auth-store";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { checkSetupStatus, isSetupComplete, restoreSession, isAuthenticated } =
    useAuthStore();

  // On app mount: connect WS and check setup status
  useEffect(() => {
    const rpc = getRpcClient();
    rpc.connect();
    restoreSession();
    checkSetupStatus();
  }, [checkSetupStatus, restoreSession]);

  // Route based on setup status
  useEffect(() => {
    if (isSetupComplete === null) return; // still loading

    const isOnPublicPage =
      location.pathname === "/login" || location.pathname === "/setup";

    if (!isSetupComplete) {
      // Need to set up admin first
      if (location.pathname !== "/setup") {
        navigate("/setup", { replace: true });
      }
    } else if (!isAuthenticated && !isOnPublicPage) {
      navigate("/login", { replace: true });
    }
  }, [isSetupComplete, isAuthenticated, location.pathname, navigate]);

  return <Outlet />;
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
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold mb-2">{message}</h1>
        <p className="text-muted-foreground mb-4">{details}</p>
        {stack && (
          <pre className="text-left w-full p-4 overflow-x-auto rounded-lg bg-muted text-xs">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
