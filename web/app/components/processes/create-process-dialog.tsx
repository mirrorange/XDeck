import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
} from "~/components/responsive-modal";
import { useProcessStore } from "~/stores/process-store";
import { useSystemStore } from "~/stores/system-store";

import {
  buildCreateRequest,
  defaultForm,
  type ProcessFormState,
  validateProcessFormStep,
  wizardSteps,
} from "./process-form-state";
import {
  ProcessFormSections,
  StepIndicator,
  WizardFooter,
} from "./process-form-wizard";

export function CreateProcessDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const { createProcess, groups } = useProcessStore();
  const { daemonInfo } = useSystemStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ProcessFormState>({ ...defaultForm });

  const isWindows = daemonInfo?.os_type === "windows";

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

  const nextStep = () => {
    const validationError = validateProcessFormStep(form, step);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setStep((prev) => Math.min(prev + 1, wizardSteps.length - 1));
  };

  const prevStep = () => {
    setError(null);
    setStep((prev) => Math.max(prev - 1, 0));
  };

  const resetDialog = () => {
    setForm({ ...defaultForm });
    setStep(0);
    setError(null);
  };

  const handleSubmit = async () => {
    for (let i = 0; i < wizardSteps.length; i += 1) {
      const validationError = validateProcessFormStep(form, i);
      if (validationError) {
        setError(validationError);
        setStep(i);
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createProcess(buildCreateRequest(form, isWindows));
      setOpen(false);
      resetDialog();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create process");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetDialog();
        }
      }}
    >
      <ResponsiveModalTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          New Process
        </Button>
      </ResponsiveModalTrigger>
      <ResponsiveModalContent className="md:max-w-xl">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Create New Process</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Follow the steps to configure your process.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="px-4 md:px-0">
          <StepIndicator steps={wizardSteps} current={step} />
          <div className="min-h-[250px]">
            <ProcessFormSections
              form={form}
              step={step}
              isWindows={isWindows}
              idPrefix="create-proc"
              existingGroups={groups}
              updateForm={updateForm}
              addEnvVar={addEnvVar}
              removeEnvVar={removeEnvVar}
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <WizardFooter
          step={step}
          isSubmitting={isSubmitting}
          submitLabel="Create Process"
          onBack={prevStep}
          onNext={nextStep}
          onSubmit={handleSubmit}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
