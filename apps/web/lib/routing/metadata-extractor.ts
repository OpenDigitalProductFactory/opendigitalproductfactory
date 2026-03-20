/**
 * EP-INF-002: Extract structured metadata from DiscoveredModel.rawMetadata.
 * Each provider returns different response shapes — this normalizes them.
 */

export interface ExtractedMetadata {
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  inputPricePerMToken: number | null;
  outputPricePerMToken: number | null;
  supportsToolUse: boolean | null;
  supportsStructuredOutput: boolean | null;
  inputModalities: string[];
  outputModalities: string[];
}

const EMPTY: ExtractedMetadata = {
  maxContextTokens: null,
  maxOutputTokens: null,
  inputPricePerMToken: null,
  outputPricePerMToken: null,
  supportsToolUse: null,
  supportsStructuredOutput: null,
  inputModalities: ["text"],
  outputModalities: ["text"],
};

/**
 * Extract normalized metadata from a provider's raw model response.
 */
export function extractModelMetadata(
  providerId: string,
  modelId: string,
  rawMetadata: unknown,
): ExtractedMetadata {
  const raw = rawMetadata as Record<string, unknown>;
  if (!raw || typeof raw !== "object") return { ...EMPTY };

  // Detect format by provider or response shape
  if (providerId === "ollama") return extractOllama(raw);
  if (providerId === "gemini" || providerId.startsWith("gemini")) return extractGemini(raw);
  if (raw.context_length !== undefined || raw.pricing !== undefined) return extractOpenRouter(raw);
  if (raw.inputTokenLimit !== undefined) return extractGemini(raw);
  return { ...EMPTY };
}

function extractOpenRouter(raw: Record<string, unknown>): ExtractedMetadata {
  const pricing = raw.pricing as Record<string, string> | undefined;
  const supportedParams = raw.supported_parameters as string[] | undefined;
  const arch = raw.architecture as Record<string, string> | undefined;

  // Parse modalities from "text+image->text" format
  const modality = arch?.modality ?? "text->text";
  const [inputMod, outputMod] = modality.split("->");
  const inputModalities = (inputMod ?? "text").split("+").map((m) => m.trim());
  const outputModalities = (outputMod ?? "text").split("+").map((m) => m.trim());

  return {
    maxContextTokens: typeof raw.context_length === "number" ? raw.context_length : null,
    maxOutputTokens: null, // OpenRouter doesn't expose this per-model
    inputPricePerMToken: pricing?.prompt ? parseFloat(pricing.prompt) * 1e6 : null,
    outputPricePerMToken: pricing?.completion ? parseFloat(pricing.completion) * 1e6 : null,
    supportsToolUse: supportedParams?.includes("tools") ?? null,
    supportsStructuredOutput: supportedParams?.includes("structured_outputs") ?? null,
    inputModalities,
    outputModalities,
  };
}

function extractGemini(raw: Record<string, unknown>): ExtractedMetadata {
  const methods = raw.supportedGenerationMethods as string[] | undefined;
  return {
    maxContextTokens: typeof raw.inputTokenLimit === "number" ? raw.inputTokenLimit : null,
    maxOutputTokens: typeof raw.outputTokenLimit === "number" ? raw.outputTokenLimit : null,
    inputPricePerMToken: null,
    outputPricePerMToken: null,
    supportsToolUse: methods?.includes("generateContent") ?? null,
    supportsStructuredOutput: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
  };
}

function extractOllama(raw: Record<string, unknown>): ExtractedMetadata {
  return {
    maxContextTokens: null, // Ollama doesn't report this in /api/tags
    maxOutputTokens: null,
    inputPricePerMToken: 0, // Local — free
    outputPricePerMToken: 0,
    supportsToolUse: null, // Depends on model, not reliably in metadata
    supportsStructuredOutput: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
  };
}
