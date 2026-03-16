import { useState } from "react";
import {
  Copy,
  Download,
  Edit,
  Ellipsis,
  FileArchive,
  Info,
  Move,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import type { FileAction } from "~/components/files/file-context-menu";
import { Button } from "~/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";

interface MobileSelectionBarProps {
  selectionCount: number;
  onAction: (action: FileAction) => void;
}

export function MobileSelectionBar({
  selectionCount,
  onAction,
}: MobileSelectionBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  if (selectionCount === 0) return null;

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="border-t bg-background px-2 py-2 safe-area-bottom"
        >
          <div className="flex items-center justify-around gap-1">
            <ActionButton
              icon={<Download className="size-5" />}
              label="Download"
              onClick={() => onAction("download")}
            />
            <ActionButton
              icon={<Move className="size-5" />}
              label="Move"
              onClick={() => onAction("move")}
            />
            <ActionButton
              icon={<Trash2 className="size-5" />}
              label="Delete"
              onClick={() => onAction("delete")}
              destructive
            />
            <ActionButton
              icon={<Ellipsis className="size-5" />}
              label="More"
              onClick={() => setMoreOpen(true)}
            />
          </div>
        </motion.div>
      </AnimatePresence>

      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {selectionCount} item{selectionCount !== 1 ? "s" : ""} selected
            </DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col gap-1 px-4 pb-6">
            <DrawerActionItem
              icon={<Edit className="size-5" />}
              label="Rename"
              description="Rename the selected item"
              disabled={selectionCount !== 1}
              onClick={() => {
                setMoreOpen(false);
                onAction("rename");
              }}
            />
            <DrawerActionItem
              icon={<Copy className="size-5" />}
              label="Copy to…"
              description="Copy to another location"
              onClick={() => {
                setMoreOpen(false);
                onAction("copy");
              }}
            />
            <DrawerActionItem
              icon={<FileArchive className="size-5" />}
              label="Compress"
              description="Create an archive"
              onClick={() => {
                setMoreOpen(false);
                onAction("compress");
              }}
            />
            <DrawerActionItem
              icon={<Info className="size-5" />}
              label="Properties"
              description="View file properties"
              disabled={selectionCount !== 1}
              onClick={() => {
                setMoreOpen(false);
                onAction("properties");
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

// ── Bottom bar action button ────────────────────────────────

function ActionButton({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      className={`flex h-auto flex-col items-center gap-0.5 px-3 py-1.5 text-xs ${
        destructive
          ? "text-destructive hover:text-destructive"
          : ""
      }`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

// ── Drawer action item ──────────────────────────────────────

function DrawerActionItem({
  icon,
  label,
  description,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
    </button>
  );
}
