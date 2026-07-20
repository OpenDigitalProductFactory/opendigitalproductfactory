"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SetupProgressBar } from "./SetupProgressBar";
import {
  SETUP_STEPS,
  STEP_ROUTES,
  type SetupStep,
  type StepStatus,
} from "@/lib/actions/setup-constants";
import { advanceStep, skipStep, pauseSetup, completeSetup, markStepTriggered } from "@/lib/actions/setup-progress";
import { CooNameSetupCard } from "./CooNameSetupCard";

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
export function buildStepTrigger(step: string, ctx: Record<string, string>): string {
  const org = ctx.orgName ? `Organisation: ${ctx.orgName}` : "Organisation: not yet entered";
  const archetype = ctx.suggestedArchetypeName ? `Business type: ${ctx.suggestedArchetypeName}` : "";
  const industry = ctx.industry || ctx.suggestedIndustry ? `Industry: ${ctx.industry || ctx.suggestedIndustry}` : "";
  const country = ctx.suggestedCountryCode ? `Country: ${ctx.suggestedCountryCode}` : "";
  const timezone = ctx.suggestedTimezone ? `Timezone: ${ctx.suggestedTimezone}` : "";

  const contextLine = [org, archetype, industry, country, timezone].filter(Boolean).join(" | ");

  const stepLabels: Record<string, string> = {
    "ai-providers": "AI Providers — choose a business-safe connection",
    "branding": "Branding — logo, colours, tagline",
    "business-context": "Your Business — describe what you do and who you serve",
    "operating-hours": "Operating Hours — when your business is open, and in what timezone",
    "storefront": "Storefront — customer-facing portal",
    "platform-development": "Platform Development — contribution and governance mode",
    "build-studio": "Build Studio — custom feature development",
    "meet-your-coo": "Meet your AI COO — optionally choose how they are addressed",
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
    const cooName = ctx.cooConversationalName && ctx.cooConversationalName !== "COO"
      ? `${ctx.cooConversationalName} · AI COO`
      : "COO";
    return `[Setup step: ${label}]\n${contextLine}\n\nThis is the final setup step. Welcome the user to their workspace and introduce their standing coworker as ${cooName}. Make clear that the conversational name does not change the coworker's AI identity, permissions, authority, or the owner's accountability. Briefly explain that this is where they will manage day-to-day operations — viewing their backlog, talking to coworkers, and monitoring work. Congratulate them on completing setup. Do NOT create any epics, backlog items, or guardrails. Do NOT start building or decomposing anything. Keep it to 2-3 sentences.`;
  }

  if (step === "meet-your-coo") {
    return `[Setup step: ${label}]\n${contextLine}\n\nExplain in plain language that the Onboarding COO guiding setup is distinct from the standing AI COO that will have the owner's back after setup. The owner may keep the title COO or choose an optional conversational name. The name is organization-visible presentation only and cannot change identity, permissions, authority, accountability, or audit records. Invite them to use the naming card; keep it to 2-3 sentences.`;
  }

  if (step === "ai-providers") {
    return `[Setup step: ${label}]\n${contextLine}\n\nAct as my COO and help me choose a provider connection without sending company or customer data to any cloud service. Explain in plain language that a working login does not prove a business account, contract, retention, training, or regional-processing terms. Use the company context already collected, consult AGT-902 through the governed coworker interface for regulatory and sovereignty questions, show references for factual claims, and say what remains unknown. Give one safest next action. If the local model cannot support a reliable answer, use deterministic corpus guidance or recommend review; do not guess.`;
  }

  return `[Setup step: ${label}]\n${contextLine}\n\nGuide me through this step.`;
}

type Props = {
  progressId: string;
  currentStep: string;
  steps: Record<string, StepStatus>;
  setupContext: Record<string, string>;
  triggeredSteps: string[];
};

/**
 * Setup overlay — renders progress bar + navigation controls on top of
 * real portal pages during onboarding. The user is touring the actual
 * platform; this overlay tracks their progress and offers Continue/Skip/Pause.
 *
 * Auto-opens the coworker panel so the COO can provide guidance.
 */
export function SetupOverlay({ progressId, currentStep, steps, setupContext, triggeredSteps }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);

  // Auto-open the coworker panel and trigger a live COO response for this step.
  // Uses autoMessage so the LLM generates personalised guidance from the setup
  // context rather than displaying a pre-written string.
  //
  // Fire-once-per-step is enforced via the DB: triggeredSteps on the progress
  // record. A component-local ref isn't enough because SetupOverlay remounts
  // on full reloads (navigateToStep uses window.location.href) and in React
  // Strict Mode, which would re-fire the welcome every time.
  const trigger = useMemo(
    () => buildStepTrigger(currentStep, setupContext),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentStep, JSON.stringify(setupContext)],
  );
  const alreadyFired = triggeredSteps.includes(currentStep);

  useEffect(() => {
    if (!trigger || alreadyFired) return;

    const timer = setTimeout(() => {
      document.dispatchEvent(
        new CustomEvent("open-agent-panel", {
          // Setup guidance always belongs to the distinct Onboarding COO and
          // its own thread, even though the tour renders on real portal routes.
          detail: { autoMessage: trigger, routeContext: "/setup" },
        }),
      );
      void markStepTriggered(progressId, currentStep);
    }, 300);
    return () => clearTimeout(timer);
  }, [trigger, alreadyFired, progressId, currentStep]);

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

  const handleContinue = (contextUpdate?: Record<string, string>) => {
    startTransition(async () => {
      const updated = await advanceStep(progressId, contextUpdate);
      if ("blocked" in updated && updated.blocked === "storefront-required") {
        // The storefront hasn't been created yet — keep the operator on the
        // storefront setup so they finish the wizard before moving on.
        setBlockedMsg(
          "Finish creating your storefront below before continuing — it hasn't been set up yet.",
        );
        const route = STEP_ROUTES["storefront"] ?? "/storefront";
        if (!pathname.startsWith(route)) router.push(route);
        return;
      }
      setBlockedMsg(null);
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
      const detail = (e as CustomEvent<string | { action: string; contextUpdate?: Record<string, string> }>).detail;
      const action = typeof detail === "string" ? detail : detail.action;
      if (action === "continue") handleContinue(typeof detail === "string" ? undefined : detail.contextUpdate);
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
      {currentStep === "meet-your-coo" && (
        <CooNameSetupCard
          progressId={progressId}
          initialName={setupContext.cooConversationalName ?? null}
          disabled={isPending}
        />
      )}
      {blockedMsg && (
        <div
          role="alert"
          style={{
            position: "fixed",
            top: 56,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            maxWidth: 520,
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-2)",
            color: "var(--dpf-text)",
            fontSize: 13,
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          }}
        >
          {blockedMsg}
        </div>
      )}
    </>
  );
}
