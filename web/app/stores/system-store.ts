import { create } from "zustand";
import { getRpcClient } from "~/lib/rpc-client";

// ── Types mirroring the Rust SystemStatus struct ─────────────────

export interface DiskPartition {
  name: string;
  mount_point: string;
  total: number;
  used: number;
  available: number;
  usage_percent: number;
  fs_type: string;
}

export interface NetworkInterface {
  name: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_speed: number;
  tx_speed: number;
}

export interface SystemStatus {
  cpu_usage: number;
  cpu_cores: number;
  memory_total: number;
  memory_used: number;
  memory_usage_percent: number;
  disk_partitions: DiskPartition[];
  disk_read_speed: number;
  disk_write_speed: number;
  network_interfaces: NetworkInterface[];
  uptime: number;
  load_average: [number, number, number];
  os_name: string;
  os_version: string;
  hostname: string;
}

export interface DaemonInfo {
  name: string;
  version: string;
}

interface SystemState {
  status: SystemStatus | null;
  daemonInfo: DaemonInfo | null;
  isLoading: boolean;

  fetchStatus: () => Promise<void>;
  fetchDaemonInfo: () => Promise<void>;
  updateStatus: (status: SystemStatus) => void;
  subscribeToMetrics: () => () => void;
}

export const useSystemStore = create<SystemState>((set) => ({
  status: null,
  daemonInfo: null,
  isLoading: false,

  fetchStatus: async () => {
    set({ isLoading: true });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<SystemStatus>("system.status");
      set({ status: result, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch system status:", err);
      set({ isLoading: false });
    }
  },

  fetchDaemonInfo: async () => {
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<DaemonInfo>("system.info");
      set({ daemonInfo: result });
    } catch (err) {
      console.error("Failed to fetch daemon info:", err);
    }
  },

  updateStatus: (status) => set({ status }),

  subscribeToMetrics: () => {
    const rpc = getRpcClient();
    const unsub = rpc.on("event.system.metrics", (params) => {
      set({ status: params as SystemStatus });
    });
    return unsub;
  },
}));
