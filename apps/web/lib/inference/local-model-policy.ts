// apps/web/lib/inference/local-model-policy.ts
//
// SINGLE SOURCE OF TRUTH for the bundled local-model policy: which generation
// model a host should run, how to tell a generation model from an embedder, and
// — critically — whether the set of installed models OVER-COMMITS the GPU.
//
// WHY THIS EXISTS: model selection was duplicated across four places that drifted
// out of sync, so a host accumulated MULTIPLE large generation models that cannot
// co-reside on one GPU (e.g. a 12B chat model + a 30B coder model on a 24 GB card):
//   1. scripts/detect-hardware-host.ts   (install-time selectedModel)
//   2. install-dpf.ps1 / install-dpf.sh  (install-time pull)
//   3. bootstrap-first-run.ts            (first-run auto-pull)
//   4. components/platform/OllamaManagement.tsx (browse/manage catalog)
// Each picked a model independently; nothing enforced "ONE generation model at a
// time" or noticed when two had accumulated. Docker Model Runner loads one
// `llama-server` per model with no concurrency cap, so two big models thrash /
// OOM the GPU. The selectors now consume one data-only install policy, while this
// module owns the runtime guards around it. detectLocalModelOverCommit() remains
// the safety-net for models installed outside the default policy.
//
// PURE module — no prisma / fs / network / server-only imports — so the client
// OllamaManagement component can import it directly.

import installModelPolicy from "../../../../scripts/installer/local-model-policy.json";

/**
 * Policy: the local runtime keeps at most ONE generation (chat/coder) model
 * resident, plus the small embedder. Two large generation models do not fit a
 * single consumer GPU and are the root cause of the VRAM-exhaustion this module
 * guards against.
 */
export const MAX_CONCURRENT_GENERATION_MODELS = 1;

/** Canonical embedding model id (OpenAI-tag / DMR pull form). */
export const EMBEDDING_MODEL_ID = "ai/nomic-embed-text-v1.5";

// Non-chat model families a local OpenAI-compatible endpoint commonly serves
// (embeddings, rerankers, STT/TTS, vision-embed). These cannot run a chat or
// coding agent loop, so they do NOT count toward the generation-model budget.
// Canonical home — opencode-dispatch.ts re-exports isEmbeddingModelId from here.
export const NON_CHAT_MODEL_RE =
  /embed|nomic|bge[-_]|rerank|whisper|\bstt\b|\btts\b|clip|vision-embed|minilm|gte|e5/i;

/**
 * True when a model id looks like an embedding / non-chat model. Used both to
 * warn an operator who selected one for code generation and to exclude embedders
 * from the single-generation-model budget.
 */
export function isEmbeddingModelId(modelId: string): boolean {
  return NON_CHAT_MODEL_RE.test(modelId);
}

export type LocalModelRole = "generation" | "embedding";

/** Classify a model id as a generation (chat/coder) model or an embedder. */
export function classifyLocalModelRole(modelId: string): LocalModelRole {
  return isEmbeddingModelId(modelId) ? "embedding" : "generation";
}

/**
 * Headroom (GB) reserved ON TOP OF a model's weights for the context KV cache,
 * the embedder, and runtime overhead — so a recommended model fits with room to
 * RUN, not just to load. Grounded in on-box measurement (RTX 4090, 2026-06-20):
 * qwen3-coder 30B (~16.5 GB weights) at a 24k build context used ~20.7 GB
 * resident — ~4 GB over weights — and the embedder adds ~1 GB. 5 GB covers both
 * with margin and is why a 24 GB card lands on the 30B, not the 35B.
 */
export const MODEL_HEADROOM_GB = installModelPolicy.modelHeadroomGb;

/**
 * Fraction of UNIFIED memory (Apple Silicon) usable for the model. macOS lets
 * Metal address ~70–75% of unified RAM for the GPU; the rest stays for the OS +
 * the Docker stack. So a 128 GB Mac has a far larger model budget than a 24 GB
 * discrete card — it can run an 80B where the 4090 runs a 30B.
 */
export const UNIFIED_USABLE_FRACTION = installModelPolicy.unifiedUsableFraction;

/** Fraction of system RAM usable for CPU-only inference (leaves room for OS + stack). */
export const CPU_USABLE_FRACTION = installModelPolicy.cpuUsableFraction;

