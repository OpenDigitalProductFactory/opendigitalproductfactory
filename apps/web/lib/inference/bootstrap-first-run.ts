import { prisma } from "@dpf/db";
import { checkBundledProviders, getOllamaHardwareInfo } from "./ollama";
import { getOllamaBaseUrl, getOllamaApiRoot } from "./ollama-url";
import { isFirstRun, createSetupProgress } from "../actions/setup-progress";
import { activateProvider } from "@/lib/govern/activate-provider";
import { syncAgentPrincipal } from "@/lib/identity/principal-linking";
import {
  recommendGenerationModel,
  recommendServedContextTokens,
  estimateModelVramGb,
  detectLocalModelOverCommit,
  normaliseModelId,
  type HostMemory,
} from "./local-model-policy";
import { getErrorMessage } from "@/lib/shared/get-error-message";

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
      displayName: "Onboarding COO",
      kind: "orchestrator",
      tier: 1,
      type: "onboarding",
      description: "Guides new platform owners through initial setup.",
      status: "active",
      delegatesTo: ["AGT-902"],
    },
    update: {
      status: "active",
      delegatesTo: ["AGT-902"],
    },
  });

  // Grants for the setup wizard tools the onboarding COO calls:
  //   analyze_brand_document, analyze_public_website_branding → file_read, web_search
  //   prefill_onboarding_wizard → data_governance_validate
  //   list_products / read references → registry_read, backlog_read, portfolio_read
  //   setup_email (PBI-INV-04 Phase 2) → email_config
  //   record_org_business_answer (BI-44526F3E Phase C) → registry_write, so the
  //     COO can capture the operator's confirmed answers about the business into
  //     the org WWWD corpus (draft-by-default)
  //   request_coworker → thread_write, so the COO can consult AGT-902 through
  //     the governed A2A interface instead of inventing compliance advice
  // Without grants, every tool call is silently denied — the COO then claims
  // success on operations that never happened.
  const grants = [
    "file_read",
    "web_search",
    "data_governance_validate",
    "registry_read",
    "registry_write",
    "backlog_read",
    "portfolio_read",
    "email_config",
    "thread_write",
  ];
  // BI-4FA040D5: honor durable revocation tombstones so a re-run of first-run
  // bootstrap does not resurrect a grant the operator revoked.
  const revoked = await prisma.agentToolGrantRevocation.findMany({
    where: { agentId: agent.id },
    select: { grantKey: true },
  });
  const revokedKeys = new Set(revoked.map((r) => r.grantKey));
  // BI-25A1ADF7: two concurrent cold-install setup-init passes raced this
  // per-grant loop on the agentToolGrant (agentId, grantKey) composite unique —
  // each upsert does read-then-write, so both could miss the row and one insert
  // lost the race with P2002. A single createMany with skipDuplicates is an
  // atomic insert that DB-side no-ops on existing rows (ON CONFLICT DO NOTHING),
  // so it is idempotent AND race-safe. The upsert's update was a no-op ({}), so
  // there is no lost mutation. Revocation tombstones (BI-4FA040D5) still honored.
  await prisma.agentToolGrant.createMany({
    data: grants
      .filter((grantKey) => !revokedKeys.has(grantKey))
      .map((grantKey) => ({ agentId: agent.id, grantKey })),
    skipDuplicates: true,
  });

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
        // (qwen3-coder = 4k), below the build floor, so local builds and coworker
        // turns overflow. Raise the generation model's served context via the
        // shared reconcile — the SAME routine instrumentation.register() runs on
        // every boot, so first-run and every restart converge on one target.
        // Best-effort — never blocks setup.
        {
          const { reconcileLocalModelContext, LOCAL_SERVED_CONTEXT_CONFIG_KEY } = await import(
            "./local-model-context-reconcile"
          );

          // Seed a host-aware served-context default the FIRST time only, so a
          // capable box (which can afford a large KV cache) gets the bigger
          // window the heaviest coworkers need instead of the conservative build
          // floor. Skip when an operator has already pinned a value. Best-effort.
          try {
            const existing = await prisma.platformConfig.findUnique({
              where: { key: LOCAL_SERVED_CONTEXT_CONFIG_KEY },
            });
            if (!existing) {
              const hw = await getOllamaHardwareInfo(baseUrl);
              const genId = (tagsData.models ?? [])
                .map((m) => normaliseModelId(m.name))
                .find((id) => !id.includes("embed"));
              const host: HostMemory = { architecture: "discrete", vramGb: hw?.vramGb ?? null };
              const recommended = recommendServedContextTokens(
                host,
                genId ? estimateModelVramGb(genId) : null,
              );
              await prisma.platformConfig.create({
                data: { key: LOCAL_SERVED_CONTEXT_CONFIG_KEY, value: recommended },
              });
              console.log(`[bootstrap] Seeded local served-context default → ${recommended} tokens.`);
            }
          } catch {
            // best-effort — reconcile still applies the build floor below
          }

          const ctx = await reconcileLocalModelContext();
          if (ctx.status === "raised") {
            console.log(`[bootstrap] Raised ${ctx.modelId} served context ${ctx.before ?? "unset"} → ${ctx.after} for Build Studio.`);
          } else if (ctx.status === "deferred") {
            console.warn(`[bootstrap] Could not raise ${ctx.modelId} context (${ctx.reason ?? "unknown"}); applies on next model load.`);
          }
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
    const msg = getErrorMessage(err);
    onStatus?.({ phase: "failed", error: msg });
    return { error: msg };
  }
}
