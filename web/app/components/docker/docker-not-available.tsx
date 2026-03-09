import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Container,
  Download,
  Loader2,
  RefreshCw,
  Ship,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "~/components/ui/card";
import { useDockerStore } from "~/stores/docker-store";
import { useSnippetStoreStore } from "~/stores/snippet-store-store";
import { useSnippetStore } from "~/stores/snippet-store";
import { useSystemStore } from "~/stores/system-store";

interface InstallOption {
  runtime: string;
  snippetId: string;
  label: string;
  description: string;
}

const INSTALL_OPTIONS: Record<string, InstallOption[]> = {
  linux: [
    {
      runtime: "Docker",
      snippetId: "docker-install-linux-deb",
      label: "Docker Engine (Debian/Ubuntu)",
      description: "Install Docker Engine via official APT repository",
    },
    {
      runtime: "Docker",
      snippetId: "docker-install-linux-rpm",
      label: "Docker Engine (RHEL/CentOS/Fedora)",
      description: "Install Docker Engine via official YUM repository",
    },
    {
      runtime: "Podman",
      snippetId: "podman-install-linux-deb",
      label: "Podman (Debian/Ubuntu)",
      description: "Install Podman via APT",
    },
    {
      runtime: "Podman",
      snippetId: "podman-install-linux-rpm",
      label: "Podman (RHEL/CentOS/Fedora)",
      description: "Install Podman via DNF/YUM",
    },
  ],
  macos: [
    {
      runtime: "Docker",
      snippetId: "docker-install-macos",
      label: "Docker Desktop",
      description: "Download and install Docker Desktop for macOS",
    },
    {
      runtime: "Podman",
      snippetId: "podman-install-macos",
      label: "Podman Desktop",
      description: "Install Podman and Podman Desktop via Homebrew",
    },
  ],
  windows: [
    {
      runtime: "Docker",
      snippetId: "docker-install-windows",
      label: "Docker Desktop",
      description: "Download and install Docker Desktop for Windows",
    },
    {
      runtime: "Podman",
      snippetId: "podman-install-windows",
      label: "Podman Desktop",
      description: "Install Podman Desktop via winget",
    },
  ],
};

export function DockerNotAvailable() {
  const navigate = useNavigate();
  const { fetchStatus, reconnect, dockerStatus, isLoading } = useDockerStore();
  const { installSnippet, fetchSnippetContent, fetchRemoteSnippets, results } =
    useSnippetStoreStore();
  const { fetchSnippets } = useSnippetStore();
  const daemonInfo = useSystemStore((s) => s.daemonInfo);

  const [installingId, setInstallingId] = useState<string | null>(null);

  const osType = daemonInfo?.os_type ?? "linux";
  const options = INSTALL_OPTIONS[osType] ?? INSTALL_OPTIONS.linux;

  const handleInstall = async (option: InstallOption) => {
    setInstallingId(option.snippetId);
    try {
      // Ensure we have remote snippets loaded
      if (results.length === 0) {
        await fetchRemoteSnippets();
      }

      // Find the snippet in the store results
      const remote = results
        .flatMap((r) => r.snippets)
        .find((s) => s.id === option.snippetId);

      if (remote) {
        // Fetch the snippet content (the installation script)
        const content = await fetchSnippetContent(remote);
        // Install it as a local snippet
        await installSnippet(remote, content || remote.command);
        await fetchSnippets();
      }

      // Navigate to terminal page where the user can execute the snippet
      navigate("/terminal");
    } catch (err) {
      console.error("Failed to install snippet:", err);
    }
    setInstallingId(null);
  };

  const handleRetry = async () => {
    await reconnect();
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-muted">
        <Container className="size-10 text-muted-foreground" />
      </div>

      <h2 className="mb-2 text-2xl font-bold">Container Runtime Not Found</h2>
      <p className="mb-2 text-center text-muted-foreground max-w-md">
        XDeck could not detect a running Docker or Podman instance on this
        system. Install a container runtime to manage containers, images,
        networks, and Compose projects.
      </p>

      {dockerStatus?.error && (
        <p className="mb-6 text-sm text-destructive text-center max-w-md">
          {dockerStatus.error}
        </p>
      )}

      <Button
        variant="outline"
        size="sm"
        className="mb-8"
        onClick={handleRetry}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 size-4" />
        )}
        Retry Connection
      </Button>

      <div className="w-full max-w-2xl space-y-6">
        {/* Group by runtime */}
        {["Docker", "Podman"].map((runtime) => {
          const runtimeOptions = options.filter((o) => o.runtime === runtime);
          if (runtimeOptions.length === 0) return null;

          return (
            <div key={runtime}>
              <div className="flex items-center gap-2 mb-3">
                <Ship className="size-4 text-muted-foreground" />
                <h3 className="font-semibold">{runtime}</h3>
                <Badge variant="outline" className="text-xs">
                  {osType}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {runtimeOptions.map((option) => (
                  <Card key={option.snippetId} className="relative">
                    <CardContent className="p-4">
                      <CardTitle className="text-sm mb-1">
                        {option.label}
                      </CardTitle>
                      <CardDescription className="text-xs mb-3">
                        {option.description}
                      </CardDescription>
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={installingId !== null}
                        onClick={() => handleInstall(option)}
                      >
                        {installingId === option.snippetId ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 size-4" />
                        )}
                        Install
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-xs text-muted-foreground text-center max-w-md">
        After installing, start the container service and click{" "}
        <strong>Retry Connection</strong> above, or XDeck will detect it
        automatically on the next status check.
      </p>
    </div>
  );
}
