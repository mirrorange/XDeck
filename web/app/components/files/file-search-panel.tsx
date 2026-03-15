import { useCallback, useState } from "react";
import { Loader2, Search, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Switch } from "~/components/ui/switch";
import { Label } from "~/components/ui/label";
import { FileIcon } from "~/components/files/file-icon";
import { formatFileSize, truncateMiddleFilename } from "~/lib/file-utils";
import { getRpcClient } from "~/lib/rpc-client";
import { cn } from "~/lib/utils";
import type { FileEntry } from "~/stores/file-store";

interface FileSearchPanelProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onClose: () => void;
  className?: string;
}

export function FileSearchPanel({ currentPath, onNavigate, onClose, className }: FileSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [results, setResults] = useState<FileEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setIsSearching(true);
    setSearched(true);

    try {
      const rpc = getRpcClient();
      const result = (await rpc.call("fs.search", {
        path: currentPath,
        pattern: trimmed,
        recursive,
        max_results: 200,
      })) as { results: FileEntry[]; total: number };
      setResults(result.results);
    } catch (err) {
      console.error("Search failed:", err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [query, currentPath, recursive]);

  const handleClick = (entry: FileEntry) => {
    if (entry.type === "directory") {
      onNavigate(entry.path);
    } else {
      // Navigate to parent directory
      const parent = entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";
      onNavigate(parent);
    }
    onClose();
  };

  return (
    <div className={cn("flex h-full flex-col bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Search className="size-4" />
          <span className="text-sm font-medium">Search</span>
        </div>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* Search input */}
      <div className="space-y-2 border-b p-3">
        <div className="flex gap-1.5">
          <Input
            className="h-9 text-sm"
            placeholder="Search files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSearch();
            }}
            autoFocus
          />
          <Button
            size="sm"
            className="h-9 px-3"
            onClick={() => void handleSearch()}
            disabled={!query.trim() || isSearching}
          >
            {isSearching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="recursive"
            checked={recursive}
            onCheckedChange={setRecursive}
            className="h-4 w-8"
          />
          <Label htmlFor="recursive" className="text-xs text-muted-foreground">
            Search subdirectories
          </Label>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          In: {currentPath}
        </p>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1">
        {isSearching ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : searched && results.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No results found
          </div>
        ) : (
          <div className="p-1">
            {results.map((entry) => (
              <button
                key={entry.path}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => handleClick(entry)}
              >
                <FileIcon
                  type={entry.type}
                  name={entry.name}
                  className="size-4 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="truncate" title={entry.name}>
                    {truncateMiddleFilename(entry.name, 32)}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {entry.path}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {entry.type === "directory"
                    ? "Folder"
                    : formatFileSize(entry.size)}
                </span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {searched && results.length > 0 && (
        <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
          {results.length} result{results.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
