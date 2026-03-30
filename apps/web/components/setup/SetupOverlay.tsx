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
  "storefront":
    "This is your Storefront — a customer-facing portal where your clients can access services, book appointments, view their account, and interact with your business online.\n\n" +
    "If your business serves customers directly, you can configure the storefront here. If not, you can skip this and come back if you need it later.\n\n" +
    "When enabled, the welcome page will show a Customer Portal login option alongside the Employee & Admin login.",
  "platform-development":
    "This is the Platform Development configuration. Here you decide how customisations made in Build Studio are handled after they're shipped.\n\n" +
    "You have three choices: keep everything private on your platform, share selectively when the AI suggests it, or contribute everything back to the community by default.\n\n" +
    "Pick whichever feels right — you can change this at any time from Admin > Platform Development.",
  "build-studio":
    "This is the Build Studio — one of the most powerful features of the platform.\n\n" +
    "If you need something the platform doesn't have out of the box, you can describe what you need and the AI workforce will help build it: new workflows, reports, integrations, custom pages — whatever your business requires.\n\n" +
    "Anything you build can be kept private or donated back to the community so other businesses benefit too.",
  "workspace":
    "This is your workspace — where you and your team do day-to-day work.\n\n" +
    "Before we wrap up, two important settings in the AI Coworker panel you should know about:\n\n" +
    "Hands Off / Hands On — By default, the AI is in \"Hands Off\" mode. It can read and analyze but won't make changes. Switch to \"Hands On\" when you want it to take action — create tasks, modify settings, propose code changes. You control when it acts.\n\n" +
    "External Access — By default, the AI can't reach the internet. Turn on External Access when you need it to search the web, fetch documentation, or pull in outside information. It stays off until you say so.\n\n" +
    "These are your guardrails. The AI Coworker is powerful, but it only does what you allow.\n\n" +
    "Try it now — switch to Hands On mode, then click the Skills menu and select \"Analyze this page.\" Watch what your AI coworker can do. Welcome aboard!",
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
  // Fires on step change AND pathname change — so the welcome re-appears
  // when the user navigates within a step (e.g., provider detail → back).
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
  }, [currentStep, pathname]);

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

  // Signal to the coworker panel that setup is active
  useEffect(() => {
    document.documentElement.setAttribute("data-setup-active", "true");
    document.documentElement.setAttribute("data-setup-last-step", isLastStep ? "true" : "false");
    return () => {
      document.documentElement.removeAttribute("data-setup-active");
      document.documentElement.removeAttribute("data-setup-last-step");
    };
  }, [isLastStep]);

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
