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
import { classifyTask } from "./task-classifier";
import type { TaskRequirement } from "./task-router-types";
import type { SensitivityLevel } from "./types";

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
  sensitivity: SensitivityLevel;

  // ── Hard Requirements ──────────────────────────────────────────
  requiresTools: boolean;
  /** Caller requirement must constrain selection before the dispatch override. */
  toolChoice?: import("./recipe-types").RoutedExecutionPlan["toolPolicy"]["toolChoice"];
  terminalWriterToolName?: string;
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
  deniedProviders?: string[];
  residencyPolicy?: "local_only" | "approved_cloud" | "any_enabled";
  /** Account-scoped router obligations compiled by provider suitability. */
  openRouterObligations?: import("./provider-suitability/types").OpenRouterPolicyObligations;

  // ── EP-INF-009c: Model class constraint ───────────────────────
  /** When set, only endpoints with this modelClass are eligible.
   *  When absent, defaults to chat/reasoning filter. */
  requiredModelClass?: ModelClass;

  // ── EP-SELF-DEV-005: Per-agent minimum dimension thresholds ──
  /** Minimum dimension scores (0-100) the model must meet.
   *  Models below any threshold get successProbability = 0. */
  minimumDimensions?: Record<string, number>;
  // EP-AGENT-CAP-002: Agent-level capability floor — hard filter in Stage 1 routing.
  // Set from AgentModelConfig.minimumCapabilities. Null = no agent-level floor.
  minimumCapabilities?: import("./agent-capability-types").AgentMinimumCapabilities;
  // EP-AGENT-CAP-002: Minimum context window for RAG injection.
  // Set from AgentModelConfig.minimumContextTokens. Merged with minContextTokens (stricter wins).
  agentMinimumContextTokens?: number;
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
// Maps a content-block `type` to the input modality it implies. Covers BOTH
// conventions in use: Anthropic-style blocks (`image`/`audio`) and the
// OpenAI/wire-form blocks the ChatMessage ContentBlock actually carries
// (`image_url`/`input_audio`). Without the latter a pasted screenshot would not
// raise the image modality and could route to a text-only endpoint.
const BLOCK_TYPE_TO_MODALITY: Record<string, "image" | "audio" | "file" | "video"> = {
  image: "image",
  image_url: "image",
  audio: "audio",
  input_audio: "audio",
  file: "file",
  video: "video",
};

function normalizeProviderIds(providerIds: string[]): string[] {
  return [...new Set(providerIds.map((providerId) => providerId.trim()).filter(Boolean))].sort();
}

// ── Contract inference ──────────────────────────────────────────────────────

export type RequestRouteContext = {
  sensitivity?: RequestContract["sensitivity"];
  interactionMode?: RequestContract["interactionMode"];
  maxLatencyMs?: number;
  budgetClass?: RequestContract["budgetClass"];
  residencyPolicy?: RequestContract["residencyPolicy"];
  allowedProviders?: string[];
  deniedProviders?: string[];
  openRouterObligations?: import("./provider-suitability/types").OpenRouterPolicyObligations;
  requiresCodeExecution?: boolean;
  requiresWebSearch?: boolean;
  requiresComputerUse?: boolean;
  requiredModelClass?: ModelClass;
  reasoningDepth?: RequestContract["reasoningDepth"];
  minimumTier?: string;
  minimumDimensions?: Record<string, number>;
};

