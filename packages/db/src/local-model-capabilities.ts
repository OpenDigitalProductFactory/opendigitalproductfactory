/**
 * Capability *priors* for locally-served models (Docker Model Runner / Ollama).
 *
 * These are BOOTSTRAP priors only. A fresh install needs *some* capability
 * scores so routing can function before the deterministic dimension eval
 * (apps/web/lib/routing/eval-runner.ts) runs at provider activation and promotes
 * profileSource seed -> evaluated with *measured* scores. Per the
 * "seed is bootstrap, calibration is runtime" principle these values carry
 * profileConfidence="low" so an activation-time eval always wins.
 *
 * Why a per-family prior instead of a flat default: the prior implementation
 * stamped toolFidelity=20 on *every* discovered local model. That made routing
 * unable to distinguish a strong tool-caller (Qwen3, Gemma — verified to emit
 * clean tool_calls via Docker Model Runner) from a reasoning model that
 * fabricates instead of calling tools (Magistral) from an embedding model that
 * cannot chat at all (nomic-embed, which was additionally mis-flagged
 * supportsToolUse=true). With every model scored identically, the tool-routing
 * gate either stripped tools or could not pick the capable model, surfacing as
 * the "I'm on a local AI that wasn't strong enough" coworker message.
 * See the 2026-06 local-model capability investigation.
 */

export interface LocalModelCapabilityPrior {
  /** True for embedding models (nomic, bge, e5, ...). Not chat/tool routable. */
  isEmbedding: boolean;
  /**
   * True for multimodal-IN models that accept image content (Gemma 4, Gemma 3n,
   * *-VL, LLaVA, moondream, pixtral, MiniCPM-V, ...). Drives ModelProfile
   * capabilities.imageInput so the `imageInput` routing floor can select it.
   * Bootstrap prior only — the activation eval still calibrates.
   */
  supportsVision: boolean;
  /**
   * True for multimodal-IN models that accept audio content (Gemma 4, Gemma 3n,
   * Qwen-Omni, Whisper-family, ...). Drives ModelProfile capabilities.audioInput
   * so the `audioInput` routing floor can select it. Verified on-machine
   * (2026-06-15): ai/gemma4:12B transcribes a wav via DMR. Bootstrap prior only.
   */
  supportsAudio: boolean;
  capabilityCategory: string;
  supportsToolUse: boolean;
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowingScore: number;
  structuredOutputScore: number;
  conversational: number;
  contextRetention: number;
  bestFor: string[];
  avoidFor: string[];
}

export type LocalModelFamily =
  | "embedding"
  | "qwen-coder"
  | "qwen"
  | "gemma"
  | "magistral"
  | "mistral"
  | "llama"
  | "phi"
  | "deepseek"
  | "unknown";

