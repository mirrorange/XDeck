import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";

import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { AppSidebar } from "~/components/app-sidebar";
import { ConnectionStatus } from "~/components/connection-status";
import { useAuthStore } from "~/stores/auth-store";
import { useSystemStore } from "~/stores/system-store";
import { getRpcClient } from "~/lib/rpc-client";

/**
 * Authenticated layout — wraps all dashboard/process routes.
 * Handles auth guard, WebSocket connection, real-time subscriptions.
 */
export default function AppLayout() {
  const navigate = useNavigate();
  const { isAuthenticated, restoreSession } = useAuthStore();
  const { fetchDaemonInfo } = useSystemStore();

  // Restore session from localStorage on mount
  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Auth guard: redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Connect WebSocket and fetch initial data when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    const rpc = getRpcClient();
    rpc.connect();
    fetchDaemonInfo();
  }, [isAuthenticated, fetchDaemonInfo]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
      <ConnectionStatus />
    </SidebarProvider>
  );
}
