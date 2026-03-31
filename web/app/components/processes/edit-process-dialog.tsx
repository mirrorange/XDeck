import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "~/components/responsive-modal";
import {
  type ProcessInfo,
  type UpdateProcessRequest,
  useProcessStore,
} from "~/stores/process-store";
import { useSystemStore } from "~/stores/system-store";

import {
  buildEditRequestDiff,
  defaultForm,
  type FormTab,
  formTabs,
  type ProcessFormState,
  toFormState,
  validateProcessFormStep,
} from "./process-form-state";
import {
  ProcessFormTabs,
  TabFormFooter,
} from "./process-form-wizard";

export function EditProcessDialog({
  process,
  open,
  onOpenChange,
  onUpdated,
}: {
  process: ProcessInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const { updateProcess, groups } = useProcessStore();
  const { daemonInfo } = useSystemStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FormTab>("General");
  const [form, setForm] = useState<ProcessFormState>({ ...defaultForm });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ req: UpdateProcessRequest; willRestart: boolean } | null>(
    null
  );

  const isWindows = daemonInfo?.os_type === "windows";

  useEffect(() => {
    if (!open || !process) return;

    setForm(toFormState(process));
    setActiveTab("General");
    setError(null);
    setIsSubmitting(false);
    setConfirmOpen(false);
    setPendingUpdate(null);
  }, [open, process?.id]);

  const updateForm = (field: keyof ProcessFormState, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const addEnvVar = () => {
    setForm((prev) => ({
      ...prev,
      envKeys: [...prev.envKeys, ""],
      envValues: [...prev.envValues, ""],
    }));
  };

  const removeEnvVar = (index: number) => {
    setForm((prev) => ({
      ...prev,
      envKeys: prev.envKeys.filter((_, i) => i !== index),
      envValues: prev.envValues.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = () => {
    if (!process) return;

    for (let i = 0; i < formTabs.length; i += 1) {
      const validationError = validateProcessFormStep(form, i);
      if (validationError) {
        setError(validationError);
        setActiveTab(formTabs[i]);
        return;
      }
    }

    const diff = buildEditRequestDiff(process, form, isWindows);
    if (!diff.hasChanges) {
      onOpenChange(false);
      return;
    }

    setPendingUpdate({ req: diff.req, willRestart: diff.willRestart });
    setConfirmOpen(true);
  };

  const confirmAndSubmit = async () => {
    if (!pendingUpdate) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await updateProcess(pendingUpdate.req);
      setConfirmOpen(false);
      setPendingUpdate(null);
      onOpenChange(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update process");
      setConfirmOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmTitle = pendingUpdate?.willRestart ? "Save Changes and Restart?" : "Save Changes?";
  const confirmDescription = pendingUpdate?.willRestart
    ? "This process is running and launch parameters changed. Save changes and restart the process now?"
    : "Save these configuration changes now?";
  const confirmActionText = pendingUpdate?.willRestart ? "Save and Restart" : "Save Changes";

  return (
    <>
      <ResponsiveModal
        open={open}
        onOpenChange={(nextOpen) => {
          if (isSubmitting) return;
          if (!nextOpen) {
            setConfirmOpen(false);
            setPendingUpdate(null);
          }
          onOpenChange(nextOpen);
        }}
      >
        <ResponsiveModalContent className="md:max-w-xl">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Edit Process</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Update process configuration. Only changed fields will be saved.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          <div className="px-4 md:px-0">
            <div className="min-h-[300px]">
              <ProcessFormTabs
                form={form}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                isWindows={isWindows}
                idPrefix="edit-proc"
                existingGroups={groups}
                updateForm={updateForm}
                addEnvVar={addEnvVar}
                removeEnvVar={removeEnvVar}
              />
            </div>

            {error && (
              <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <TabFormFooter
            isSubmitting={isSubmitting}
            submitLabel="Save Changes"
            onSubmit={handleSubmit}
          />
        </ResponsiveModalContent>
      </ResponsiveModal>

      <Dialog
        open={confirmOpen}
        onOpenChange={(nextOpen) => {
          if (isSubmitting) return;
          setConfirmOpen(nextOpen);
          if (!nextOpen) {
            setPendingUpdate(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                setPendingUpdate(null);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="button" onClick={confirmAndSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {confirmActionText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