/** Normalize a Docker Model Runner / Ollama model id to a bare lowercase name. */
export function normalizeLocalModelId(modelId: string): string {
  return modelId
    .replace(/^docker\.io\//, "")
    .replace(/^ai\//, "")
    .toLowerCase();
}

/** Best-effort family detection from a (possibly registry-prefixed) model id. */
export function detectLocalModelFamily(modelId: string): LocalModelFamily {
  const id = normalizeLocalModelId(modelId);
  // Embedding first — "nomic-embed" etc. must never fall through to a chat tier.
  if (/embed|nomic|bge|e5-|gte-/.test(id)) return "embedding";
  // "qwen" + "coder" in either order. Plain substring tests rather than
  // `qwen.*coder|coder.*qwen`: the `.*`-between-literals form backtracks
  // polynomially on adversarial ids (CodeQL js/polynomial-redos).
  if (id.includes("qwen") && id.includes("coder")) return "qwen-coder";
  if (/qwen/.test(id)) return "qwen";
  if (/gemma/.test(id)) return "gemma";
  if (/magistral/.test(id)) return "magistral";
  if (/mistral|mixtral/.test(id)) return "mistral";
  if (/llama/.test(id)) return "llama";
  if (/phi/.test(id)) return "phi";
  if (/deepseek/.test(id)) return "deepseek";
  return "unknown";
}

/**
 * Best-effort detection of multimodal (image-input) local models, orthogonal to
 * the text/tool family. Capability-routing relies on this to populate
 * ModelProfile.capabilities.imageInput so the `imageInput` floor
 * (apps/web/lib/routing/agent-capability-types.ts) can select a vision model
 * without any provider/model pin. Verified on-machine 2026-06-15: Gemma 4 12B
 * (ai/gemma4:12B) accepts OpenAI-compatible image_url content via Docker Model
 * Runner and returns accurate visual assessments. This is a prior — the
 * activation eval still measures and can correct it.
 */
export function detectLocalModelVision(modelId: string): boolean {
  const id = normalizeLocalModelId(modelId);
  // Embedding models are never vision-routable, regardless of name.
  if (/embed|nomic|bge|e5-|gte-/.test(id)) return false;
  return /gemma4|gemma-4|gemma3n|gemma-3n|llava|moondream|pixtral|minicpm-v|[-/]vl\b|-vl[-:]|vision/.test(
    id,
  );
}

/**
 * Best-effort detection of audio-input local models (ASR / audio understanding),
 * orthogonal to the text/tool family. Drives ModelProfile.capabilities.audioInput
 * so the `audioInput` floor can select an audio-capable model with no pin.
 * Verified on-machine 2026-06-15: Gemma 4 12B (ai/gemma4:12B) transcribes a wav
 * via OpenAI-compatible input_audio content on Docker Model Runner. Prior only —
 * the activation eval still measures and can correct it.
 */
export function detectLocalModelAudio(modelId: string): boolean {
  const id = normalizeLocalModelId(modelId);
  if (/embed|nomic|bge|e5-|gte-/.test(id)) return false;
  // The bare `omni` alternative already matches Qwen-Omni ("qwen…-omni…"); a
  // separate `qwen.*omni` would only add polynomial backtracking with no extra
  // coverage (CodeQL js/polynomial-redos), so it is intentionally omitted.
  return /gemma4|gemma-4|gemma3n|gemma-3n|whisper|omni|[-/]audio\b|voxtral|ultravox/.test(
    id,
  );
}

/**
 * Input modalities a local model accepts, derived from its capability prior.
 * Always includes "text"; adds "image"/"audio" for multimodal-IN models. Used by
 * the seed to populate ModelProfile.inputModalities/supportedModalities.
 */
/**
 * Output modalities a local model produces, derived from its id.
 *
 * Embedding models emit `["embeddings"]` — the modality-based branch of
 * `classifyModel` (apps/web/lib/routing/model-classifier.ts) keys off exactly
 * that to return modelClass="embedding". The DMR/Ollama discovery adapter used
 * to hardcode `["text"]` here, and DMR advertises no modality metadata of its
 * own, so `nomic-embed-text` was registered with modelClass="chat". Routing then
 * treated an embeddings-only runner as a chat endpoint; llama.cpp answers such a
 * request with HTTP 500 "the current context does not logits computation" and
 * the fallback chain surfaced it as the generic "No AI model can handle this
 * request right now" coworker error. `isEmbedding` is the same prior that
 * already drives supportsToolUse=false, so the two can no longer disagree.
 */
export function localOutputModalities(modelId: string): string[] {
  return detectLocalModelFamily(modelId) === "embedding" ? ["embeddings"] : ["text"];
}

export function localInputModalities(prior: LocalModelCapabilityPrior): string[] {
  const mods = ["text"];
  if (prior.supportsVision) mods.push("image");
  if (prior.supportsAudio) mods.push("audio");
  return mods;
}

/**
 * Derive a capability prior for a local model id. Pure — no DB, no network.
 * The numbers are deliberately coarse: they only need to be *good enough to
 * route* until the deterministic eval measures the real model.
 */
export function deriveLocalModelCapabilityPrior(modelId: string): LocalModelCapabilityPrior {
  const normalizedId = normalizeLocalModelId(modelId);
  const base = isBundledQwen38Model(normalizedId)
    ? bundledQwen38Prior()
    : derivePriorBase(modelId);
  return {
    ...base,
    // Vision/audio are orthogonal to the text/tool family; embedding models are
    // never multimodal-routable. Bootstrap priors — the activation eval calibrates.
    supportsVision: base.isEmbedding ? false : detectLocalModelVision(modelId),
    supportsAudio: base.isEmbedding ? false : detectLocalModelAudio(modelId),
  };
}

/**
 * The consumer image provisions this exact model. Its provisional floor is
 * intentionally model-specific: fresh installs must remain routable while the
 * durable eval queue catches up, without overstating smaller generic Qwen models.
 */
function isBundledQwen38Model(normalizedId: string): boolean {
  return normalizedId.includes("ggml-org/qwen3.8-27b-gguf");
}

function bundledQwen38Prior(): Omit<LocalModelCapabilityPrior, "supportsVision" | "supportsAudio"> {
  return {
    isEmbedding: false,
    capabilityCategory: "standard",
    supportsToolUse: true,
    reasoning: 85,
    codegen: 85,
    toolFidelity: 85,
    instructionFollowingScore: 78,
    structuredOutputScore: 85,
    conversational: 75,
    contextRetention: 70,
    bestFor: ["reasoning", "coding", "tool-use", "general"],
    avoidFor: [],
  };
}

/** Family-keyed text/tool capability base (vision/audio added by the wrapper above). */
function derivePriorBase(modelId: string): Omit<LocalModelCapabilityPrior, "supportsVision" | "supportsAudio"> {
  const family = detectLocalModelFamily(modelId);
  switch (family) {
    case "embedding":
      return {
        isEmbedding: true,
        capabilityCategory: "embedding",
        supportsToolUse: false,
        reasoning: 0, codegen: 0, toolFidelity: 0,
        instructionFollowingScore: 0, structuredOutputScore: 0,
        conversational: 0, contextRetention: 0,
        bestFor: ["embedding", "retrieval"],
        avoidFor: ["conversation", "tool-use", "reasoning"],
      };
    case "qwen-coder":
      return {
        isEmbedding: false, capabilityCategory: "standard", supportsToolUse: true,
        reasoning: 68, codegen: 82, toolFidelity: 80,
        instructionFollowingScore: 78, structuredOutputScore: 80,
        conversational: 60, contextRetention: 55,
        bestFor: ["coding", "tool-use", "general"], avoidFor: [],
      };
    case "qwen":
      // Qwen3/3.6: the DPF-preferred local tier (strong tool-calling, F1 0.93+).
      return {
        isEmbedding: false, capabilityCategory: "standard", supportsToolUse: true,
        reasoning: 70, codegen: 65, toolFidelity: 80,
        instructionFollowingScore: 78, structuredOutputScore: 78,
        conversational: 65, contextRetention: 55,
        bestFor: ["tool-use", "conversation", "general"], avoidFor: [],
      };
    case "gemma":
      // Verified: Gemma emits clean, valid tool_calls via Docker Model Runner.
      return {
        isEmbedding: false, capabilityCategory: "standard", supportsToolUse: true,
        reasoning: 55, codegen: 45, toolFidelity: 65,
        instructionFollowingScore: 65, structuredOutputScore: 60,
        conversational: 70, contextRetention: 45,
        bestFor: ["conversation", "tool-use", "general"], avoidFor: [],
      };
    case "magistral":
      // Reasoning model: emits <think> monologue and tends to fabricate rather
      // than emit a tool_call. Low tool prior; the eval confirms or corrects.
      return {
        isEmbedding: false, capabilityCategory: "basic", supportsToolUse: true,
        reasoning: 68, codegen: 40, toolFidelity: 30,
        instructionFollowingScore: 50, structuredOutputScore: 40,
        conversational: 55, contextRetention: 50,
        bestFor: ["reasoning"], avoidFor: ["tool-use", "agentic-tasks"],
      };
    case "mistral":
      return {
        isEmbedding: false, capabilityCategory: "basic", supportsToolUse: true,
        reasoning: 55, codegen: 50, toolFidelity: 50,
        instructionFollowingScore: 58, structuredOutputScore: 52,
        conversational: 60, contextRetention: 45,
        bestFor: ["conversation", "general"], avoidFor: [],
      };
    case "llama":
      return {
        isEmbedding: false, capabilityCategory: "basic", supportsToolUse: true,
        reasoning: 52, codegen: 45, toolFidelity: 50,
        instructionFollowingScore: 55, structuredOutputScore: 50,
        conversational: 60, contextRetention: 45,
        bestFor: ["conversation", "general"], avoidFor: [],
      };
    case "phi":
    case "deepseek":
      return {
        isEmbedding: false, capabilityCategory: "basic", supportsToolUse: true,
        reasoning: 58, codegen: 60, toolFidelity: 45,
        instructionFollowingScore: 55, structuredOutputScore: 52,
        conversational: 55, contextRetention: 45,
        bestFor: ["coding", "general"], avoidFor: [],
      };
    case "unknown":
    default:
      // Conservative prior for an unrecognized local model. Above the old flat
      // 20 so a capable-but-unknown model is not excluded outright, but low
      // confidence so the deterministic eval corrects it quickly.
      return {
        isEmbedding: false, capabilityCategory: "basic", supportsToolUse: true,
        reasoning: 40, codegen: 35, toolFidelity: 40,
        instructionFollowingScore: 50, structuredOutputScore: 40,
        conversational: 55, contextRetention: 40,
        bestFor: ["conversation", "general"], avoidFor: [],
      };
  }
}
