import { prisma } from "@dpf/db";
import { checkBundledProviders, getOllamaHardwareInfo } from "./ollama";
import { getOllamaBaseUrl, getOllamaApiRoot } from "./ollama-url";
import { isFirstRun, createSetupProgress } from "../actions/setup-progress";
import { activateProvider } from "@/lib/govern/activate-provider";
import { syncAgentPrincipal } from "@/lib/identity/principal-linking";
import {
  recommendGenerationModel,
  detectLocalModelOverCommit,
  normaliseModelId,
  isEmbeddingModelId,
  RECOMMENDED_BUILD_CONTEXT_TOKENS,
} from "./local-model-policy";
import { setServedContextTokens } from "./dmr-runtime-config";

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
  //   setup_email (PBI-INV-04 Phase 2) → email_config
  // Without grants, every tool call is silently denied — the COO then claims
  // success on operations that never happened.
  const grants = [
    "file_read",
    "web_search",
    "data_governance_validate",
    "registry_read",
    "backlog_read",
    "portfolio_read",
    "email_config",
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
 * Select the largest generation model that fits available VRAM. The canonical
 * tier list now lives in local-model-policy.ts (shared with the Providers UX and
 * mirrored by the install scripts); this wrapper only adds the hardware probe.
 *
 *   - hwInfo present, vramGb n  → largest tier whose floor n satisfies
 *   - hwInfo present, vramGb 0  → CPU-only host → 4B tier
 *   - hwInfo missing / exception → undetectable → broadly-compatible 8B default
 */
async function selectModelForHardware(baseUrl: string): Promise<string> {
  try {
    const hwInfo = await getOllamaHardwareInfo(baseUrl);
    return recommendGenerationModel(hwInfo?.vramGb ?? 0);
  } catch {
    return recommendGenerationModel(null);
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
      // The Ollama-native /api/* endpoints live at the management root, not under
      // the OpenAI-compatible /v1 inference prefix. On Docker Model Runner,
      // `${baseUrl}/api/tags` resolves to /v1/api/tags (404), which silently
      // skipped first-run auto-pull. getOllamaApiRoot() strips the /v1 suffix.
      const apiRoot = getOllamaApiRoot();

      // Check if the local runtime is reachable
      const pingRes = await fetch(`${apiRoot}/api/tags`, { signal: AbortSignal.timeout(3000) });
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

          const pullRes = await fetch(`${apiRoot}/api/pull`, {
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

        // Drift guard: the local runtime keeps only ONE generation model
        // resident, and two large models over-commit the GPU. Warn (best-effort)
        // if more than one generation model is already installed so the operator
        // can prune in the Providers UX. See local-model-policy.ts.
        try {
          const installed = (tagsData.models ?? []).map((m) => normaliseModelId(m.name));
          const hw = await getOllamaHardwareInfo(baseUrl);
          const verdict = detectLocalModelOverCommit({
            installedModelIds: installed,
            vramGb: hw?.vramGb ?? null,
          });
          if (verdict.overCommitted) {
            console.warn(`[bootstrap] Local model over-commit — ${verdict.reason}`);
          }
        } catch {
          // best-effort — never block setup on the drift check
        }

        // Build-context guard: a fresh DMR pull serves a small default context
        // (qwen3-coder = 4k), below OpenCode's 22k build floor, so local builds
        // would silently truncate. Raise the GENERATION model's served context to
        // a build-appropriate size (the embedder is left alone). Best-effort —
        // never blocks setup. See local-model-policy.ts + dmr-runtime-config.ts.
        try {
          const oaiBase = getOllamaBaseUrl().replace(/\/$/, "");
          const modelsUrl = oaiBase.endsWith("/v1") ? `${oaiBase}/models` : `${oaiBase}/v1/models`;
          const modelsRes = await fetch(modelsUrl, { signal: AbortSignal.timeout(3000) });
          if (modelsRes.ok) {
            const body = (await modelsRes.json()) as {
              data?: Array<{ id?: string; dmr?: { context_window?: number } }>;
            };
            const gen = (body.data ?? []).find((m) => m.id && !isEmbeddingModelId(m.id));
            const served = gen?.dmr?.context_window ?? 0;
            if (gen?.id && served < RECOMMENDED_BUILD_CONTEXT_TOKENS) {
              const applied = await setServedContextTokens(apiRoot, gen.id, RECOMMENDED_BUILD_CONTEXT_TOKENS);
              if (applied.ok) {
                // fix-the-seed: the ModelProfile row is the routing source of truth,
                // so persist the served context there too (not just in DMR).
                await prisma.modelProfile.updateMany({
                  where: { providerId: { in: ["local", "ollama"] }, modelId: gen.id },
                  data: { maxContextTokens: applied.contextTokens ?? RECOMMENDED_BUILD_CONTEXT_TOKENS },
                });
                console.log(`[bootstrap] Raised ${gen.id} served context ${served} → ${RECOMMENDED_BUILD_CONTEXT_TOKENS} for Build Studio.`);
              } else {
                console.warn(`[bootstrap] Could not raise ${gen.id} context (${applied.reason ?? "unknown"}); local builds may truncate until set in Build Runtime.`);
              }
            }
          }
        } catch {
          // best-effort — never block setup on the context tune
        }
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
