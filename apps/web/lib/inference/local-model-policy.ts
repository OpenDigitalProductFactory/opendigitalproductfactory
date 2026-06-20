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
// OOM the GPU. This module centralises the policy; bootstrap + the Providers UX
// import it, and the install scripts (which cannot import TS) mirror LOCAL_MODEL_TIERS
// with a pointer comment. detectLocalModelOverCommit() is the drift safety-net.
//
// PURE module — no prisma / fs / network / server-only imports — so the client
// OllamaManagement component can import it directly.

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
 * Canonical generation-model tiers, ordered largest-first. Qwen3 — NOT Gemma —
 * because the platform's Coworkers catalog tiers Qwen3 as `strong + Tool Use`
 * (F1 0.93 @ 8B, 0.97 @ 14B) while Gemma tiers as `adequate`, and default
 * coworkers require `minimumTier: strong`.
 *
 * `minVramGb` is the discrete-VRAM floor; `approxVramGb` is the resident
 * footprint used for the over-commit budget. Mirrored (with a pointer comment)
 * by scripts/detect-hardware-host.ts and install-dpf.{ps1,sh}, which cannot
 * import TypeScript. Keep those in sync when this changes.
 */
export interface LocalModelTier {
  model: string;
  minVramGb: number;
  approxVramGb: number;
  label: string;
}

export const LOCAL_MODEL_TIERS: readonly LocalModelTier[] = [
  { model: "ai/qwen3.6:35B-A3B-UD-Q4_K_M", minVramGb: 22, approxVramGb: 22, label: "Qwen3.6 35B-A3B (MoE)" },
  { model: "ai/qwen3:14B-Q6_K", minVramGb: 12, approxVramGb: 12, label: "Qwen3 14B" },
  { model: "ai/qwen3:8B-Q4_K_M", minVramGb: 6, approxVramGb: 6, label: "Qwen3 8B" },
  { model: "ai/qwen3:4B-UD-Q4_K_XL", minVramGb: 0, approxVramGb: 3, label: "Qwen3 4B" },
] as const;

/**
 * Select the largest generation tier that fits available VRAM. Walks the tier
 * list top-down and returns the first whose `minVramGb` floor is satisfied.
 *
 * Semantics (preserve the prior bootstrap behaviour exactly):
 *   - `null`  → VRAM is UNDETECTABLE → broadly-compatible mid default (8B).
 *   - `0`     → detected zero VRAM (CPU-only host) → the CPU-OK 4B tier.
 *   - `n > 0` → largest tier whose floor `n` satisfies.
 */
export function recommendGenerationModel(vramGb: number | null): string {
  if (vramGb === null) return "ai/qwen3:8B-Q4_K_M";
  for (const tier of LOCAL_MODEL_TIERS) {
    if (vramGb >= tier.minVramGb) return tier.model;
  }
  return "ai/qwen3:4B-UD-Q4_K_XL";
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
  // qwen3-coder's short DMR name carries no size hint but is the 30B-A3B build
  // model (observed ~16.5 GB resident). Match it explicitly before param-size.
  if (/qwen3-coder/.test(id)) return 16;
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
