import { create } from "zustand";
import { getRpcClient, type EventHandler } from "~/lib/rpc-client";

// -- Types -------------------------------------------------------

export type ContainerRuntime = "docker" | "podman";

export interface DockerStatus {
  available: boolean;
  runtime: ContainerRuntime | null;
  version: string | null;
  api_version: string | null;
  socket_path: string | null;
  error: string | null;
}

export interface PortMapping {
  host_ip: string | null;
  host_port: number | null;
  container_port: number;
  protocol: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  ports: PortMapping[];
  labels: Record<string, string>;
  compose_project: string | null;
}

export interface ContainerDetail {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: string;
  ports: PortMapping[];
  env: string[];
  mounts: MountInfo[];
  networks: Record<string, NetworkEndpoint>;
  labels: Record<string, string>;
  restart_policy: string | null;
  cmd: string[] | null;
  entrypoint: string[] | null;
  compose_project: string | null;
}

export interface MountInfo {
  source: string;
  destination: string;
  mode: string;
  rw: boolean;
}

export interface NetworkEndpoint {
  network_id: string;
  ip_address: string;
  gateway: string;
}

export interface ImageInfo {
  id: string;
  repo_tags: string[];
  size: number;
  created: number;
  in_use: boolean;
}

export interface DockerNetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  containers: number;
}

export interface ComposeServiceInfo {
  name: string;
  container_id: string | null;
  state: string;
  image: string;
}

export interface ComposeProjectInfo {
  id: string;
  name: string;
  file_path: string;
  cwd: string;
  status: string;
  services: ComposeServiceInfo[];
  created_at: string;
  updated_at: string;
}

// -- Store -------------------------------------------------------

interface DockerState {
  // Status
  dockerStatus: DockerStatus | null;
  isLoading: boolean;

  // Containers
  containers: ContainerInfo[];
  containersLoading: boolean;

  // Images
  images: ImageInfo[];
  imagesLoading: boolean;

  // Networks
  networks: DockerNetworkInfo[];
  networksLoading: boolean;

  // Compose
  composeProjects: ComposeProjectInfo[];
  composeLoading: boolean;

  // Actions
  fetchStatus: () => Promise<void>;
  reconnect: () => Promise<void>;
  fetchContainers: (all?: boolean) => Promise<void>;
  inspectContainer: (id: string) => Promise<ContainerDetail>;
  startContainer: (id: string) => Promise<void>;
  stopContainer: (id: string) => Promise<void>;
  restartContainer: (id: string) => Promise<void>;
  removeContainer: (id: string, force?: boolean) => Promise<void>;
  pauseContainer: (id: string) => Promise<void>;
  unpauseContainer: (id: string) => Promise<void>;
  containerLogs: (id: string, tail?: string) => Promise<string[]>;

  fetchImages: () => Promise<void>;
  removeImage: (id: string, force?: boolean) => Promise<void>;
  pruneImages: () => Promise<{ images_deleted: number; space_reclaimed: number }>;

  fetchNetworks: () => Promise<void>;
  removeNetwork: (id: string) => Promise<void>;

  fetchComposeProjects: () => Promise<void>;
  addComposeProject: (name: string, filePath: string, cwd: string) => Promise<ComposeProjectInfo>;
  removeComposeProject: (id: string) => Promise<void>;
  composeUp: (projectId: string) => Promise<string>;
  composeDown: (projectId: string) => Promise<string>;
  composeRestart: (projectId: string) => Promise<string>;
  composePull: (projectId: string) => Promise<string>;

  subscribeToEvents: () => () => void;
}

