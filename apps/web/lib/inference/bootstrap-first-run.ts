import { prisma } from "@dpf/db";
import { checkBundledProviders, getOllamaHardwareInfo } from "./ollama";
import { getOllamaBaseUrl } from "./ollama-url";
import { isFirstRun, createSetupProgress } from "../actions/setup-progress";
import { activateProvider } from "@/lib/govern/activate-provider";
import { syncAgentPrincipal } from "@/lib/identity/principal-linking";

/** Check if first-run bootstrap is needed. */
export async function checkBootstrapNeeded(): Promise<boolean> {
  return isFirstRun();
}

/** Seed the onboarding-coo agent definition. */
export async function seedOnboardingAgent(): Promise<void> {
  const agent = await prisma.agent.upsert({
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

  // Grants for the setup wizard tools the onboarding COO calls:
  //   analyze_brand_document, analyze_public_website_branding → file_read, web_search
  //   prefill_onboarding_wizard → data_governance_validate
  //   list_products / read references → registry_read, backlog_read, portfolio_read
  // Without grants, every tool call is silently denied — the COO then claims
  // success on operations that never happened.
  const grants = [
    "file_read",
    "web_search",
    "data_governance_validate",
    "registry_read",
    "backlog_read",
    "portfolio_read",
  ];
  for (const grantKey of grants) {
    await prisma.agentToolGrant.upsert({
      where: { agentId_grantKey: { agentId: agent.id, grantKey } },
      update: {},
      create: { agentId: agent.id, grantKey },
    });
  }

  // EP-AI-WORKFORCE-001: Provider selection via capability requirements (not pinning).
  // Uses capability-based routing: router picks best available provider meeting floor.
  await prisma.agentModelConfig.upsert({
    where: { agentId: "onboarding-coo" },
    create: {
      agentId: "onboarding-coo",
      minimumTier: "strong",
      budgetClass: "minimize_cost",
      minimumCapabilities: { toolUse: true },
    },
    update: {
      minimumTier: "strong",
      budgetClass: "minimize_cost",
      minimumCapabilities: { toolUse: true },
      pinnedProviderId: null, // Clear any stale pins from prior runs
    },
  });

  await syncAgentPrincipal(agent.agentId);
}

/**
 * Model tiers ordered largest-first for auto-pull on first run.
 * Each entry specifies the Docker Model Runner tag and the minimum VRAM
 * required to run it at Q4 quantization with ~15% headroom.
 *
 * Sizing estimates (Q4_K_M quantization, ~0.55 GB per billion params):
 *   - ai/qwen3:32b  (32B) → ~20 GB VRAM → needs 24 GB+ GPU / 48 GB+ unified
 *   - ai/qwen3:14b  (14B) → ~10 GB VRAM → needs 12 GB+ GPU / 24 GB+ unified
 *   - ai/qwen3:8b   (8B)  → ~6 GB  VRAM → needs 8 GB+ GPU (most consumer GPUs)
 *   - ai/qwen3:4b   (4B)  → ~3 GB  VRAM → needs 4 GB+ GPU
 *
 * Qwen3 is preferred over Gemma: Docker's benchmarks show Qwen3:8B matches
 * Claude Haiku for tool calling (F1 0.93) and Qwen3:14B exceeds it (F1 0.97).
 * Tool calling accuracy is critical for coworker routing.
 */
const MODEL_TIERS: { model: string; minVramGb: number }[] = [
  { model: "ai/qwen3:32b", minVramGb: 22 },  // 32B — RTX 4090 24 GB / Apple M4 Max 48 GB+
  { model: "ai/qwen3:14b", minVramGb: 10 },  // 14B — RTX 3080 12 GB / Apple M4 Pro 24 GB+
  { model: "ai/qwen3:8b",  minVramGb: 6 },   // 8B  — RTX 3060 8 GB / most consumer GPUs
  { model: "ai/qwen3:4b",  minVramGb: 0 },   // 4B  — CPU-only fallback
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
    return "ai/qwen3:4b";
  } catch {
    // Can't detect hardware — use the broadly compatible mid-range default
    return "ai/qwen3:8b";
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

        // Activate local provider with full clearance (including "restricted"
        // since local models never leave the machine).  Discovery is skipped
        // because checkBundledProviders() already ran it above.
        await activateProvider("local", {
          trigger: "bootstrap",
          skipDiscovery: true,
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
