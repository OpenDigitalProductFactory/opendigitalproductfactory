import { prisma } from "@dpf/db";
import { checkBundledProviders, getOllamaHardwareInfo } from "./ollama";
import { getOllamaBaseUrl } from "./ollama-url";
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

/**
 * Select the best model to auto-pull based on available VRAM.
 * Leaves 30%+ VRAM headroom per project convention.
 *
 * Tiers (Q4 quantization, ~0.5-0.7 GB per billion params):
 *   - 8GB+ VRAM  → llama3.1:8b   (needs ~5GB, leaves ~3GB headroom)
 *   - 4-8GB VRAM → phi3:mini     (needs ~2.3GB, leaves headroom)
 *   - <4GB / CPU  → tinyllama    (needs ~0.6GB, runs on anything)
 */
async function selectModelForHardware(baseUrl: string): Promise<string> {
  try {
    const hwInfo = await getOllamaHardwareInfo(baseUrl);
    const vram = hwInfo?.vramGb;

    if (vram == null || vram < 4) {
      // CPU-only or very low VRAM — smallest viable model
      return "tinyllama";
    }
    if (vram < 8) {
      // Mid-range — small but capable
      return "phi3:mini";
    }
    // 8GB+ — standard recommendation
    return "llama3.1:8b";
  } catch {
    // Can't detect hardware — use safe default
    return "llama3.1:8b";
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
          where: { providerId: "ollama" },
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
