import { create } from "zustand";
import { getRpcClient, RpcError } from "~/lib/rpc-client";

const TOKEN_STORAGE_KEY = "xdeck_token";
let pendingLoginRequest: Promise<void> | null = null;

function getStoredToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

function clearStoredToken() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

interface AuthState {
  token: string | null;
  isSetupComplete: boolean | null; // null = not yet checked
  isAuthenticated: boolean;
  isSessionRestored: boolean;
  isLoading: boolean;
  error: string | null;

  checkSetupStatus: () => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  isSetupComplete: null,
  isAuthenticated: false,
  isSessionRestored: false,
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
    if (pendingLoginRequest) {
      return pendingLoginRequest;
    }

    set({ isLoading: true, error: null });
    const request = (async () => {
      const rpc = getRpcClient();
      try {
        const result = await rpc.call<{ token: string }>("auth.login", {
          username,
          password,
        });
        setStoredToken(result.token);
        rpc.setAuthToken(result.token);
        set({
          token: result.token,
          isAuthenticated: true,
          isSessionRestored: true,
          isLoading: false,
          error: null,
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
    })();

    pendingLoginRequest = request;
    try {
      await request;
    } finally {
      if (pendingLoginRequest === request) {
        pendingLoginRequest = null;
      }
    }
  },

  logout: () => {
    const rpc = getRpcClient();
    rpc.setAuthToken(null);
    clearStoredToken();
    pendingLoginRequest = null;
    set({ token: null, isAuthenticated: false, isSessionRestored: true });
  },

  restoreSession: async () => {
    set({ isSessionRestored: false });

    const token = getStoredToken();
    const rpc = getRpcClient();

    if (!token) {
      rpc.setAuthToken(null);
      set({ token: null, isAuthenticated: false, isSessionRestored: true });
      return;
    }

    rpc.setAuthToken(token);
    set({
      token,
      isAuthenticated: true,
      error: null,
    });

    try {
      await rpc.authenticateSession();
      set({ isSessionRestored: true });
    } catch (err) {
      const isAuthError =
        err instanceof RpcError && (err.code === 1001 || err.code === 1002);

      if (isAuthError) {
        clearStoredToken();
        rpc.setAuthToken(null);
        set({
          token: null,
          isAuthenticated: false,
          isSessionRestored: true,
          error: "Session expired, please sign in again",
        });
        return;
      }

      console.error("Failed to verify restored session:", err);
      set({ isSessionRestored: true });
    }
  },
}));