/**
 * Served context window (tokens) the platform auto-sets for the local GENERATION
 * model on install, so Build Studio's local builds aren't silently truncated. A
 * fresh Docker Model Runner pull defaults to a small context (qwen3-coder = 4k),
 * below OpenCode's 22k build floor (OPENCODE_MIN_CONTEXT_TOKENS). 24k clears the
 * floor with margin and fits inside the MODEL_HEADROOM_GB the tier selection
 * already reserves (~2.3 GB of KV cache at this size — measured ~0.1 GB / 1k tokens).
 */
export const RECOMMENDED_BUILD_CONTEXT_TOKENS = 24_576;

/**
 * Practical ceiling for the local served context, and the cap on both the
 * operator override and the host-aware recommendation below.
 *
 * WHY THIS MATTERS: the build floor (24k) clears OpenCode but is too small for
 * the heaviest COWORKER. The COO's assembled prompt — full persona + skills
 * catalog + tool schemas — is ~16k input tokens before the user types anything,
 * and routing demands `estimatedInput × 1.5` of context (request-contract.ts).
 * 16k × 1.5 = 24.6k > 24,576, so a 24k served window HARD-EXCLUDES the COO on a
 * single-local-model install ("No eligible endpoints for task 'conversation'"),
 * surfaced to the user as "The AI provider is temporarily unavailable". 128k
 * clears every coworker with room for long threads (~13 GB KV cache at this
 * size) and fits comfortably inside a capable box's memory budget.
 */
export const MAX_LOCAL_CONTEXT_TOKENS = 131_072;

/**
 * Approximate KV-cache cost per 1k tokens of served context, GB. Measured on-box
 * (RTX 4090 / qwen3-coder 30B): ~2.3 GB at 24k ≈ 0.1 GB / 1k. Used to size the
 * served context to the memory the host can actually spare after model weights.
 */
export const KV_CACHE_GB_PER_1K_TOKENS = 0.1;

/** Round a token count DOWN to a clean 8k multiple (what runtimes prefer). */
function roundDownTo8k(tokens: number): number {
  return Math.floor(tokens / 8_192) * 8_192;
}

/**
 * Clamp a served-context request to the supported band: never below the build
 * floor (smaller silently truncates local builds / coworker turns), never above
 * the practical ceiling. Non-finite / non-positive input falls back to the floor.
 */
export function clampServedContextTokens(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return RECOMMENDED_BUILD_CONTEXT_TOKENS;
  return Math.min(MAX_LOCAL_CONTEXT_TOKENS, Math.max(RECOMMENDED_BUILD_CONTEXT_TOKENS, Math.floor(tokens)));
}

/**
 * Recommend the served context window (tokens) for the local generation model,
 * scaled to the memory the host can spare AFTER the model weights + embedder +
 * runtime overhead (MODEL_HEADROOM_GB already covers the embedder/overhead, so we
 * only subtract weights from the budget here). Architecture-aware via
 * computeMemoryBudgetGb: a 24 GB discrete card lands near the build floor, a
 * 128 GB unified Mac lands at the ceiling.
 *
 * Falls back to the build floor whenever the budget or weights are unknown
 * (e.g. Docker Model Runner reports no VRAM on Apple Silicon) — in that case the
 * operator override is the mechanism for going higher. Result is clamped to
 * [RECOMMENDED_BUILD_CONTEXT_TOKENS, MAX_LOCAL_CONTEXT_TOKENS] and rounded to 8k.
 */
export function recommendServedContextTokens(
  host: HostMemory,
  modelWeightsGb: number | null,
): number {
  const budget = computeMemoryBudgetGb(host);
  if (!budget || budget <= 0 || modelWeightsGb == null || modelWeightsGb < 0) {
    return RECOMMENDED_BUILD_CONTEXT_TOKENS;
  }
  const kvBudgetGb = budget - modelWeightsGb - MODEL_HEADROOM_GB;
  if (kvBudgetGb <= 0) return RECOMMENDED_BUILD_CONTEXT_TOKENS;
  const tokens = roundDownTo8k((kvBudgetGb / KV_CACHE_GB_PER_1K_TOKENS) * 1_000);
  return clampServedContextTokens(tokens);
}

export type HostArchitecture = "discrete" | "unified" | "cpu";

export interface HostMemory {
  /** "discrete" = dedicated GPU VRAM; "unified" = Apple Silicon shared RAM; "cpu" = no GPU. */
  architecture: HostArchitecture;
  /** Dedicated GPU VRAM in GB (discrete hosts). */
  vramGb?: number | null;
  /** Total system RAM in GB (drives the unified + cpu budgets). */
  totalRamGb?: number | null;
}

