import type { SetupContext, SetupStep, StepStatus } from "../actions/setup-constants";
import { SETUP_STEPS } from "../actions/setup-constants";
import { prisma } from "@dpf/db";
import { MODEL_ROUTING_ENDPOINT_TYPES } from "@/lib/routing/provider-eligibility";

/**
 * Human-facing name of the local AI model the onboarding COO actually runs on.
 *
 * BI-0CED314D: this line used to hardcode "Ollama" (and elsewhere "Gemma") —
 * but Ollama is a model *runtime*, not a model, and a hardcoded family name
 * goes stale the moment the bundled local model changes (it now ships Qwen3).
 * Resolve it from the configured local provider so the COO never misstates it.
 * Returns null when no local model is configured (caller uses a generic phrase).
 */
/**
 * What the COO should say about cloud AI during setup (BI-575F0046 Slice 2).
 *
 * The three states are genuinely different actions, and the middle one used to
 * be invisible: a connected provider is cleared for `public` until its trust
 * evidence is reviewed, and no route is ever public, so it can serve nothing.
 * The old prompt asked "has cloud provider: yes/no", which called that state
 * "yes" and left the owner with a workforce silently running on the local model.
 *
 * The guidance is deliberately short. `Zero-Click Provider Setup` scores against
 * adding steps here (DI-5C13155815D2), so this points at one action and does not
 * turn onboarding into a form.
 */
export function describeCloudReadinessForSetup(
  readiness: "none" | "public-only" | "ready" | undefined,
): string {
  switch (readiness) {
    case "ready":
      return "connected and cleared for everyday work";
    case "public-only":
      return "connected, but not yet cleared for real work — the owner still needs to confirm "
        + "how that account handles their business data, which takes about a minute at "
        + "Platform > AI > Providers. Until then every coworker runs on the local model. "
        + "Offer to walk them through it; do not move on as if cloud AI were available";
    case "none":
      return "none connected — the local model handles everything, which is a valid choice";
    default:
      return "not known yet";
  }
}

export async function resolveLocalModelLabel(): Promise<string | null> {
  const local = await prisma.modelProvider.findFirst({
    where: { providerId: "local" },
    select: { families: true, enabledFamilies: true },
  });
  if (!local) return null;
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((f): f is string => typeof f === "string") : [];
  const enabled = asStrings(local.enabledFamilies);
  const families = asStrings(local.families);
  // Prefer a general conversational model — skip code-specialist and embedding
  // families so the COO names the model it actually converses with.
  const pool = (enabled.length ? enabled : families).filter(
    (f) => !/coder|embed/i.test(f),
  );
  const raw = pool[0] ?? enabled[0] ?? families[0];
  if (!raw) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function cooBasePrompt(localModelLine: string): string {
  return `You are the platform's Chief Operating Officer — the user's second-in-command.
You are guiding a new platform owner through initial setup.

This is a CONVERSATION request. You have no tools. Do not attempt to call functions, execute actions, or generate structured output.

IMPORTANT CONSTRAINTS:
${localModelLine}
- Do not attempt complex reasoning, multi-step analysis, or tool orchestration.
- Your job is guided conversation: explain, recommend, and acknowledge.
- If the user asks something beyond your capability, say so clearly and note that a cloud AI provider would handle it better.

TONE:
- Professional and understanding. Not cute, not robotic.
- Frame yourself as their operational partner, not a setup wizard.
- Use "we" when describing platform capabilities.
- Be direct about trade-offs — don't oversell.

AT EVERY STEP BOUNDARY, offer three options:
1. Continue to the next step
2. Skip this step for now
3. Pause and come back later`;
}

/**
 * Assemble the full COO system prompt for the onboarding agent,
 * injecting current setup state and provider pricing data.
 */
export async function buildOnboardingPrompt(
  currentStep: SetupStep,
  steps: Record<string, StepStatus>,
  context: SetupContext,
): Promise<string> {
  const completedSteps = SETUP_STEPS.filter((s) => steps[s] === "completed");
  const skippedSteps = SETUP_STEPS.filter((s) => steps[s] === "skipped");

  // Name the actual local model so the COO is honest about what it runs on
  // (BI-0CED314D), rather than a stale hardcoded "Ollama"/"Gemma".
  const localModel = await resolveLocalModelLabel();
  const localModelLine = localModel
    ? `- You are running on a small local AI model (${localModel}) on the user's own hardware. Be honest about this.`
    : `- You are running on a small local AI model on the user's own hardware. Be honest about this.`;

  // Load provider pricing for cost explanations
  let costSummary = "";
  if (currentStep === "ai-providers") {
    const providers = await prisma.modelProvider.findMany({
      where: { endpointType: { in: [...MODEL_ROUTING_ENDPOINT_TYPES] }, status: { not: "unconfigured" } },
      select: {
        providerId: true,
        name: true,
        inputPricePerMToken: true,
        outputPricePerMToken: true,
        costModel: true,
        userFacingDescription: true,
      },
    });
    if (providers.length > 0) {
      costSummary = providers
        .filter((p) => p.costModel === "token" && p.inputPricePerMToken)
        .map(
          (p) =>
            `${p.name}: ~$${((p.inputPricePerMToken! * 2000 + (p.outputPricePerMToken ?? 0) * 500) / 1_000_000).toFixed(4)} per typical conversation`,
        )
        .join("; ");
    }
  }

  return `${cooBasePrompt(localModelLine)}

CURRENT STATE:
- Step: ${currentStep}
- Completed: ${completedSteps.join(", ") || "none"}
- Skipped: ${skippedSteps.join(", ") || "none"}
- Industry: ${context.industry ?? "not set"}
- Cloud AI: ${describeCloudReadinessForSetup(context.cloudProviderReadiness)}
${costSummary ? `\nTYPICAL PROVIDER PRICING (quote as "typical pricing", not "your pricing"):\n${costSummary}` : ""}`;
}
