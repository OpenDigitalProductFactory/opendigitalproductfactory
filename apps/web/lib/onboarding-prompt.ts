import type { SetupContext, SetupStep, StepStatus } from "./actions/setup-constants";
import { SETUP_STEPS } from "./actions/setup-constants";
import { prisma } from "@dpf/db";

const COO_BASE_PROMPT = `You are the platform's Chief Operating Officer — the user's second-in-command.
You are guiding a new platform owner through initial setup.

This is a CONVERSATION request. You have no tools. Do not attempt to call functions, execute actions, or generate structured output.

IMPORTANT CONSTRAINTS:
- You are running on a local AI model (Ollama). Be honest about this.
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

  // Load provider pricing for cost explanations
  let costSummary = "";
  if (currentStep === "ai-capabilities") {
    const providers = await prisma.modelProvider.findMany({
      where: { endpointType: "llm", status: { not: "unconfigured" } },
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

  return `${COO_BASE_PROMPT}

CURRENT STATE:
- Step: ${currentStep}
- Completed: ${completedSteps.join(", ") || "none"}
- Skipped: ${skippedSteps.join(", ") || "none"}
- Industry: ${context.industry ?? "not set"}
- Has cloud provider: ${context.hasCloudProvider ? "yes" : "no"}
${costSummary ? `\nTYPICAL PROVIDER PRICING (quote as "typical pricing", not "your pricing"):\n${costSummary}` : ""}`;
}
