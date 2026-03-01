import { create } from "zustand";
import { getRpcClient, RpcError } from "~/lib/rpc-client";

interface AuthState {
  token: string | null;
  isSetupComplete: boolean | null; // null = not yet checked
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  checkSetupStatus: () => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  isSetupComplete: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  checkSetupStatus: async () => {
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ setup_complete: boolean }>(
        "auth.setup_status"
      );
      set({ isSetupComplete: result.setup_complete });
    } catch (err) {
      console.error("Failed to check setup status:", err);
      set({ error: "Failed to check setup status" });
    }
  },

  setup: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const rpc = getRpcClient();
      await rpc.call("auth.setup", { username, password });
      set({ isSetupComplete: true, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Setup failed",
      });
      throw err;
    }
  },

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ token: string }>("auth.login", {
        username,
        password,
      });
      localStorage.setItem("xdeck_token", result.token);
      set({
        token: result.token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      const isSetupRequired = err instanceof RpcError && err.code === 1004;
      set({
        isLoading: false,
        isSetupComplete: isSetupRequired ? false : get().isSetupComplete,
        error: err instanceof Error ? err.message : "Login failed",
      });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem("xdeck_token");
    set({ token: null, isAuthenticated: false });
  },

  restoreSession: () => {
    const token = localStorage.getItem("xdeck_token");
    if (token) {
      set({ token, isAuthenticated: true });
    }
  },
}));
