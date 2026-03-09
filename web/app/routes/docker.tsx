import { useEffect } from "react";
import {
  Container,
  HardDrive,
  Network,
  FolderOpen,
  Loader2,
} from "lucide-react";

import { AppHeader } from "~/components/app-header";
import { Badge } from "~/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { ContainerList } from "~/components/docker/container-list";
import { ImageList } from "~/components/docker/image-list";
import { NetworkList } from "~/components/docker/network-list";
import { ComposeList } from "~/components/docker/compose-list";
import { DockerNotAvailable } from "~/components/docker/docker-not-available";
import { useDockerStore } from "~/stores/docker-store";

export function meta() {
  return [
    { title: "Docker — XDeck" },
    { name: "description", content: "Manage Docker containers, images, networks and Compose projects" },
  ];
}

export default function DockerPage() {
  const { dockerStatus, isLoading, fetchStatus, subscribeToEvents } =
    useDockerStore();

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!dockerStatus?.available) return;
    const unsubscribe = subscribeToEvents();
    return unsubscribe;
  }, [dockerStatus?.available, subscribeToEvents]);

  return (
    <>
      <AppHeader title="Docker" />

      <div className="flex-1 overflow-auto p-6">
        {/* Loading state — initial fetch */}
        {isLoading && !dockerStatus && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Detecting container runtime…</span>
          </div>
        )}

        {/* Docker not available */}
        {!isLoading && dockerStatus && !dockerStatus.available && (
          <DockerNotAvailable />
        )}

        {/* Docker available */}
        {dockerStatus?.available && (
          <>
            {/* Status bar */}
            <div className="mb-6 flex items-center gap-3">
              <Badge variant="outline" className="bg-green-500/15 text-green-700 dark:text-green-400">
                Connected
              </Badge>
              {dockerStatus.runtime && (
                <span className="text-sm text-muted-foreground capitalize">
                  {dockerStatus.runtime}
                </span>
              )}
              {dockerStatus.version && (
                <span className="text-sm text-muted-foreground">
                  v{dockerStatus.version}
                </span>
              )}
              {dockerStatus.api_version && (
                <span className="text-xs text-muted-foreground">
                  (API {dockerStatus.api_version})
                </span>
              )}
            </div>

            <Tabs defaultValue="containers" className="w-full">
              <TabsList>
                <TabsTrigger value="containers" className="gap-1.5">
                  <Container className="size-4" />
                  Containers
                </TabsTrigger>
                <TabsTrigger value="images" className="gap-1.5">
                  <HardDrive className="size-4" />
                  Images
                </TabsTrigger>
                <TabsTrigger value="networks" className="gap-1.5">
                  <Network className="size-4" />
                  Networks
                </TabsTrigger>
                <TabsTrigger value="compose" className="gap-1.5">
                  <FolderOpen className="size-4" />
                  Compose
                </TabsTrigger>
              </TabsList>

              <TabsContent value="containers" className="mt-6">
                <ContainerList />
              </TabsContent>

              <TabsContent value="images" className="mt-6">
                <ImageList />
              </TabsContent>

              <TabsContent value="networks" className="mt-6">
                <NetworkList />
              </TabsContent>

              <TabsContent value="compose" className="mt-6">
                <ComposeList />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </>
  );
}
