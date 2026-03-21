import { prisma } from "@dpf/db";
import { checkBundledProviders } from "./ollama";
import { isFirstRun, createSetupProgress } from "./actions/setup-progress";

/** Check if first-run bootstrap is needed. */
export async function checkBootstrapNeeded(): Promise<boolean> {
  return isFirstRun();
}

/** Seed the onboarding-coo agent definition. */
export async function seedOnboardingAgent(): Promise<void> {
  await prisma.agent.upsert({
    where: { agentId: "onboarding-coo" },
    create: {
      agentId: "onboarding-coo",
      name: "Onboarding COO",
      tier: 1,
      type: "onboarding",
      description: "Guides new platform owners through initial setup.",
      status: "active",
      preferredProviderId: "ollama",
    },
    update: {
      status: "active",
      preferredProviderId: "ollama",
    },
  });
}

export type BootstrapStatus =
  | { phase: "checking" }
  | { phase: "pulling_model"; progress: number; total: number; status: string }
  | { phase: "ready" }
  | { phase: "failed"; error: string };

/**
 * Execute the full first-run bootstrap sequence.
 *
 * 1. Run checkBundledProviders() to activate Ollama
 * 2. Verify Ollama is active
 * 3. Set sensitivity clearance on Ollama provider
 * 4. Seed the onboarding agent
 * 5. Create a PlatformSetupProgress record
 *
 * Returns the setup progress ID for redirect.
 */
export async function executeFirstRunBootstrap(
  onStatus?: (status: BootstrapStatus) => void,
): Promise<{ setupId: string } | { error: string }> {
  try {
    onStatus?.({ phase: "checking" });

    // 1. Activate Ollama via existing health check
    await checkBundledProviders();

    // 2. Check if Ollama is now active with models
    const ollamaProvider = await prisma.modelProvider.findFirst({
      where: { providerId: "ollama" },
    });

    if (!ollamaProvider || ollamaProvider.status !== "active") {
      return { error: "Ollama is not reachable. Please ensure it is running." };
    }

    // 3. Set sensitivity clearance
    await prisma.modelProvider.update({
      where: { providerId: "ollama" },
      data: {
        sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      },
    });

    // 4. Seed onboarding agent
    await seedOnboardingAgent();

    // 5. Create setup progress
    const progress = await createSetupProgress();

    onStatus?.({ phase: "ready" });
    return { setupId: progress.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onStatus?.({ phase: "failed", error: msg });
    return { error: msg };
  }
}