export async function inferContract(
  taskType: string,
  messages: Array<{ role: string; content: unknown }>,
  tools?: Array<Record<string, unknown>>,
  outputSchema?: Record<string, unknown>,
  routeContext?: RequestRouteContext,
  taskRequirement?: TaskRequirement | null,
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
  //
  // Note: "requiresWebSearch" is the NATIVE capability (e.g. Gemini search-
  // grounding, OpenAI web_search tool built into the provider). A task type
  // of "web-search" does NOT automatically need this — almost every model
  // can perform web search when given an MCP search tool, and the contract
  // already demands `toolUse` for web-search via BUILT_IN_TASK_REQUIREMENTS.
  // Only set requiresWebSearch when the caller explicitly asks for native
  // grounding, otherwise the hard filter excludes every model that doesn't
  // declare capabilities.webSearch (which is virtually all of them).
  const requiresCodeExecution = routeContext?.requiresCodeExecution === true;
  const requiresWebSearch = routeContext?.requiresWebSearch === true;
  const requiresComputerUse = routeContext?.requiresComputerUse === true;

  // ── Input modality detection ──────────────────────────────────────────
  const inputModalities = new Set<"text" | "image" | "audio" | "file" | "video">(["text"]);

  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && typeof part === "object" && "type" in part) {
          const modality = BLOCK_TYPE_TO_MODALITY[(part as { type: string }).type];
          if (modality) inputModalities.add(modality);
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

  // Load the task requirement once (DB-backed, in-memory cached, with a built-in
  // fallback). It is the "demand side" of the use-case → routing-policy matrix:
  // it supplies the tier floor (below) plus routing-posture defaults (budget class,
  // reasoning depth, residency) so the matrix is load-bearing, not advisory.
  // Dynamic import mirrors the tier-floor lookup and avoids a static import cycle.
  let taskReq: TaskRequirement | undefined;
  if (taskRequirement === undefined) {
    try {
      const { getTaskRequirement } = await import("./task-requirements");
      taskReq = await getTaskRequirement(taskType);
    } catch {
      taskReq = undefined;
    }
  } else {
    taskReq = taskRequirement ?? undefined;
  }

  // budgetClass: explicit caller override wins, then the task requirement's
  // default, then "balanced". Existing task types set no default, so their
  // behaviour is unchanged; email-* requirements default to minimize_cost.
  const budgetClass = (routeContext?.budgetClass ?? taskReq?.budgetClassDefault ?? "balanced") as
    RequestContract["budgetClass"];

  // ── Reasoning depth ───────────────────────────────────────────────────
  // Requirement default wins, then the per-task-type heuristic. BI-08CE1ADF:
  // when the task type carries NO declared depth (e.g. the ubiquitous default
  // taskType "conversation", which maps to nothing), classify the prompt
  // CONTENT instead of falling through to a blanket "medium" — DPF's analogue
  // of Perplexity's "Best" auto-router. This only affects task types that were
  // already hitting the neutral default; every mapped type is unchanged.
  const reasoningDepth = (
    routeContext?.reasoningDepth ??
    taskReq?.reasoningDepthDefault ??
    DEFAULT_REASONING_DEPTH[taskType] ??
    classifyTask(messages).reasoningDepth
  ) as RequestContract["reasoningDepth"];

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
    contract.allowedProviders = normalizeProviderIds(routeContext.allowedProviders);
  }
  if (routeContext?.deniedProviders !== undefined) {
    contract.deniedProviders = normalizeProviderIds(routeContext.deniedProviders);
  }
  if (routeContext?.openRouterObligations !== undefined) {
    contract.openRouterObligations = routeContext.openRouterObligations;
  }
  // residencyPolicy: caller override wins, else the task requirement's policy
  // (e.g. email triage hardened to "local_only" by an operator). Unset when
  // neither is present, preserving the prior no-constraint default.
  const residencyPolicy = routeContext?.residencyPolicy ?? taskReq?.residencyPolicy;
  if (residencyPolicy !== undefined) {
    contract.residencyPolicy = residencyPolicy as RequestContract["residencyPolicy"];
  }

  // ── Tier floor from task requirements ───────────────────────────────────
  // BUILT_IN_TASK_REQUIREMENTS (and the DB-overridable TaskRequirement table
  // below) sets a `minimumTier` per task type — "code-gen" is frontier,
  // "summarization" is adequate, etc. That tier choice encodes a dimension-
  // score floor (TIER_MINIMUM_DIMENSIONS). Translate it into contract.
  // minimumDimensions so pipeline-v2's hard filter excludes anything that
  // doesn't meet the floor, and cost-per-success ranking can't route a
  // frontier task to a strong-tier model just because it's cheaper.
  try {
    const { TIER_MINIMUM_DIMENSIONS, isValidTier } = await import("./quality-tiers");
    const tier = taskReq?.minimumTier;
    if (tier && isValidTier(tier)) {
      const tierFloor = TIER_MINIMUM_DIMENSIONS[tier];
      if (Object.keys(tierFloor).length > 0) {
        contract.minimumDimensions = {
          ...tierFloor,
          ...(contract.minimumDimensions ?? {}),
        };
      }
    }
    // EP-GOLDEN-TRIANGLE Slice 3: a posture/caller may RAISE the floor (stricter
    // wins, per-dimension max). Only runs when the caller supplies an override,
    // so existing callers (no routeContext.minimumTier/minimumDimensions) are
    // byte-for-byte unaffected.
    const callerTier = routeContext?.minimumTier;
    const callerDims: Record<string, number> = {
      ...(callerTier && isValidTier(callerTier) ? TIER_MINIMUM_DIMENSIONS[callerTier] : {}),
      ...(routeContext?.minimumDimensions ?? {}),
    };
    if (Object.keys(callerDims).length > 0) {
      const merged: Record<string, number> = { ...(contract.minimumDimensions ?? {}) };
      for (const [key, value] of Object.entries(callerDims)) {
        merged[key] = Math.max(merged[key] ?? 0, value);
      }
      contract.minimumDimensions = merged;
    }
  } catch {
    // Non-fatal: if the tier lookup fails, contract continues without
    // a tier floor (defaulting to existing behaviour).
  }

  return contract;
}
