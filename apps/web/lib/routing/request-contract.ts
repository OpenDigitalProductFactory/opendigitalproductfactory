/**
 * EP-INF-005a: RequestContract type and deterministic contract inference.
 *
 * A RequestContract captures everything the routing pipeline needs to know
 * about an incoming request — modalities, tool requirements, token budget,
 * sensitivity, latency constraints — without referencing any specific model
 * or endpoint. The `inferContract()` function builds one deterministically
 * from the raw request context.
 *
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md
 */

import { randomUUID } from "crypto";
import type { ModelClass } from "./model-card-types";

// ── RequestContract type ────────────────────────────────────────────────────

export interface RequestContract {
  // ── Identity ───────────────────────────────────────────────────
  contractId: string;
  contractFamily: string; // "sync.tool_action", "sync.code_gen", etc.
  taskType: string;       // legacy task type, retained for backward compat

  // ── Modality ───────────────────────────────────────────────────
  modality: {
    input: Array<"text" | "image" | "audio" | "file" | "video">;
    output: Array<"text" | "json" | "image" | "audio" | "tool_call">;
  };

  // ── Interaction ────────────────────────────────────────────────
  interactionMode: "sync" | "background" | "batch";
  sensitivity: "public" | "internal" | "confidential" | "restricted";

  // ── Hard Requirements ──────────────────────────────────────────
  requiresTools: boolean;
  requiresStrictSchema: boolean;
  requiresStreaming: boolean;
  requiresCodeExecution?: boolean;
  requiresWebSearch?: boolean;
  requiresComputerUse?: boolean;

  // ── Token Estimates ────────────────────────────────────────────
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  minContextTokens?: number;

  // ── Quality/Cost Posture ───────────────────────────────────────
  reasoningDepth: "minimal" | "low" | "medium" | "high";
  budgetClass: "minimize_cost" | "balanced" | "quality_first";

  // ── Constraints ────────────────────────────────────────────────
  maxLatencyMs?: number;
  allowedProviders?: string[];
  residencyPolicy?: "local_only" | "approved_cloud" | "any_enabled";

  // ── EP-INF-009c: Model class constraint ───────────────────────
  /** When set, only endpoints with this modelClass are eligible.
   *  When absent, defaults to chat/reasoning filter. */
  requiredModelClass?: ModelClass;
}

// ── Reasoning depth defaults per task type ──────────────────────────────────

// ── EP-INF-009c: Task type → required model class mapping ────────────────

const TASK_MODEL_CLASS: Record<string, ModelClass> = {
  "image-gen": "image_gen",
  "embedding": "embedding",
  "transcription": "audio",
};

// ── Reasoning depth defaults per task type ──────────────────────────────────

const DEFAULT_REASONING_DEPTH: Record<string, RequestContract["reasoningDepth"]> = {
  "greeting": "minimal",
  "status-query": "low",
  "summarization": "low",
  "web-search": "low",
  "creative": "medium",
  "data-extraction": "medium",
  "code-gen": "medium",
  "tool-action": "medium",
  "reasoning": "high",
  "onboarding": "minimal",
};

// ── Input modality types we scan for in multimodal content arrays ────────

const MULTIMODAL_INPUT_TYPES = new Set<string>(["image", "audio", "file", "video"]);

// ── Contract inference ──────────────────────────────────────────────────────

