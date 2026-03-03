import * as React from "react";

import { useIsMobile } from "~/hooks/use-mobile";
import { cn } from "~/lib/utils";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/ui/drawer";

// ── Context ─────────────────────────────────────────────────────

const ResponsiveModalContext = React.createContext<{ isMobile: boolean }>({
  isMobile: false,
});

function useResponsiveModal() {
  return React.useContext(ResponsiveModalContext);
}

// ── Root ─────────────────────────────────────────────────────────

interface ResponsiveModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function ResponsiveModal({ children, ...props }: ResponsiveModalProps) {
  const isMobile = useIsMobile();

  return (
    <ResponsiveModalContext.Provider value={{ isMobile }}>
      {isMobile ? (
        <Drawer {...props}>{children}</Drawer>
      ) : (
        <Dialog {...props}>{children}</Dialog>
      )}
    </ResponsiveModalContext.Provider>
  );
}

// ── Trigger ──────────────────────────────────────────────────────

function ResponsiveModalTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogTrigger>) {
  const { isMobile } = useResponsiveModal();
  const Comp = isMobile ? DrawerTrigger : DialogTrigger;
  return (
    <Comp className={className} {...props}>
      {children}
    </Comp>
  );
}

// ── Close ────────────────────────────────────────────────────────

function ResponsiveModalClose({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogClose>) {
  const { isMobile } = useResponsiveModal();
  const Comp = isMobile ? DrawerClose : DialogClose;
  return (
    <Comp className={className} {...props}>
      {children}
    </Comp>
  );
}

// ── Content ──────────────────────────────────────────────────────

function ResponsiveModalContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const { isMobile } = useResponsiveModal();

  if (isMobile) {
    return (
      <DrawerContent
        className={cn(
          className,
          "max-h-[85vh] w-full max-w-none overflow-hidden sm:max-w-none"
        )}
        {...(props as React.ComponentProps<typeof DrawerContent>)}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </DrawerContent>
    );
  }

  return (
    <DialogContent className={className} {...props}>
      {children}
    </DialogContent>
  );
}

// ── Header ───────────────────────────────────────────────────────

function ResponsiveModalHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { isMobile } = useResponsiveModal();
  const Comp = isMobile ? DrawerHeader : DialogHeader;
  return <Comp className={className} {...props} />;
}

// ── Footer ───────────────────────────────────────────────────────

function ResponsiveModalFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  const { isMobile } = useResponsiveModal();

  if (isMobile) {
    return <DrawerFooter className={className} {...props} />;
  }

  return <DialogFooter className={className} {...props} />;
}

// ── Title ────────────────────────────────────────────────────────

function ResponsiveModalTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogTitle>) {
  const { isMobile } = useResponsiveModal();
  const Comp = isMobile ? DrawerTitle : DialogTitle;
  return <Comp className={className} {...props} />;
}

// ── Description ──────────────────────────────────────────────────

function ResponsiveModalDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogDescription>) {
  const { isMobile } = useResponsiveModal();
  const Comp = isMobile ? DrawerDescription : DialogDescription;
  return <Comp className={className} {...props} />;
}

// ── Exports ──────────────────────────────────────────────────────

export {
  ResponsiveModal,
  ResponsiveModalTrigger,
  ResponsiveModalClose,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
};
