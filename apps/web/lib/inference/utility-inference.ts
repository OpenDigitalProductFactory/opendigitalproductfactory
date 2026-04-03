// apps/web/lib/inference/utility-inference.ts
//
// EP-INF-UTIL-001: Utility inference tier for commoditized AI operations.
// Uses local models (Docker Model Runner) for background data preparation:
// summarization, extraction, classification, compression, abstracting.
// Write-time, not read-time — outputs are stored alongside source data.

import { countTokens } from "@/lib/tak/context-arbitrator";
import {
  utilityInferenceOps,
  utilityInferenceLatency,
} from "@/lib/operate/metrics";

// ─── Types ──────────────────────────────────────────────────────────────────

export type UtilityTask =
  | "summarize"
  | "extract_key_points"
  | "classify"
  | "compress"
  | "generate_abstract"
  | "detect_drift"
  | "extract_metadata";

export type UtilityInferenceResult = {
  output: string;
  modelId: string;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs: number;
  fallback: boolean;
};

// ─── Task Templates ─────────────────────────────────────────────────────────

const TASK_TEMPLATES: Record<UtilityTask, string> = {
  summarize:
    "Summarize the following text in 1-3 sentences. Be concise and preserve key facts. Output only the summary, nothing else.",
  extract_key_points:
    "Extract 5-10 key points from the following text as a bullet list. Each point should be one sentence. Output only the bullet list.",
  classify:
    'Classify the following text. Output a JSON object with "category" (one of: process, policy, decision, how-to, reference, troubleshooting, runbook) and "tags" (array of 3-5 relevant keywords). Output only the JSON.',
  compress:
    "Compress the following data into a brief summary paragraph. Include counts, status distribution, and key metrics. Output only the summary paragraph.",
  generate_abstract:
    "Write a one-line abstract (under 20 words) for the following article. Output only the abstract.",
  detect_drift:
    "Compare the article content against the recent changes described below. Rate drift risk as low/medium/high and explain in one sentence. Output only the rating and explanation.",
  extract_metadata:
    "Extract structured data from the following text. Output a JSON object with any names, dates, amounts, identifiers, and categories found.",
};

// ─── Input Size Limits (tokens) ─────────────────────────────────────────────

const INPUT_LIMITS: Record<UtilityTask, number> = {
  summarize: 2000,
  extract_key_points: 3000,
  classify: 1000,
  compress: 2000,
  generate_abstract: 2000,
  detect_drift: 2000,
  extract_metadata: 1000,
};

// ─── Quality Validation ─────────────────────────────────────────────────────

function validateOutput(task: UtilityTask, output: string, input: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  switch (task) {
    case "summarize":
      if (trimmed.length < 10 || trimmed.length > 2000) return null;
      return trimmed;

    case "extract_key_points":
      if (!trimmed.includes("-") && !trimmed.includes("*") && !trimmed.includes("1")) return null;
      return trimmed;

    case "classify":
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.category === "string") return trimmed;
      } catch { /* fall through */ }
      return null;

    case "compress":
      if (trimmed.length >= input.length) return null;
      if (trimmed.length < 10) return null;
      return trimmed;

    case "generate_abstract":
      if (trimmed.length > 200) return null;
      if (trimmed.length < 5) return null;
      return trimmed;

    case "detect_drift": {
      const lower = trimmed.toLowerCase();
      if (lower.includes("low") || lower.includes("medium") || lower.includes("high")) return trimmed;
      return null;
    }

    case "extract_metadata":
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch {
        return null;
      }

    default:
      return trimmed;
  }
}

// ─── Truncation Fallback ────────────────────────────────────────────────────

function truncationFallback(task: UtilityTask, input: string): string {
  switch (task) {
    case "summarize":
    case "compress":
      return input.slice(0, 800);
    case "extract_key_points":
      return input.slice(0, 1600);
    case "generate_abstract":
      return input.slice(0, 80);
    case "classify":
      return "";
    case "detect_drift":
      return "unknown";
    case "extract_metadata":
      return "{}";
    default:
      return input.slice(0, 400);
  }
}

// ─── Main Function ──────────────────────────────────────────────────────────

/**
 * Run a utility inference operation using the cheapest available model.
 * Prefers local Docker Model Runner, falls back to cloud, then to truncation.
 *
 * This is a write-time function — call during publish, upload, or transition,
 * never in the conversation loop.
 */
export async function utilityInfer(params: {
  task: UtilityTask;
  input: string;
  maxOutputTokens?: number;
  context?: string;
}): Promise<UtilityInferenceResult> {
  const start = Date.now();
  const template = TASK_TEMPLATES[params.task];
  const limit = INPUT_LIMITS[params.task];

  // Truncate input to model context window limits
  let input = params.input;
  if (countTokens(input) > limit) {
    input = input.slice(0, limit * 4); // ~4 chars per token
  }

  if (params.context) {
    input += `\n\n---\nContext:\n${params.context}`;
  }

  // Attempt inference via routed pipeline
  try {
    const { routeAndCall } = await import("@/lib/inference/routed-inference");

    const result = await Promise.race([
      routeAndCall(
        [{ role: "user", content: input }],
        template,
        "internal",
        {
          taskType: `utility_${params.task}`,
          budgetClass: "minimize_cost",
          persistDecision: false,
        },
      ),
      // 10-second timeout — utility ops should be fast
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("utility inference timeout")), 10_000),
      ),
    ]);

    const validated = validateOutput(params.task, result.content, input);
    const inferenceMs = Date.now() - start;

    if (validated) {
      utilityInferenceOps.inc({ task: params.task, status: "success", provider: result.providerId });
      utilityInferenceLatency.observe({ task: params.task, provider: result.providerId }, inferenceMs / 1000);

      return {
        output: validated,
        modelId: result.modelId,
        providerId: result.providerId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        inferenceMs,
        fallback: false,
      };
    }

    // Validation failed — use truncation fallback
    utilityInferenceOps.inc({ task: params.task, status: "fallback", provider: result.providerId });

    return {
      output: truncationFallback(params.task, params.input),
      modelId: result.modelId,
      providerId: result.providerId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      inferenceMs: Date.now() - start,
      fallback: true,
    };
  } catch (err) {
    // All inference failed — pure truncation
    utilityInferenceOps.inc({ task: params.task, status: "error", provider: "none" });

    return {
      output: truncationFallback(params.task, params.input),
      modelId: "none",
      providerId: "none",
      inputTokens: 0,
      outputTokens: 0,
      inferenceMs: Date.now() - start,
      fallback: true,
    };
  }
}
