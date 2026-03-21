"use client";

import { useEffect, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SetupProgressBar } from "./SetupProgressBar";
import { SetupStepNav } from "./SetupStepNav";
import {
  SETUP_STEPS,
  STEP_ROUTES,
  type SetupStep,
  type StepStatus,
} from "@/lib/actions/setup-constants";
import { advanceStep, skipStep, pauseSetup, completeSetup } from "@/lib/actions/setup-progress";

/**
 * Step-specific greetings sent as auto-messages to the coworker panel.
 * These are sent FROM the user to the route's agent, prompting the agent
 * to provide onboarding context for that page.
 */
const STEP_GREETINGS: Record<string, string> = {
  "ai-providers":
    "I'm new here and setting up the platform for the first time. Can you help me understand what I'm looking at on this AI Providers page and what I should configure?",
  "branding":
    "I'm setting up the platform for the first time. Can you walk me through the branding options here?",
  "org-settings":
    "I'm going through initial setup. Can you explain what these organization settings are for and what I should fill in?",
  "workspace":
    "I just finished setting up the platform. Can you show me around the workspace and what I can do here?",
};

type Props = {
  progressId: string;
  currentStep: string;
  steps: Record<string, StepStatus>;
};

/**
 * Setup overlay — renders progress bar + navigation controls on top of
 * real portal pages during onboarding. The user is touring the actual
 * platform; this overlay tracks their progress and offers Continue/Skip/Pause.
 *
 * Auto-opens the coworker panel so the COO can provide guidance.
 */
export function SetupOverlay({ progressId, currentStep, steps }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Auto-open the coworker panel with an onboarding greeting for this step
  useEffect(() => {
    const greeting = STEP_GREETINGS[currentStep];
    document.dispatchEvent(
      new CustomEvent("open-agent-panel", {
        detail: greeting ? { autoMessage: greeting } : undefined,
      }),
    );
  }, [currentStep]);

  const handleContinue = () => {
    startTransition(async () => {
      const updated = await advanceStep(progressId);
      if (updated.completedAt) {
        // Setup complete — navigate to workspace, overlay will disappear
        router.push("/workspace");
        router.refresh();
        return;
      }
      const nextRoute = STEP_ROUTES[updated.currentStep] ?? "/workspace";
      router.push(nextRoute);
      router.refresh();
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      const updated = await skipStep(progressId);
      if (updated.completedAt) {
        router.push("/workspace");
        router.refresh();
        return;
      }
      const nextRoute = STEP_ROUTES[updated.currentStep] ?? "/workspace";
      router.push(nextRoute);
      router.refresh();
    });
  };

  const handlePause = () => {
    startTransition(async () => {
      await pauseSetup(progressId);
      router.refresh();
    });
  };

  const handleStepClick = (step: SetupStep) => {
    const route = STEP_ROUTES[step];
    if (route) {
      router.push(route);
    }
  };

  // Determine if current pathname matches the expected step route
  const expectedRoute = STEP_ROUTES[currentStep];
  const isOnExpectedPage = expectedRoute && pathname.startsWith(expectedRoute);

  // Check if this is the last step
  const currentIdx = SETUP_STEPS.indexOf(currentStep as SetupStep);
  const isLastStep = currentIdx === SETUP_STEPS.length - 1;

  return (
    <>
      {/* Top progress bar */}
      <SetupProgressBar
        currentStep={currentStep}
        steps={steps}
        onStepClick={handleStepClick}
      />

      {/* Bottom navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-40">
        <SetupStepNav
          onContinue={handleContinue}
          onSkip={handleSkip}
          onPause={handlePause}
          isLastStep={isLastStep}
          continueDisabled={isPending}
          continueLabel={isLastStep ? "Finish Setup" : undefined}
        />
      </div>
    </>
  );
}
