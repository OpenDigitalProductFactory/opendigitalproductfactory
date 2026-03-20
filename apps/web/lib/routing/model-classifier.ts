import type { ModelClass } from "./model-card-types";

/**
 * EP-INF-003: Classify a model by type based on modalities and ID patterns.
 * Modality-based rules take priority over ID-based fallbacks.
 */
export function classifyModel(
  modelId: string,
  modalities: { input: string[]; output: string[] },
): ModelClass {
  const out = modalities.output;

  // Modality-based (authoritative when available)
  if (out.includes("embeddings") && out.length === 1) return "embedding";
  if (out.includes("image") && !out.includes("text")) return "image_gen";
  if (out.includes("audio") && !out.includes("text")) return "speech";
  if (out.includes("video")) return "video";

  // ID-based fallbacks for providers with poor modality data
  if (/^(o1|o3|o4|deepseek-r1)/i.test(modelId)) return "reasoning";
  if (/^text-embedding/i.test(modelId)) return "embedding";
  if (/^dall-e/i.test(modelId)) return "image_gen";
  if (/^tts-/i.test(modelId)) return "speech";
  if (/^whisper/i.test(modelId)) return "audio";
  if (/^omni-moderation/i.test(modelId)) return "moderation";
  if (/^codex/i.test(modelId)) return "code";

  return "chat";
}