/**
 * Canonical generation-model tiers, ordered largest-first. Qwen3 family (strong
 * tool-calling); the `-coder` variants double as the Build Studio code model AND
 * a capable chat model, so one model serves both. `weightsGb` is the approximate
 * Q4 resident WEIGHT footprint; the selector adds MODEL_HEADROOM_GB for context +
 * embedder before deciding what fits.
 *
 * Defined in the data-only installer policy so browser code, host detection,
 * and the PowerShell installer all select from the same ordered list.
 */
export interface LocalModelTier {
  model: string;
  /** Approximate resident weight footprint, GB (Q4). */
  weightsGb: number;
  label: string;
}

export const LOCAL_MODEL_TIERS: readonly LocalModelTier[] = installModelPolicy.tiers;

/** Smallest tier — the CPU-OK fallback when nothing larger fits the budget. */
const SMALLEST_TIER = LOCAL_MODEL_TIERS[LOCAL_MODEL_TIERS.length - 1]!;

/**
 * The memory budget (GB) actually available to a local model on this host:
 *   - discrete → dedicated VRAM (hard ceiling)
 *   - unified  → a fraction of total RAM (Apple Silicon shares it with the OS)
 *   - cpu      → a smaller fraction of total RAM
 */
export function computeMemoryBudgetGb(host: HostMemory): number {
  if (host.architecture === "discrete") return host.vramGb && host.vramGb > 0 ? host.vramGb : 0;
  if (host.architecture === "unified") return Math.max(0, (host.totalRamGb ?? 0) * UNIFIED_USABLE_FRACTION);
  return Math.max(0, (host.totalRamGb ?? 0) * CPU_USABLE_FRACTION);
}

/**
 * Recommend the largest generation model that fits the host's memory budget WITH
 * headroom for context + embedder. Architecture-aware: a 24 GB discrete card
 * lands on the 30B (fits at build context), a 128 GB unified Mac lands on the
 * 80B MoE, and an 8–12 GB budget GPU lands on a model that actually fits instead
 * of one that fills the card and then over-commits the moment it runs.
 */
export function recommendGenerationModelForHost(host: HostMemory): string {
  const budget = computeMemoryBudgetGb(host);
  for (const tier of LOCAL_MODEL_TIERS) {
    if (tier.weightsGb + MODEL_HEADROOM_GB <= budget) return tier.model;
  }
  return SMALLEST_TIER.model;
}

/**
 * Discrete-VRAM convenience wrapper (the runtime bootstrap path knows only VRAM).
 * Headroom-aware. `null` = VRAM undetectable → broadly-compatible 8B default;
 * `0` = detected zero VRAM (CPU-only) → the smallest tier.
 */
export function recommendGenerationModel(vramGb: number | null): string {
  if (vramGb === null) return "ai/qwen3:8B-Q4_K_M";
  return recommendGenerationModelForHost({ architecture: "discrete", vramGb });
}

/**
 * Best-effort resident VRAM estimate (GB) for a model id, from known families /
 * parameter-size hints. Returns null when the size can't be inferred — callers
 * must treat null as "unknown, still counts as one generation model" rather than
 * zero. Approximate by design; used only for the budget heuristic and display.
 */
export function estimateModelVramGb(modelId: string): number | null {
  const id = modelId.toLowerCase();
  if (isEmbeddingModelId(id)) return 1;
  // qwen3-coder-next is the 80B MoE coder — match BEFORE qwen3-coder (substring).
  if (/coder-next/.test(id)) return 48;
  // qwen3-coder's short DMR name carries no size hint but is the 30B-A3B build
  // model (observed ~16.5 GB resident). Match it explicitly before param-size.
  if (/qwen3-coder/.test(id)) return 16;
  // Qwen3.8-27B dense — measured 17.66 GiB resident via Docker Model Runner.
  // Must precede the generic param-size rules: the id carries "27b", which none
  // of them match, and would otherwise fall through to null.
  if (/qwen3\.8/.test(id)) return 18;
  if (/80b/.test(id)) return 48;
  if (/35b/.test(id)) return 22;
  if (/30b/.test(id)) return 16; // qwen3 30B-A3B observed ~16.5 GB
  if (/gemma.?4|gemma.?3/.test(id)) return /12b/.test(id) ? 8 : 20;
  if (/14b/.test(id)) return /coder|qwen2\.5/.test(id) ? 10 : 12;
  if (/8b/.test(id)) return 6;
  if (/7b/.test(id)) return 6;
  if (/4b/.test(id)) return 3;
  return null;
}