export const useDockerStore = create<DockerState>((set, get) => ({
  dockerStatus: null,
  isLoading: false,
  containers: [],
  containersLoading: false,
  images: [],
  imagesLoading: false,
  networks: [],
  networksLoading: false,
  composeProjects: [],
  composeLoading: false,

  fetchStatus: async () => {
    set({ isLoading: true });
    try {
      const rpc = getRpcClient();
      const status = await rpc.call<DockerStatus>("docker.status");
      set({ dockerStatus: status, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch Docker status:", err);
      set({ isLoading: false });
    }
  },

  reconnect: async () => {
    set({ isLoading: true });
    try {
      const rpc = getRpcClient();
      const status = await rpc.call<DockerStatus>("docker.reconnect");
      set({ dockerStatus: status, isLoading: false });
    } catch (err) {
      console.error("Failed to reconnect Docker:", err);
      set({ isLoading: false });
    }
  },

  // -- Containers --

  fetchContainers: async (all = true) => {
    set({ containersLoading: true });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ containers: ContainerInfo[] }>(
        "docker.container.list",
        { all }
      );
      set({ containers: result.containers, containersLoading: false });
    } catch (err) {
      console.error("Failed to fetch containers:", err);
      set({ containersLoading: false });
    }
  },

  inspectContainer: async (id: string) => {
    const rpc = getRpcClient();
    return rpc.call<ContainerDetail>("docker.container.inspect", { id });
  },

  startContainer: async (id: string) => {
    const rpc = getRpcClient();
    await rpc.call("docker.container.start", { id });
    await get().fetchContainers();
  },

  stopContainer: async (id: string) => {
    const rpc = getRpcClient();
    await rpc.call("docker.container.stop", { id });
    await get().fetchContainers();
  },

  restartContainer: async (id: string) => {
    const rpc = getRpcClient();
    await rpc.call("docker.container.restart", { id });
    await get().fetchContainers();
  },

  removeContainer: async (id: string, force = false) => {
    const rpc = getRpcClient();
    await rpc.call("docker.container.remove", { id, force });
    await get().fetchContainers();
  },

  pauseContainer: async (id: string) => {
    const rpc = getRpcClient();
    await rpc.call("docker.container.pause", { id });
    await get().fetchContainers();
  },

  unpauseContainer: async (id: string) => {
    const rpc = getRpcClient();
    await rpc.call("docker.container.unpause", { id });
    await get().fetchContainers();
  },

  containerLogs: async (id: string, tail?: string) => {
    const rpc = getRpcClient();
    const result = await rpc.call<{ logs: string[] }>("docker.container.logs", {
      id,
      tail,
    });
    return result.logs;
  },

  // -- Images --

  fetchImages: async () => {
    set({ imagesLoading: true });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ images: ImageInfo[] }>("docker.image.list");
      set({ images: result.images, imagesLoading: false });
    } catch (err) {
      console.error("Failed to fetch images:", err);
      set({ imagesLoading: false });
    }
  },

  removeImage: async (id: string, force = false) => {
    const rpc = getRpcClient();
    await rpc.call("docker.image.remove", { id, force });
    await get().fetchImages();
  },

  pruneImages: async () => {
    const rpc = getRpcClient();
    const result = await rpc.call<{ images_deleted: number; space_reclaimed: number }>(
      "docker.image.prune"
    );
    await get().fetchImages();
    return result;
  },

  // -- Networks --

  fetchNetworks: async () => {
    set({ networksLoading: true });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ networks: DockerNetworkInfo[] }>("docker.network.list");
      set({ networks: result.networks, networksLoading: false });
    } catch (err) {
      console.error("Failed to fetch networks:", err);
      set({ networksLoading: false });
    }
  },

  removeNetwork: async (id: string) => {
    const rpc = getRpcClient();
    await rpc.call("docker.network.remove", { id });
    await get().fetchNetworks();
  },

  // -- Compose --

  fetchComposeProjects: async () => {
    set({ composeLoading: true });
    try {
      const rpc = getRpcClient();
      const result = await rpc.call<{ projects: ComposeProjectInfo[] }>(
        "docker.compose.list"
      );
      set({ composeProjects: result.projects, composeLoading: false });
    } catch (err) {
      console.error("Failed to fetch compose projects:", err);
      set({ composeLoading: false });
    }
  },

  addComposeProject: async (name: string, filePath: string, cwd: string) => {
    const rpc = getRpcClient();
    const project = await rpc.call<ComposeProjectInfo>("docker.compose.add", {
      name,
      file_path: filePath,
      cwd,
    });
    await get().fetchComposeProjects();
    return project;
  },

  removeComposeProject: async (id: string) => {
    const rpc = getRpcClient();
    await rpc.call("docker.compose.remove", { id });
    await get().fetchComposeProjects();
  },

  composeUp: async (projectId: string) => {
    const rpc = getRpcClient();
    const result = await rpc.call<{ output: string }>("docker.compose.up", {
      project_id: projectId,
    });
    await get().fetchComposeProjects();
    await get().fetchContainers();
    return result.output;
  },

  composeDown: async (projectId: string) => {
    const rpc = getRpcClient();
    const result = await rpc.call<{ output: string }>("docker.compose.down", {
      project_id: projectId,
    });
    await get().fetchComposeProjects();
    await get().fetchContainers();
    return result.output;
  },

  composeRestart: async (projectId: string) => {
    const rpc = getRpcClient();
    const result = await rpc.call<{ output: string }>("docker.compose.restart", {
      project_id: projectId,
    });
    await get().fetchComposeProjects();
    return result.output;
  },

  composePull: async (projectId: string) => {
    const rpc = getRpcClient();
    const result = await rpc.call<{ output: string }>("docker.compose.pull", {
      project_id: projectId,
    });
    return result.output;
  },

  // -- Events --

  subscribeToEvents: () => {
    const rpc = getRpcClient();
    const handler: EventHandler = () => {
      // Refresh containers on any docker container state change
      get().fetchContainers();
    };
    const unsubscribe = rpc.on("event.docker.container.state", handler);
    return unsubscribe;
  },
}));
