"use client";

import { useEffect, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SetupProgressBar } from "./SetupProgressBar";
import {
  SETUP_STEPS,
  STEP_ROUTES,
  type SetupStep,
  type StepStatus,
} from "@/lib/actions/setup-constants";
import { advanceStep, skipStep, pauseSetup, completeSetup } from "@/lib/actions/setup-progress";

/**
 * Pre-written COO welcome messages for each setup step.
 * These appear directly in the coworker panel as assistant messages —
 * NO LLM call needed. The local model can't reliably generate useful
 * onboarding guidance, so we write it ourselves.
 */
const STEP_WELCOME: Record<string, string> = {
  "ai-providers":
    "Welcome to External Services. This is where you manage your AI providers — the engines that power the platform's intelligence.\n\n" +
    "Right now, Ollama is running locally on your machine. It handles basic conversation (like this), but for complex tasks like document analysis, code generation, or taking actions, you'll want to add a cloud provider.\n\n" +
    "To add one: click a provider like Anthropic or OpenAI, paste your API key, and click Test Connection. The platform will automatically use the best provider for each task.",
  "branding":
    "This is your branding page. Everything here controls how your platform looks — to your team and to your customers.\n\n" +
    "You can set your logo, colors, and tagline. Changes apply across the entire platform, including the storefront if you set one up.\n\n" +
    "Don't worry about getting it perfect now — you can always come back here from Admin > Branding.",
  "org-settings":
    "These are your organization settings — the basics about your business.\n\n" +
    "You can update your organization name, contact details, and location here. This information is used across the platform for things like compliance context and customer-facing materials.",
  "build-studio":
    "This is the Build Studio — one of the most powerful features of the platform.\n\n" +
    "If you need something the platform doesn't have out of the box, you can describe what you need and the AI workforce will help build it: new workflows, reports, integrations, custom pages — whatever your business requires.\n\n" +
    "Anything you build can be kept private or donated back to the community so other businesses benefit too.",
  "workspace":
    "This is your workspace — where you and your team do day-to-day work.\n\n" +
    "From here you can manage your backlog, talk to AI coworkers, and access all areas of the platform from the navigation above.\n\n" +
    "The AI Coworker panel (that's me) is always available — just click the button in the bottom right corner whenever you need help. Welcome aboard!",
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

  // Auto-open the coworker panel with a pre-written welcome for this step.
  // Uses welcomeMessage (not autoMessage) — no LLM call, just injects the
  // text directly as an assistant message. Small delay ensures the panel
  // component is mounted before the event fires.
  useEffect(() => {
    const welcome = STEP_WELCOME[currentStep];
    if (!welcome) return;
    const timer = setTimeout(() => {
      document.dispatchEvent(
        new CustomEvent("open-agent-panel", {
          detail: { welcomeMessage: welcome },
        }),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [currentStep]);

  const navigateToStep = (step: string, completed?: boolean) => {
    if (completed) {
      // Setup complete — hard navigate to workspace so overlay disappears
      window.location.href = "/workspace";
      return;
    }
    const nextRoute = STEP_ROUTES[step] ?? "/workspace";
    // Hard navigate to trigger full server re-render — router.push/refresh
    // doesn't reliably update the server-rendered overlay props across routes
    window.location.href = nextRoute;
  };

  const handleContinue = () => {
    startTransition(async () => {
      const updated = await advanceStep(progressId);
      navigateToStep(updated.currentStep, !!updated.completedAt);
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      const updated = await skipStep(progressId);
      navigateToStep(updated.currentStep, !!updated.completedAt);
    });
  };

  const handlePause = () => {
    startTransition(async () => {
      await pauseSetup(progressId);
      window.location.href = "/workspace";
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

  // Listen for setup action clicks from the coworker panel
  useEffect(() => {
    function handleSetupAction(e: Event) {
      const action = (e as CustomEvent<string>).detail;
      if (action === "continue") handleContinue();
      else if (action === "skip") handleSkip();
      else if (action === "pause") handlePause();
    }
    document.addEventListener("setup-action", handleSetupAction);
    return () => document.removeEventListener("setup-action", handleSetupAction);
  });

  return (
    <>
      {/* Top progress bar */}
      <SetupProgressBar
        currentStep={currentStep}
        steps={steps}
        onStepClick={handleStepClick}
      />
    </>
  );
}