/** Strip the `docker.io/` prefix and `:latest` suffix DMR adds, for matching. */
export function normaliseModelId(name: string): string {
  return name.replace(/^docker\.io\//, "").replace(/:latest$/, "");
}

/**
 * Max prompt envelope (tokens) a Build Studio REASONING phase (plan /
 * design-review / plan-review) carries: full persona + skills catalog + tool
 * schemas + reasoning instructions. Observed live as a
 * `exceed_context_size_error: request (29362 tokens) exceeds context size
 * (24576)` on those phases. A local served window below this HARD-EXCLUDES local
 * from the reasoning phases' candidate set, making them cloud-only — the SPOF
 * BI-3E614946 surfaces. 30,720 (30 * 1024) covers the observed 29,362 with margin.
 */
export const REASONING_PHASE_CONTEXT_ENVELOPE_TOKENS = 30_720;

/**
 * Whether a local served context is large enough for local to be eligible as a
 * fallback for the reasoning phases. `null` (no reachable local model / unknown
 * served window) is treated as not-eligible. This is the degrade flag: when
 * false, the reasoning phases run cloud-only on this hardware/model.
 */
export function isLocalServedContextEligibleForReasoning(servedTokens: number | null): boolean {
  return servedTokens != null && servedTokens >= REASONING_PHASE_CONTEXT_ENVELOPE_TOKENS;
}

/**
 * The resource-aware CEILING (tokens) for the local served context on this host
 * and model: the most the box can actually serve without over-committing VRAM
 * (`recommendServedContextTokens` already subtracts weights + headroom and clamps
 * to the supported band). When the host memory is unknown we cannot verify VRAM,
 * so we return the practical MAX and let the operator override govern — never
 * auto-raise blindly. Used both as the default target and as the upper bound on
 * the operator override, so a pinned value can never over-commit a known GPU.
 */
export function computeServedContextCeiling(
  host: HostMemory | null,
  modelId: string | null,
): number {
  if (!host) return MAX_LOCAL_CONTEXT_TOKENS;
  return recommendServedContextTokens(host, modelId ? estimateModelVramGb(modelId) : null);
}

/**
 * Normalize a persisted `PlatformConfig.host_profile` (written verbatim from the
 * installer's `DPF_HOST_PROFILE`) into a `HostMemory` + the installer's selected
 * model. TWO shapes exist and both are supported:
 *   - Windows / install-dpf.ps1 : flat `{ gpuVramGB, ramGB, selectedModel }`
 *   - macOS / Linux             : nested `{ architecture, gpu:{vramGB}, ram:{totalGB} }`
 * Architecture: the explicit field when present (`cpu-only` → `cpu`), else
 * inferred — positive VRAM → `discrete`, otherwise `cpu` (conservative; without a
 * VRAM read we cannot claim a usable GPU budget). Returns null for junk/missing.
 */
export function parseHostMemory(
  raw: unknown,
): { host: HostMemory; selectedModel: string | null } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const nestedGpu = r.gpu && typeof r.gpu === "object" ? (r.gpu as Record<string, unknown>) : null;
  const nestedRam = r.ram && typeof r.ram === "object" ? (r.ram as Record<string, unknown>) : null;

  const vramGb = num(r.gpuVramGB) ?? (nestedGpu ? num(nestedGpu.vramGB) : null);
  const totalRamGb = num(r.ramGB) ?? (nestedRam ? num(nestedRam.totalGB) : null);
  const selectedModel = typeof r.selectedModel === "string" ? r.selectedModel : null;

  // A profile with no memory signal at all is junk.
  if (vramGb == null && totalRamGb == null && r.architecture == null) return null;

  let architecture: HostArchitecture;
  const declared = typeof r.architecture === "string" ? r.architecture : null;
  if (declared === "unified") architecture = "unified";
  else if (declared === "discrete") architecture = "discrete";
  else if (declared === "cpu" || declared === "cpu-only") architecture = "cpu";
  else architecture = vramGb != null && vramGb > 0 ? "discrete" : "cpu";

  return { host: { architecture, vramGb, totalRamGb }, selectedModel };
}

/**
 * Among installed generation models, choose the single one to KEEP. Prefers a
 * coder model (Build Studio's code-generation use), then the tier the hardware
 * recommends, then the largest that still fits the budget, else the first.
 */
