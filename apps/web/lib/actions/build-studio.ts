"use server";

import { prisma, type Prisma } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import type { BuildStudioDispatchConfig } from "@/lib/integrate/build-studio-config";
import { getOllamaBaseUrl, getOllamaApiRoot, resolveOpencodeProviderBaseUrl } from "@/lib/inference/ollama-url";
import { preflightLocalEndpoint, OPENCODE_MIN_CONTEXT_TOKENS, type LocalEndpointPreflight } from "@/lib/integrate/opencode-dispatch";
import { setServedContextTokens } from "@/lib/inference/dmr-runtime-config";
import { getLocalOnlyInference, setLocalOnlyInference } from "@/lib/inference/local-only";
import { sanitizeForLog } from "@/lib/security/safe-log";

async function requireManageProviders(): Promise<string> {
  return (await requireCapability("manage_provider_connections")).userId;
}

const VALID_ENGINES = new Set(["claude", "codex", "grok", "opencode", "agentic"]);
const VALID_CLAUDE_MODELS = new Set(["haiku", "sonnet", "opus"]);

export async function saveBuildStudioConfig(
  config: BuildStudioDispatchConfig,
): Promise<{ ok: true }> {
  await requireManageProviders();

  if (!VALID_ENGINES.has(config.provider)) {
    throw new Error(`Invalid provider engine: ${config.provider}`);
  }
  const enginePolicy = config.enginePolicy === "pinned" ? "pinned" : "auto";
  const pinnedEngine = enginePolicy === "pinned" ? (config.pinnedEngine ?? config.provider) : null;
  if (pinnedEngine !== null && !VALID_ENGINES.has(pinnedEngine)) {
    throw new Error(`Invalid pinned build engine: ${pinnedEngine}`);
  }

  // Validate provider IDs dynamically against what's in the DB
  if (config.claudeProviderId) {
    const claudeProvider = await prisma.modelProvider.findFirst({
      where: { providerId: config.claudeProviderId, cliEngine: "claude" },
    });
    if (!claudeProvider) {
      throw new Error(`Provider ${config.claudeProviderId} is not a Claude-compatible provider`);
    }
  }
  if (config.codexProviderId) {
    const codexProvider = await prisma.modelProvider.findFirst({
      where: { providerId: config.codexProviderId, cliEngine: "codex" },
    });
    if (!codexProvider) {
      throw new Error(`Provider ${config.codexProviderId} is not a Codex-compatible provider`);
    }
  }
  if (config.grokProviderId) {
    const grokProvider = await prisma.modelProvider.findFirst({
      where: { providerId: config.grokProviderId, cliEngine: "grok" },
    });
    if (!grokProvider) {
      throw new Error(`Provider ${config.grokProviderId} is not a Grok-compatible provider`);
    }
  }
  if (config.opencodeProviderId) {
    const opencodeProvider = await prisma.modelProvider.findFirst({
      where: { providerId: config.opencodeProviderId, cliEngine: "opencode" },
    });
    if (!opencodeProvider) {
      throw new Error(`Provider ${config.opencodeProviderId} is not an OpenCode-compatible provider`);
    }
  }

  if (config.claudeModel && !VALID_CLAUDE_MODELS.has(config.claudeModel)) {
    throw new Error(`Invalid Claude model: ${config.claudeModel}`);
  }

  const storedConfig = {
    provider: config.provider,
    enginePolicy,
    pinnedEngine,
    claudeProviderId: config.claudeProviderId,
    codexProviderId: config.codexProviderId,
    grokProviderId: config.grokProviderId,
    opencodeProviderId: config.opencodeProviderId,
    claudeModel: config.claudeModel,
    codexModel: config.codexModel,
    grokModel: config.grokModel,
    opencodeModel: config.opencodeModel,
  } satisfies BuildStudioDispatchConfig;

  await prisma.platformConfig.upsert({
    where: { key: "build-studio-dispatch" },
    update: { value: storedConfig as unknown as Prisma.InputJsonValue },
    create: { key: "build-studio-dispatch", value: storedConfig as unknown as Prisma.InputJsonValue },
  });

  return { ok: true };
}