export async function inferContract(
  taskType: string,
  messages: Array<{ role: string; content: unknown }>,
  tools?: Array<Record<string, unknown>>,
  outputSchema?: Record<string, unknown>,
  routeContext?: {
    sensitivity?: string;
    interactionMode?: string;
    maxLatencyMs?: number;
    budgetClass?: string;
    residencyPolicy?: string;
    allowedProviders?: string[];
    requiresCodeExecution?: boolean;
    requiresWebSearch?: boolean;
    requiresComputerUse?: boolean;
    requiredModelClass?: ModelClass;
  },
): Promise<RequestContract> {
  // ── Deterministic flags ─────────────────────────────────────────────────
  const requiresTools = tools !== undefined && tools.length > 0;
  const requiresStrictSchema = outputSchema !== undefined;

  // ── Interaction mode ────────────────────────────────────────────────────
  const interactionMode = (routeContext?.interactionMode ?? "sync") as
    RequestContract["interactionMode"];

  // ── Streaming: default true for sync chat, false for non-chat/background ──
  const requiresStreaming = interactionMode === "sync" && !routeContext?.requiredModelClass && !TASK_MODEL_CLASS[taskType];

  // ── Capability requirements ────────────────────────────────────────────
  const requiresCodeExecution = routeContext?.requiresCodeExecution === true;
  const requiresWebSearch = taskType === "web-search" || routeContext?.requiresWebSearch === true;
  const requiresComputerUse = routeContext?.requiresComputerUse === true;

  // ── Input modality detection ──────────────────────────────────────────
  const inputModalities = new Set<"text" | "image" | "audio" | "file" | "video">(["text"]);

  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          MULTIMODAL_INPUT_TYPES.has(part.type as string)
        ) {
          inputModalities.add(part.type as "image" | "audio" | "file" | "video");
        }
      }
    }
  }

  // ── EP-INF-009c: Model class from task type or explicit override ────
  const requiredModelClass = routeContext?.requiredModelClass ?? TASK_MODEL_CLASS[taskType];

  // ── Output modality ───────────────────────────────────────────────────
  let outputModalities: Array<"text" | "json" | "image" | "audio" | "tool_call">;

  if (requiredModelClass === "image_gen") {
    outputModalities = ["image"];
  } else if (requiredModelClass === "embedding") {
    outputModalities = ["json"]; // vector data
  } else if (requiresStrictSchema) {
    outputModalities = ["json"];
  } else if (requiresTools) {
    outputModalities = ["text", "tool_call"];
  } else {
    outputModalities = ["text"];
  }

  // ── Token estimation ──────────────────────────────────────────────────
  let estimatedInputTokens = 0;

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      estimatedInputTokens += Math.floor(msg.content.length / 4);
    } else if (Array.isArray(msg.content)) {
      // Rough estimate for multimodal content arrays
      estimatedInputTokens += 1000;
    }
  }

  const estimatedOutputTokens = 500;
  const minContextTokens = Math.floor(estimatedInputTokens * 1.5);

  // ── Sensitivity & budget ──────────────────────────────────────────────
  const sensitivity = (routeContext?.sensitivity ?? "internal") as
    RequestContract["sensitivity"];

  const budgetClass = (routeContext?.budgetClass ?? "balanced") as
    RequestContract["budgetClass"];

  // ── Reasoning depth ───────────────────────────────────────────────────
  const reasoningDepth = DEFAULT_REASONING_DEPTH[taskType] ?? "medium";

  // ── Contract family ───────────────────────────────────────────────────
  const contractFamily = `${interactionMode}.${taskType}`;

  // ── Assemble ──────────────────────────────────────────────────────────
  const contract: RequestContract = {
    contractId: randomUUID(),
    contractFamily,
    taskType,

    modality: {
      input: Array.from(inputModalities),
      output: outputModalities,
    },

    interactionMode,
    sensitivity,

    requiresTools,
    requiresStrictSchema,
    requiresStreaming,
    ...(requiresCodeExecution && { requiresCodeExecution }),
    ...(requiresWebSearch && { requiresWebSearch }),
    ...(requiresComputerUse && { requiresComputerUse }),

    estimatedInputTokens,
    estimatedOutputTokens,
    minContextTokens,

    reasoningDepth,
    budgetClass,

    ...(requiredModelClass ? { requiredModelClass } : {}),
  };

  // ── Optional fields from routeContext ──────────────────────────────────
  if (routeContext?.maxLatencyMs !== undefined) {
    contract.maxLatencyMs = routeContext.maxLatencyMs;
  }
  if (routeContext?.allowedProviders !== undefined) {
    contract.allowedProviders = routeContext.allowedProviders;
  }
  if (routeContext?.residencyPolicy !== undefined) {
    contract.residencyPolicy = routeContext.residencyPolicy as
      RequestContract["residencyPolicy"];
  }

  return contract;
}
