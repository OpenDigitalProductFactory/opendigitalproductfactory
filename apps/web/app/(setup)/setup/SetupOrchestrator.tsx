"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SetupProgressBar } from "@/components/setup/SetupProgressBar";
import { type SetupStep, type StepStatus } from "@/lib/actions/setup-constants";
import { advanceStep, skipStep, pauseSetup } from "@/lib/actions/setup-progress";
import { BusinessIdentityStep } from "./steps/business-identity";
import { OwnerAccountStep } from "./steps/owner-account";
import { AiCapabilitiesStep } from "./steps/ai-capabilities";
import { BrandingStep } from "./steps/branding";
import { FinancialBasicsStep } from "./steps/financial-basics";
import { FirstWorkspaceStep } from "./steps/first-workspace";
import { ExtensibilityPreviewStep } from "./steps/extensibility-preview";
import { WhatsNextStep } from "./steps/whats-next";

type Props = {
  progress: {
    id: string;
    currentStep: string;
    steps: Record<string, StepStatus>;
    context: Record<string, unknown>;
  };
};

export function SetupOrchestrator({ progress: initialProgress }: Props) {
  const [progress, setProgress] = useState(initialProgress);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleContinue = (contextUpdate?: Record<string, unknown>) => {
    startTransition(async () => {
      const updated = await advanceStep(progress.id, contextUpdate);
      if (updated.completedAt) {
        router.push("/workspace");
      } else {
        setProgress({
          id: updated.id,
          currentStep: updated.currentStep,
          steps: updated.steps as Record<string, StepStatus>,
          context: updated.context as Record<string, unknown>,
        });
      }
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      const updated = await skipStep(progress.id);
      if (updated.completedAt) {
        router.push("/workspace");
      } else {
        setProgress({
          id: updated.id,
          currentStep: updated.currentStep,
          steps: updated.steps as Record<string, StepStatus>,
          context: updated.context as Record<string, unknown>,
        });
      }
    });
  };

  const handlePause = () => {
    startTransition(async () => {
      await pauseSetup(progress.id);
      router.push("/");
    });
  };

  const handleStepClick = (step: SetupStep) => {
    setProgress((prev) => ({ ...prev, currentStep: step }));
  };

  function renderStep() {
    switch (progress.currentStep) {
      case "business-identity":
        return (
          <BusinessIdentityStep
            onContinue={handleContinue}
            onSkip={handleSkip}
            onPause={handlePause}
          />
        );
      case "owner-account":
        return (
          <OwnerAccountStep
            onContinue={handleContinue}
            onSkip={handleSkip}
            onPause={handlePause}
          />
        );
      case "ai-capabilities":
        return (
          <AiCapabilitiesStep
            onContinue={handleContinue}
            onSkip={handleSkip}
            onPause={handlePause}
            context={progress.context}
          />
        );
      case "branding":
        return (
          <BrandingStep
            onContinue={handleContinue}
            onSkip={handleSkip}
            onPause={handlePause}
          />
        );
      case "financial-basics":
        return (
          <FinancialBasicsStep
            onContinue={handleContinue}
            onSkip={handleSkip}
            onPause={handlePause}
            context={progress.context}
          />
        );
      case "first-workspace":
        return (
          <FirstWorkspaceStep
            onContinue={handleContinue}
            onSkip={handleSkip}
            onPause={handlePause}
            context={progress.context}
          />
        );
      case "extensibility-preview":
        return (
          <ExtensibilityPreviewStep
            onContinue={handleContinue}
            onSkip={handleSkip}
            onPause={handlePause}
          />
        );
      case "whats-next":
        return (
          <WhatsNextStep
            onContinue={handleContinue}
            onSkip={handleSkip}
            onPause={handlePause}
            context={progress.context}
            steps={progress.steps}
          />
        );
      default:
        return (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-lg">Step: {progress.currentStep}</p>
              <p className="text-sm mt-2">(Coming soon)</p>
              <div className="mt-4 flex gap-3 justify-center">
                <button
                  onClick={handleSkip}
                  disabled={isPending}
                  className="px-4 py-2 text-sm text-gray-600 border rounded hover:bg-gray-50"
                >
                  Skip
                </button>
                <button
                  onClick={() => handleContinue()}
                  disabled={isPending}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        );
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SetupProgressBar
        currentStep={progress.currentStep}
        steps={progress.steps}
        onStepClick={handleStepClick}
      />
      {renderStep()}
    </div>
  );
}