/**
 * Config-time preflight of the local model endpoint behind the opencode engine.
 * Surfaces, at configuration time rather than first at dispatch, whether the
 * install's local OpenAI-compatible endpoint is reachable and serving the
 * desired model. Read-only; gated on the same manage-providers capability.
 */
export async function checkLocalEndpoint(
  model: string,
  opencodeProviderId?: string,
): Promise<LocalEndpointPreflight> {
  await requireManageProviders();
  // Probe the endpoint of the SELECTED opencode provider — so picking a seeded
  // "Ollama" provider hits its own baseUrl (localhost:11434) and honestly
  // reports reachable/not, instead of silently borrowing the Docker Model
  // Runner default and showing a green "Ready" that was really DMR's status.
  const provider = opencodeProviderId
    ? await prisma.modelProvider.findFirst({
        where: { providerId: opencodeProviderId, cliEngine: "opencode" },
        select: { providerId: true, endpoint: true, baseUrl: true },
      })
    : null;
  const portalBaseUrl = resolveOpencodeProviderBaseUrl(provider).replace(/\/$/, "");
  // checkServedContext: read the authoritative runtime context window so the
  // UX shows the real served size (e.g. a 32768 override) and warns/blocks
  // below the agent floor — not the misleading /v1/models artifact default.
  return preflightLocalEndpoint(portalBaseUrl, model ?? "", fetch, { checkServedContext: true });
}

const MIN_CONTEXT_FLOOR = 1024;
const MAX_CONTEXT_CEILING = 1_048_576; // 1M — generous upper guard; DMR rejects values a model can't serve

/**
 * Raise (or lower) the served context window of a local model via Docker Model
 * Runner's runtime configure API — the operator never touches Docker. Persists
 * the value to the matching local ModelProfile.maxContextTokens so routing and
 * the dispatch preflight use the real number, then returns a fresh preflight.
 *
 * Gated on manage-providers. The model id is the one `/v1/models` reports
 * (e.g. "docker.io/ai/qwen3-coder:latest"); DMR matches it leniently.
 */
