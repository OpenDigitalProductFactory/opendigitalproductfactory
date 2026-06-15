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
  if (/qwen.*coder|coder.*qwen/.test(id)) return "qwen-coder";
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
 * Derive a capability prior for a local model id. Pure — no DB, no network.
 * The numbers are deliberately coarse: they only need to be *good enough to
 * route* until the deterministic eval measures the real model.
 */
export function deriveLocalModelCapabilityPrior(modelId: string): LocalModelCapabilityPrior {
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