export function recommendKeepGenerationModel(
  generationModelIds: string[],
  vramGb: number | null,
): string | null {
  if (generationModelIds.length === 0) return null;
  if (generationModelIds.length === 1) return generationModelIds[0]!;

  const coder = generationModelIds.find((m) => /coder|[-_]code\b|code[-_]/i.test(m));
  if (coder) return coder;

  // Exact tier match, tolerating a missing/added `ai/` vendor prefix and the
  // docker.io/ + :latest decorations normaliseModelId strips. Must NOT match on
  // family alone — every qwen3 tier shares the `ai/qwen3` prefix, so a substring
  // match would wrongly keep the first (often smallest) tier.
  const stripVendor = (s: string) => normaliseModelId(s).replace(/^ai\//, "");
  const recKey = stripVendor(recommendGenerationModel(vramGb));
  const matchesRecommended = generationModelIds.find((m) => stripVendor(m) === recKey);
  if (matchesRecommended) return matchesRecommended;

  // Largest that fits the budget (or just largest when budget unknown).
  const budget = vramGb && vramGb > 0 ? vramGb : Infinity;
  const sized = generationModelIds
    .map((m) => ({ m, gb: estimateModelVramGb(m) ?? 0 }))
    .sort((a, b) => b.gb - a.gb);
  const largestFitting = sized.find((s) => s.gb <= budget);
  return (largestFitting ?? sized[0])!.m;
}

export interface OverCommitVerdict {
  /** True when the installed model set exceeds the single-generation-model policy or the VRAM budget. */
  overCommitted: boolean;
  /** Why — surfaced verbatim in the Providers UX. Empty string when not over-committed. */
  reason: string;
  generationModelIds: string[];
  embeddingModelIds: string[];
  /** The one generation model to keep (when over-committed by count); null otherwise. */
  recommendedKeep: string | null;
  /** Generation models that should be removed to satisfy the policy. */
  removeCandidates: string[];
  /** Summed resident estimate (GB) of all generation models, when estimable. */
  estimatedGenerationVramGb: number | null;
  /** The VRAM budget used for the check (host VRAM), or null when undetected. */
  budgetVramGb: number | null;
}

/**
 * Decide whether the set of installed local models over-commits the host:
 *  - more than ONE generation model installed (the policy ceiling), OR
 *  - the summed resident estimate of generation models exceeds detected VRAM.
 *
 * The embedder is always allowed alongside the single generation model. This is
 * the drift safety-net: regardless of which selection path pulled a second big
 * model, the Providers UX and bootstrap surface it from here.
 */
export function detectLocalModelOverCommit(args: {
  installedModelIds: string[];
  vramGb: number | null;
}): OverCommitVerdict {
  const { installedModelIds, vramGb } = args;
  const generationModelIds = installedModelIds.filter((m) => !isEmbeddingModelId(m));
  const embeddingModelIds = installedModelIds.filter((m) => isEmbeddingModelId(m));

  const estimates = generationModelIds.map((m) => estimateModelVramGb(m));
  const allKnown = estimates.every((e) => e !== null);
  const estimatedGenerationVramGb = allKnown
    ? estimates.reduce((sum, e) => sum + (e ?? 0), 0)
    : null;

  const tooMany = generationModelIds.length > MAX_CONCURRENT_GENERATION_MODELS;
  const budgetVramGb = vramGb && vramGb > 0 ? vramGb : null;
  // Reserve ~1 GB for the embedder when computing headroom.
  const overBudget =
    budgetVramGb !== null &&
    estimatedGenerationVramGb !== null &&
    estimatedGenerationVramGb + (embeddingModelIds.length > 0 ? 1 : 0) > budgetVramGb;

  const recommendedKeep = tooMany
    ? recommendKeepGenerationModel(generationModelIds, vramGb)
    : null;
  const removeCandidates =
    tooMany && recommendedKeep
      ? generationModelIds.filter((m) => m !== recommendedKeep)
      : [];

  let reason = "";
  if (tooMany) {
    const keepLabel = recommendedKeep ? normaliseModelId(recommendedKeep) : "one";
    reason =
      `${generationModelIds.length} generation models are installed, but the local runtime ` +
      `keeps only one resident at a time` +
      (budgetVramGb ? ` (a ${budgetVramGb} GB GPU cannot hold two large models)` : "") +
      `. Keep ${keepLabel} and remove the rest to stop them competing for VRAM.`;
  } else if (overBudget) {
    reason =
      `The installed generation model needs about ${estimatedGenerationVramGb} GB but only ` +
      `${budgetVramGb} GB of VRAM was detected — it will spill to system RAM and run slowly. ` +
      `Choose a smaller tier for this hardware.`;
  }

  return {
    overCommitted: tooMany || overBudget,
    reason,
    generationModelIds,
    embeddingModelIds,
    recommendedKeep,
    removeCandidates,
    estimatedGenerationVramGb,
    budgetVramGb,
  };
}