export async function applyLocalModelContext(
  model: string,
  contextTokens: number,
): Promise<{ ok: boolean; reason: string | null; preflight: LocalEndpointPreflight | null }> {
  await requireManageProviders();

  const trimmed = (model ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "No model specified. Resolve the served model first (Test local endpoint).", preflight: null };
  }
  if (!Number.isFinite(contextTokens) || !Number.isInteger(contextTokens)) {
    return { ok: false, reason: "Context window must be a whole number of tokens.", preflight: null };
  }
  if (contextTokens < MIN_CONTEXT_FLOOR || contextTokens > MAX_CONTEXT_CEILING) {
    return { ok: false, reason: `Context window must be between ${MIN_CONTEXT_FLOOR} and ${MAX_CONTEXT_CEILING} tokens.`, preflight: null };
  }
  if (contextTokens < OPENCODE_MIN_CONTEXT_TOKENS) {
    // Allowed (operator may know better), but make the consequence explicit.
    // sanitizeForLog (the CodeQL-registered sanitizer) strips C0 + DEL so a
    // CR/LF in the operator-supplied model id cannot forge a downstream log
    // line (CWE-117). contextTokens is already Number.isInteger above, so it
    // safely composes into the same sanitized line.
    console.warn(
      sanitizeForLog(
        `[build-studio] applyLocalModelContext set ${trimmed} to ${contextTokens} (< ${OPENCODE_MIN_CONTEXT_TOKENS} agent floor)`,
      ),
    );
  }

  // Resource-aware over-commit guard (BI-3E614946): never let a pin exceed what
  // this host can actually serve for this model — a larger served window needs
  // more VRAM (KV cache), and DMR would reject it or spill to system RAM and
  // thrash. When the host memory is unknown we cannot verify, so we trust the
  // operator (DMR's own POST is the remaining guard).
  {
    const { resolveHostMemoryProfile } = await import("@/lib/inference/local-model-context-reconcile");
    const { computeServedContextCeiling, normaliseModelId } = await import("@/lib/inference/local-model-policy");
    const profile = await resolveHostMemoryProfile();
    if (profile) {
      const ceiling = computeServedContextCeiling(profile.host, normaliseModelId(trimmed));
      if (contextTokens > ceiling) {
        return {
          ok: false,
          reason:
            `This hardware can serve at most ${Math.round(ceiling / 1000)}k tokens for ` +
            `${normaliseModelId(trimmed)} after the model weights + a safety margin. ` +
            `Choose ${Math.round(ceiling / 1000)}k or less, or run a smaller model to free VRAM for a larger context.`,
          preflight: null,
        };
      }
    }
  }

  const apiRoot = getOllamaApiRoot();
  const applied = await setServedContextTokens(apiRoot, trimmed, contextTokens);
  if (!applied.ok) {
    return { ok: false, reason: applied.reason, preflight: null };
  }

  // Persist to the matching local ModelProfile so routing eligibility + the
  // dispatch preflight use the real served context (fix-the-seed: the DB row is
  // the routing source of truth, not the artifact default).
  await prisma.modelProfile.updateMany({
    where: { providerId: { in: ["local", "ollama"] }, modelId: trimmed },
    data: { maxContextTokens: applied.contextTokens ?? contextTokens },
  });

  const portalBaseUrl = getOllamaBaseUrl().replace(/\/$/, "");
  const preflight = await preflightLocalEndpoint(portalBaseUrl, trimmed, fetch, { checkServedContext: true });
  return { ok: true, reason: null, preflight };
}

/**
 * Resource-aware served-context summary for the Platform > AI surface
 * (BI-3E614946): the live served window, the reconcile target, the hardware
 * ceiling (the most this box can serve for its model without over-committing
 * VRAM), and — the SPOF flag — whether local clears the reasoning-phase envelope
 * or those phases run cloud-only on this hardware. Flattened + serializable for
 * the client form. Read-only; gated on manage-providers.
 */
export async function getLocalServedContextInfo(): Promise<{
  served: number | null;
  target: number;
  ceiling: number;
  reasoningEnvelope: number;
  reasoningEligible: boolean;
  vramGb: number | null;
  gpuArchitecture: "discrete" | "unified" | "cpu" | null;
  selectedModel: string | null;
}> {
  await requireManageProviders();
  const { resolveServedContextInfo } = await import("@/lib/inference/local-model-context-reconcile");
  const info = await resolveServedContextInfo();
  return {
    served: info.served,
    target: info.target,
    ceiling: info.ceiling,
    reasoningEnvelope: info.reasoningEnvelope,
    reasoningEligible: info.reasoningEligible,
    vramGb: info.host?.vramGb ?? null,
    gpuArchitecture: info.host?.architecture ?? null,
    selectedModel: info.selectedModel,
  };
}

/** Read the local-only inference (cloud-disabled) switch. */
export async function getLocalOnlyInferenceSetting(): Promise<boolean> {
  await requireManageProviders();
  return getLocalOnlyInference();
}

/**
 * Toggle local-only inference. When ON, every routed inference call is pinned
 * to the local provider (residencyPolicy=local_only) and fails loudly if no
 * local model qualifies — no silent cloud fallback.
 */
export async function setLocalOnlyInferenceSetting(enabled: boolean): Promise<{ ok: true; enabled: boolean }> {
  await requireManageProviders();
  await setLocalOnlyInference(enabled);
  return { ok: true, enabled };
}
