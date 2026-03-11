import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { useDockerStore, type ContainerDetail } from "~/stores/docker-store";

interface ContainerDetailDialogProps {
  containerId: string | null;
  onClose: () => void;
}

export function ContainerDetailDialog({
  containerId,
  onClose,
}: ContainerDetailDialogProps) {
  const { inspectContainer } = useDockerStore();
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!containerId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    inspectContainer(containerId)
      .then(setDetail)
      .catch((err) => {
        console.error("Failed to inspect container:", err);
        setDetail(null);
      })
      .finally(() => setLoading(false));
  }, [containerId, inspectContainer]);

  return (
    <Dialog open={!!containerId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] w-full max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {detail ? detail.name : "Container Details"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading…</span>
          </div>
        ) : detail ? (
          <Tabs defaultValue="overview" className="w-full min-w-0">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="env">Environment</TabsTrigger>
              <TabsTrigger value="mounts">Mounts</TabsTrigger>
              <TabsTrigger value="networks">Networks</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 min-w-0">
              <ScrollArea className="h-[50vh] w-full">
                <div className="space-y-3 text-sm">
                  <Row label="ID" value={detail.id} mono />
                  <Row label="Image" value={detail.image} mono />
                  <Row label="State" value={detail.state} />
                  <Row label="Created" value={detail.created} />
                  {detail.restart_policy && (
                    <Row label="Restart Policy" value={detail.restart_policy} />
                  )}
                  {detail.cmd && (
                    <Row label="CMD" value={detail.cmd.join(" ")} mono />
                  )}
                  {detail.entrypoint && (
                    <Row
                      label="Entrypoint"
                      value={detail.entrypoint.join(" ")}
                      mono
                    />
                  )}
                  {detail.compose_project && (
                    <Row label="Compose Project" value={detail.compose_project} />
                  )}

                  {detail.ports.length > 0 && (
                    <div>
                      <span className="font-medium text-muted-foreground">Ports</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {detail.ports.map((p, i) => (
                          <Badge key={i} variant="outline" className="font-mono text-xs">
                            {p.host_port
                              ? `${p.host_ip || "0.0.0.0"}:${p.host_port}→${p.container_port}/${p.protocol}`
                              : `${p.container_port}/${p.protocol}`}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {Object.keys(detail.labels).length > 0 && (
                    <div>
                      <span className="font-medium text-muted-foreground">Labels</span>
                      <div className="mt-1 space-y-1">
                        {Object.entries(detail.labels).map(([k, v]) => (
                          <div key={k} className="flex text-xs">
                            <span className="font-mono text-muted-foreground shrink-0">
                              {k}:
                            </span>
                            <span className="ml-1 font-mono break-all">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="env" className="mt-4 min-w-0">
              <ScrollArea className="h-[50vh] w-full">
                {detail.env.length > 0 ? (
                  <div className="space-y-1">
                    {detail.env.map((e, i) => {
                      const eqIdx = e.indexOf("=");
                      const key = eqIdx >= 0 ? e.substring(0, eqIdx) : e;
                      const val = eqIdx >= 0 ? e.substring(eqIdx + 1) : "";
                      return (
                        <div key={i} className="flex text-xs font-mono py-0.5">
                          <span className="text-muted-foreground shrink-0">{key}=</span>
                          <span className="break-all">{val}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No environment variables.</p>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="mounts" className="mt-4 min-w-0">
              <ScrollArea className="h-[50vh] w-full">
                {detail.mounts.length > 0 ? (
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-normal">Source</TableHead>
                        <TableHead className="w-28 whitespace-normal">Destination</TableHead>
                        <TableHead className="w-20">Mode</TableHead>
                        <TableHead className="w-16">RW</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.mounts.map((m, i) => (
                        <TableRow key={i}>
                          <TableCell className="max-w-0 align-top whitespace-normal break-all font-mono text-xs">
                            {m.source}
                          </TableCell>
                          <TableCell className="max-w-0 align-top whitespace-normal break-all font-mono text-xs">
                            {m.destination}
                          </TableCell>
                          <TableCell className="align-top text-xs whitespace-normal break-all">
                            {m.mode || "—"}
                          </TableCell>
                          <TableCell className="align-top">
                            <Badge variant={m.rw ? "default" : "secondary"} className="text-xs">
                              {m.rw ? "RW" : "RO"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-sm">No mounts.</p>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="networks" className="mt-4 min-w-0">
              <ScrollArea className="h-[50vh] w-full">
                {Object.keys(detail.networks).length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Network</TableHead>
                        <TableHead>IP Address</TableHead>
                        <TableHead>Gateway</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(detail.networks).map(([name, net]) => (
                        <TableRow key={name}>
                          <TableCell className="font-medium">{name}</TableCell>
                          <TableCell className="font-mono text-sm">
                            {net.ip_address || "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {net.gateway || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-sm">No networks.</p>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-muted-foreground">Failed to load details.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="font-medium text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right break-all ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}
