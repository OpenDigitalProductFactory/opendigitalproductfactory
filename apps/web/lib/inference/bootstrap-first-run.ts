import { prisma } from "@dpf/db";
import { checkBundledProviders, getOllamaHardwareInfo } from "./ollama";
import { getOllamaBaseUrl } from "./ollama-url";
import { isFirstRun, createSetupProgress } from "../actions/setup-progress";

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
    },
    update: {
      status: "active",
    },
  });

  // EP-AI-WORKFORCE-001: Provider pinning via AgentModelConfig (replaces Agent.preferredProviderId)
  await prisma.agentModelConfig.upsert({
    where: { agentId: "onboarding-coo" },
    create: {
      agentId: "onboarding-coo",
      minimumTier: "basic",
      budgetClass: "minimize_cost",
      pinnedProviderId: "local",
    },
    update: {
      pinnedProviderId: "local",
    },
  });
}

/**
 * Gemma 4 model tiers ordered largest-first.
 * Each entry specifies the Docker Model Runner tag and the minimum VRAM
 * required to run it at Q4 quantization with ~30% headroom.
 *
 * Sizing estimates (Q4_K_M quantization, ~0.55 GB per billion params):
 *   - ai/gemma4  (31B dense)     → ~18 GB VRAM → needs 24 GB+ GPU
 *   - ai/gemma3  (12B)           → ~7 GB  VRAM → needs 10 GB+ GPU
 *   - ai/gemma3  (4B tag)        → ~2.5 GB     → needs 4 GB+ GPU
 *   - tinyllama  (1.1B fallback) → ~0.6 GB     → runs on anything
 */
const MODEL_TIERS: { model: string; minVramGb: number }[] = [
  { model: "ai/gemma4",   minVramGb: 20 },  // 31B — RTX 4090 / A6000+
  { model: "ai/gemma3",   minVramGb: 8 },   // 12B default — RTX 3060+
  { model: "ai/gemma3",   minVramGb: 4 },   // 4B variant — budget GPUs
  { model: "tinyllama",   minVramGb: 0 },   // CPU-only fallback
];

/**
 * Select the largest Gemma model that fits available VRAM.
 * Walks the tier list top-down and picks the first model whose
 * minimum VRAM requirement is satisfied by the detected hardware.
 */
async function selectModelForHardware(baseUrl: string): Promise<string> {
  try {
    const hwInfo = await getOllamaHardwareInfo(baseUrl);
    const vram = hwInfo?.vramGb ?? 0;

    for (const tier of MODEL_TIERS) {
      if (vram >= tier.minVramGb) {
        return tier.model;
      }
    }
    // Should never reach here (last tier has minVramGb=0), but be safe
    return "tinyllama";
  } catch {
    // Can't detect hardware — use mid-range default
    return "ai/gemma3";
  }
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

    // 1. Try to activate Ollama — but don't block setup if it's unavailable
    try {
      const baseUrl = getOllamaBaseUrl();

      // Check if Ollama is reachable
      const pingRes = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (pingRes.ok) {
        const tagsData = await pingRes.json() as { models?: Array<{ name: string }> };
        const pulledModels = (tagsData.models ?? []).filter(
          (m) => !m.name.includes("embed"),
        );

        // If no chat models are pulled, auto-pull one based on hardware
        if (pulledModels.length === 0) {
          const modelToPull = await selectModelForHardware(baseUrl);
          console.log(`[bootstrap] No chat models found — pulling ${modelToPull}`);
          onStatus?.({ phase: "pulling_model", progress: 0, total: 1, status: `Pulling ${modelToPull}...` });

          const pullRes = await fetch(`${baseUrl}/api/pull`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: modelToPull, stream: false }),
            signal: AbortSignal.timeout(15 * 60 * 1000), // 15 min timeout
          });

          if (!pullRes.ok) {
            console.warn(`[bootstrap] Model pull failed: ${await pullRes.text()}`);
          } else {
            console.log(`[bootstrap] Successfully pulled ${modelToPull}`);
          }
        }

        // Now run the standard bundled provider check (discover + profile)
        await checkBundledProviders();

        // Set sensitivity clearance for local provider
        await prisma.modelProvider.update({
          where: { providerId: "local" },
          data: {
            sensitivityClearance: ["public", "internal", "confidential", "restricted"],
          },
        });
      } else {
        console.warn("[bootstrap] Ollama not reachable — proceeding without local AI");
      }
    } catch {
      // Ollama not available — that's fine, user can configure providers at Step 3
      console.warn("[bootstrap] Ollama not reachable — proceeding without local AI");
    }

    // 2. Seed onboarding agent (always — even without Ollama)
    await seedOnboardingAgent();

    // 3. Create setup progress (always — this is what lets the user proceed)
    const progress = await createSetupProgress();

    onStatus?.({ phase: "ready" });
    return { setupId: progress.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onStatus?.({ phase: "failed", error: msg });
    return { error: msg };
  }
}
