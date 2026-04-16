"use client";

import { useEffect, useMemo, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SetupProgressBar } from "./SetupProgressBar";
import {
  SETUP_STEPS,
  STEP_ROUTES,
  type SetupStep,
  type StepStatus,
} from "@/lib/actions/setup-constants";
import { advanceStep, skipStep, pauseSetup, completeSetup } from "@/lib/actions/setup-progress";

/** Build a context-aware trigger prompt for the current setup step.
 * Sent as an autoMessage — triggers a real LLM call so the COO responds
 * with personalised guidance rather than pre-written text.
 *
 * NOTE: These are NOT system prompts and intentionally NOT DB-managed via
 * Admin > Prompts. They are user-facing conversation triggers — the equivalent
 * of "typing" a first message into the chat. The COO's persona, heuristics,
 * and behavior come from its DB-managed system prompt (editable in Admin >
 * Prompts under "Route Personas"). Customizing the COO's guidance during setup
 * is done by editing the onboarding-coo prompt, not these trigger strings.
 */
function buildStepTrigger(step: string, ctx: Record<string, string>): string {
  const org = ctx.orgName ? `Organisation: ${ctx.orgName}` : "Organisation: not yet entered";
  const archetype = ctx.suggestedArchetypeName ? `Business type: ${ctx.suggestedArchetypeName}` : "";
  const industry = ctx.industry || ctx.suggestedIndustry ? `Industry: ${ctx.industry || ctx.suggestedIndustry}` : "";
  const country = ctx.suggestedCountryCode ? `Country: ${ctx.suggestedCountryCode}` : "";
  const timezone = ctx.suggestedTimezone ? `Timezone: ${ctx.suggestedTimezone}` : "";

  const contextLine = [org, archetype, industry, country, timezone].filter(Boolean).join(" | ");

  const stepLabels: Record<string, string> = {
    "ai-providers": "AI Providers — configure inference engines",
    "branding": "Branding — logo, colours, tagline",
    "business-context": "Your Business — describe what you do and who you serve",
    "operating-hours": "Operating Hours — when your business is open, and in what timezone",
    "storefront": "Storefront — customer-facing portal",
    "platform-development": "Platform Development — contribution and governance mode",
    "build-studio": "Build Studio — custom feature development",
    "workspace": "Workspace — day-to-day operations and guardrails",
  };

  const label = stepLabels[step] ?? step;

  // Build Studio is a preview-only step during setup — the user will come back
  // to actually build features after the wizard completes.
  if (step === "build-studio") {
    return `[Setup step: ${label}]\n${contextLine}\n\nThis is a preview step. Introduce Build Studio briefly — explain what it does (self-development: the platform can build new features for itself) and that the user will return here after setup is complete to create their first feature. Do NOT ask the user to build anything now. Keep it to 2-3 sentences.`;
  }

  // Workspace is the final step — welcome the user and orient them, but do NOT
  // create epics, backlog items, or start building anything.
  if (step === "workspace") {
    return `[Setup step: ${label}]\n${contextLine}\n\nThis is the final setup step. Welcome the user to their workspace. Briefly explain that this is where they will manage day-to-day operations — viewing their backlog, talking to coworkers, and monitoring work. Congratulate them on completing setup. Do NOT create any epics, backlog items, or guardrails. Do NOT start building or decomposing anything. Keep it to 2-3 sentences.`;
  }

  return `[Setup step: ${label}]\n${contextLine}\n\nGuide me through this step.`;
}

type Props = {
  progressId: string;
  currentStep: string;
  steps: Record<string, StepStatus>;
  setupContext: Record<string, string>;
};

/**
 * Setup overlay — renders progress bar + navigation controls on top of
 * real portal pages during onboarding. The user is touring the actual
 * platform; this overlay tracks their progress and offers Continue/Skip/Pause.
 *
 * Auto-opens the coworker panel so the COO can provide guidance.
 */
export function SetupOverlay({ progressId, currentStep, steps, setupContext }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Auto-open the coworker panel and trigger a live COO response for this step.
  // Uses autoMessage so the LLM generates personalised guidance from the setup
  // context rather than displaying a pre-written string.
  //
  // Stabilise the trigger: setupContext is a new object reference on every
  // server render (layout re-renders when a provider is saved), but the *content*
  // rarely changes during a single setup step.  Derive a stable trigger string
  // and only fire the effect when the trigger text actually changes.
  const trigger = useMemo(
    () => buildStepTrigger(currentStep, setupContext),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentStep, JSON.stringify(setupContext)],
  );
  const lastFiredTrigger = useRef<string | null>(null);

  useEffect(() => {
    if (!trigger) return;
    // Don't re-fire the same trigger (e.g. after a provider save that
    // re-renders the layout but doesn't change the setup step or context).
    if (lastFiredTrigger.current === trigger) return;
    lastFiredTrigger.current = trigger;

    const timer = setTimeout(() => {
      document.dispatchEvent(
        new CustomEvent("open-agent-panel", {
          detail: { autoMessage: trigger },
        }),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [trigger]);

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
