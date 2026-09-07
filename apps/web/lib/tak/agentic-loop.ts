// apps/web/lib/agentic-loop.ts
// Agentic execution loop: LLM calls tools iteratively until it responds with text only.
// This is the core behavioral difference between a chatbot and an agent.
import { routeAndCall, type RouteAndCallOptions, type RoutedInferenceResult } from "@/lib/routed-inference";
import type { DowngradeCause } from "@/lib/inference/downgrade-explanation";
import type { MessageOrigin } from "@/lib/inference/data-screening/types";
import {
  detectRepeatedToolCall,
  detectApproachingRepeatedToolCall,
  buildNoProgressNudgeMessage,
  recordRepeatedToolIssue,
} from "@/lib/tak/runtime-issues";
import { isRedundantReaskQuestion } from "@/lib/tak/conversation-intent";
import { PLATFORM_TOOLS, toolsToOpenAIFormat, type ToolDefinition, type ToolResult } from "@/lib/mcp-tools";
import { createAuthorizedSurfaceTurnGovernance } from "@/lib/coworker/authorized-surface-execution-context";
import { LOAD_TOOLS_TOOL_NAME } from "@/lib/tak/tool-intent";
import { DynamicToolSurface } from "@/lib/tak/dynamic-tool-surface";
import {
  classifyEvidenceRequirement,
  resolveEvidenceRecovery,
} from "@/lib/tak/evidence-requirement";
import { resolveRouteContext } from "@/lib/route-context-map";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { sanitizeForLog } from "@/lib/security/safe-log";
import { recordCoworkerTurnMetric } from "@/lib/operate/coworker-turn-metrics";
import type { ChatMessage } from "@/lib/ai-inference";
import type { ToolCallEntry } from "@/lib/routing/adapter-types";
import { prisma } from "@dpf/db";
import { interceptToolCallAsProposal } from "@/lib/proactivity/propose-interception";
import { agentEventBus } from "./agent-event-bus";
import { TIER_MINIMUM_DIMENSIONS, type QualityTier } from "../routing/quality-tiers";
import {
  DEFAULT_MINIMUM_CONTEXT_TOKENS,
  resolveTurnGroundedGuidanceRoute,
  resolveTurnMinimumCapabilities,
} from "@/lib/routing/agent-capability-types";
import { extractToolCalls } from "@/lib/routing/extract-tool-calls";
import type { AgentMinimumCapabilities } from "@/lib/routing/agent-capability-types";
import type { UserContext } from "@/lib/permissions";
import {
  type ExecutionPlan,
  EXECUTION_PLAN_TOOL_NAMES,
  executionPlanProviderTools,
  applyPlanToolCall,
  renderPlanReminder,
  renderNoPlanReminder,
  planCompletionGate,
  planProgress,
} from "./execution-plan";
import { persistExecutionPlan, loadExecutionPlan } from "./execution-plan-store";
import { estimateContextTokens, classifyContextPressure, deriveCompactionCaps } from "./context-pressure";
import { clampToolResultForModel, resolveToolResultCharCap } from "./tool-result-budget";
import { applyBacklogCreateClaimGuard } from "./backlog-create-claim-guard";
import { applyEscalationLadderGuard, buildHumanHandoff } from "./escalation-ladder";
import { logGeneratedProse } from "../prose/generated-prose"; // BI-41F15FD7
import { assessToolSurface, computeToolSelectionAccuracy, contextEconomyTurnMetricFields } from "./context-economy-metrics";
import { summarizeDroppedMessages } from "./compaction-digest";
import {
  detectToolRefusedDespiteAvailability,
  appendToolRefusedRecoveryMessages,
  classifyToolRefusedIssue,
} from "./tool-refused-recovery";
import {
  applyTerminalToolSurface,
  buildTerminalToolReminder,
  normalizeTerminalToolArguments,
  resolveTerminalTextExit,
  resolveTerminalToolCall,
  selectTerminalToolSurface,
  type TerminalToolPolicy,
} from "./terminal-tool-policy";
import { rotateTerminalWriterRoute } from "./terminal-writer-route";
export { detectToolRefusedDespiteAvailability } from "./tool-refused-recovery";

// Safety ceiling — the loop exits naturally when the model responds with text-only
// (no tool calls). This limit only catches true infinite loops from bugs.
// The actual guardrails are: sandbox circuit breaker, repetition detector, duration
// limits, and nudge caps. Not arbitrary iteration/inference caps.
const MAX_ITERATIONS = 200;

// ─── Duration limits by task type ──────────────────────────────────────────
// Tighter limits than before — runaway loops burned significant API budget.
// The orchestrator dispatches specialists in parallel; each specialist should
// complete a focused task quickly, not run for 10 minutes.

const MAX_DURATION_MS = 120_000;          // 2 min — normal conversation
const MAX_DURATION_BUILD_MS = 600_000;    // 10 min — sandbox code gen
const MAX_DURATION_PLAN_MS = 600_000;     // 10 min — ideate/plan (heavy research)
const MAX_DURATION_REVIEW_MS = 300_000;   // 5 min — review
const MAX_DURATION_SHIP_MS = 300_000;     // 5 min — ship
const MAX_AGENTIC_HISTORY_MESSAGES = 24;
const MAX_TOOL_RESULT_CHARS = 1_500;
const MAX_TEXT_MESSAGE_CHARS = 4_000;

// ─── Extracted for testability ──────────────────────────────────────────────

/** Determine whether the loop should nudge the model to use tools. */
const COMPLETION_CLAIM_PATTERN =
  /\b(built|deployed|shipped|created|implemented|saved|configured|tested|fixed|completed|installed|launched|starting up|initializing|applying|generating)\b|tests?\s+pass|plan(?:ning)?\s+(?:is\s+done|ready)|building\s+now|start\s+implementation/i;

// HARD completion claim: a first-person assertion that tool-backed work was
// actually persisted, published, sent, or scheduled — the kind of claim that
// MISLEADS a user if no tool ran ("I've saved your campaign brief", "it's now
// live", "added it to your approval queue"). This is narrower than
// COMPLETION_CLAIM_PATTERN (which also catches generic narration like
// "generating" / "applying"). On a conversational coworker route we never
// discard the model's advice over a fabrication signal, but when the reply
// makes one of THESE claims without a backing tool call we append an honest
// "not saved yet" note so the user is not misled. See buildUnsavedAdviceNote.
export const HARD_COMPLETION_CLAIM_PATTERN =
  /\bI(?:'ve| have| just)?\s*(?:have\s+)?(?:saved|created|published|posted|sent|scheduled|recorded|queued|logged|added|drafted and saved|placed)\b|\b(?:saved|published|posted|sent|scheduled|queued|added|recorded)\s+(?:it|that|your|the)\b|\b(?:is|are|has been|have been)\s+(?:now\s+)?(?:live|saved|published|sent|scheduled|posted|queued|recorded)\b|in\s+(?:your\s+)?approval\s+queue|\b(?:prospect\s+)?account\s+created\b|\bACCT-[A-Z0-9]{4,}\b/i;

// The dead-end classifier and its copy live in ./inference-dead-ends (BI-A89E4827).
import { describeToolRouteFailure, describeToolRouteFailureOutcome, type InferenceDeadEndOutcome } from "./inference-dead-ends";
import { usesGovernedReviewTools } from "./governed-review-tools";
export { describeToolRouteFailure };

// Narration patterns: agent describes code or announces intent instead of calling tools.
// Includes preamble narration ("Let me check", "I need to fix") and intent announcements
// ("I'd like to generate...", "I would like to call...") that precede but do not replace tool use.
const NARRATION_PATTERN =
  /(?:here(?:'s| is) (?:the |exactly |what )|code (?:to add|change|pattern)|add (?:this |the following )|insert (?:this |before )|exact (?:lines|code|changes)|manually|copy[- ]paste|I refined the plan|(?:let me|I (?:need to|should|will|'ll|can see)) (?:check|fix|add|read|look|verify|update|create|modify|examine|review|search|generate|call|run|fetch)|(?:I(?:'d| would) like to|I(?:'m going to| am going to)) (?:check|fix|add|read|look|verify|update|create|modify|examine|review|search|generate|call|run|fetch|use|get|pull|grab|query|scan|find|load|save|send))/i;

// Permission-seeking patterns: agent asks user to approve each step instead of acting.
// During build phases, the agent should proceed autonomously — not ask "should I?" every step.
export const PERMISSION_SEEKING_PATTERN = /(?:should I (?:proceed|continue|go ahead|fix|update|create|add|rewrite|investigate|check|try)|would you (?:like|prefer|want) me to|do you want me to|which (?:would you|do you) prefer|shall I|before I (?:proceed|continue)|want me to|ready for me to)/i;

// Frustration patterns: agent is spinning, apologizing, or hedging instead of acting.
// Inspired by Claude Code's ~20 frustration regexes (March 2026 source leak).
// Only checked in the no-tool-calls branch, so this won't fire when the agent
// is actively using tools and reporting on results.
export const FRUSTRATION_PATTERN = /(?:I (?:apologize|cannot|can't|am unable|don't have (?:access|the ability))|(?:unfortunately|regrettably),? I|I'm (?:not able|having (?:trouble|difficulty)|sorry)|(?:beyond|outside) my (?:capabilities|ability)|I (?:don't|do not) (?:currently )?have (?:a |the )?(?:tool|capability|access|ability)|I (?:was|am) unable to)/i;
const STATUS_ONLY_PROGRESS_PATTERN = /(?:next step|ready to (?:proceed|start|draft|implement|build)|no (?:other )?progress|haven't made (?:tangible )?progress|so far|I (?:inspected|reviewed|checked|scanned|confirmed|looked for|tried searching|pulled up|started digging))/i;
const READ_FAILURE_STALL_PATTERN = /(?:file read command kept failing|could not read|can't read|unable to read|read .* failed|kept failing|I'll pause there|I will pause there|I'll reattempt|I will reattempt)/i;
const BUILD_ROUTE_PATTERN = /^\/build(?:$|[/?#])/i;

export function buildRepeatedToolStopMessage(params: {
  toolName: string;
  count: number;
  routeContext?: string | null;
  reasonHint: string;
}): string {
  // User-facing message: respects IDENTITY_BLOCK rule #5 — never expose tool
  // names, file paths, error codes, or internal architecture to the user.
  // The technical detail (toolName, count, reasonHint) is captured in the
  // PlatformIssueReport via recordRepeatedToolIssue() at the call site, so
  // platform engineers still get the full forensic trail. The user just sees
  // an action they can take.
  if (BUILD_ROUTE_PATTERN.test(params.routeContext ?? "")) {
    return (
      "I got stuck retrying the same step and stopped before going in circles. "
      + "Open the build's details panel to see what's been saved, then either "
      + "send me a new instruction or retry from there."
    );
  }
  return (
    "I got stuck retrying the same step and stopped before going in circles. "
    + "Check the activity panel for what's been recorded, then tell me how "
    + "you'd like to proceed."
  );
}

export function buildRepeatedQuestionNudge(params: {
  tools: ToolDefinition[];
  routeContext?: string | null;
}): string {
  const availableToolNames = new Set(params.tools.map((tool) => tool.name));
  const routeContext = params.routeContext ?? "";

  if (routeContext.startsWith("/customer/marketing")) {
    const marketingTools = [
      "get_marketing_summary",
      "suggest_campaign_ideas",
      "save_marketing_review",
      "analyze_seo_opportunity",
    ].filter((toolName) => availableToolNames.has(toolName));
    const toolText = marketingTools.length > 0
      ? marketingTools.join(", ")
      : [...availableToolNames].slice(0, 6).join(", ");
    return `You already asked this question and I already answered it in the conversation above. Do NOT ask again. Proceed with the marketing work using the existing conversation context. Your marketing tools are active: ${toolText}. Call the most relevant marketing tool now; if you make a concrete recommendation, persist it with save_marketing_review.`;
  }

  if (BUILD_ROUTE_PATTERN.test(routeContext)) {
    return "You already asked this question and I already answered it in the conversation above. Do NOT ask again. Proceed immediately with the answer I gave. Use your Build Studio tools now — call saveBuildEvidence or search_project_files to make progress.";
  }

  const toolText = [...availableToolNames].slice(0, 8).join(", ");
  return `You already asked this question and I already answered it in the conversation above. Do NOT ask again. Proceed immediately with the answer I gave. Your tools are active: ${toolText}. Call the most relevant tool now.`;
}

// Tools that actually build/write — not just read/search
const BUILD_TOOL_NAMES = new Set([
  "saveBuildEvidence", "reviewDesignDoc", "reviewBuildPlan",
  "launch_sandbox", "generate_code", "iterate_sandbox",
  "edit_sandbox_file", "read_sandbox_file", "run_sandbox_command",
  "search_sandbox", "list_sandbox_files",
  "run_sandbox_tests", "deploy_feature", "run_ux_test",
  "propose_file_change", "update_feature_brief", "create_backlog_item",
  "check_deployment_windows", "schedule_promotion", "create_release_bundle", "get_release_status",
  "run_release_gate", "schedule_release_bundle",
  "assess_contribution", "contribute_to_hive",
]);

// Tools that count as concrete implementation progress in build mode.
// Read/search-only cycles should not keep pausing the user with "next step" updates.
const BUILD_PROGRESS_TOOL_NAMES = new Set([
  "launch_sandbox",
  "generate_code",
  "iterate_sandbox",
  "write_sandbox_file",
  "edit_sandbox_file",
  "run_sandbox_command",
  "run_sandbox_tests",
  "validate_schema",
  "saveBuildEvidence",
  "propose_file_change",
]);

function hasAuthoritativeToolProgress(
  executedToolNames: string[] | undefined,
  authoritativeToolNames?: Set<string>,
): boolean {
  return executedToolNames?.some((name) =>
    BUILD_TOOL_NAMES.has(name) || authoritativeToolNames?.has(name),
  ) ?? false;
}

type AgentRouteConfig = {
  minimumDimensions?: Record<string, number>;
  budgetClass?: "minimize_cost" | "balanced" | "quality_first";
  preferredProviderId?: string;
  preferredModelId?: string;
  allowedProviders?: string[];
  deniedProviders?: string[];
  residencyPolicy?: "local_only" | "approved_cloud" | "any_enabled";
  effort?: "low" | "medium" | "high" | "max";
};

function resolveEffectiveAgentRouteConfig(params: {
  agentModelConfig: {
    minimumTier: string;
    budgetClass: string;
    pinnedProviderId: string | null;
    pinnedModelId: string | null;
  } | null;
  modelRequirements: unknown;
}): AgentRouteConfig {
  const codeConfig: AgentRouteConfig =
    params.modelRequirements && typeof params.modelRequirements === "object"
      ? {
          ...("defaultMinimumTier" in params.modelRequirements
            ? {
                minimumDimensions:
                  TIER_MINIMUM_DIMENSIONS[
                    params.modelRequirements.defaultMinimumTier as QualityTier
                  ] ?? {},
              }
            : "minimumDimensions" in params.modelRequirements
              ? {
                  minimumDimensions:
                    params.modelRequirements.minimumDimensions as Record<string, number>,
                }
              : {}),
          ...("defaultBudgetClass" in params.modelRequirements
            ? {
                budgetClass: params.modelRequirements.defaultBudgetClass as
                  | "minimize_cost"
                  | "balanced"
                  | "quality_first",
              }
            : "budgetClass" in params.modelRequirements
              ? {
                  budgetClass: params.modelRequirements.budgetClass as
                    | "minimize_cost"
                    | "balanced"
                    | "quality_first",
                }
              : {}),
          ...("preferredProviderId" in params.modelRequirements
            ? { preferredProviderId: params.modelRequirements.preferredProviderId as string }
            : {}),
          ...("preferredModelId" in params.modelRequirements
            ? { preferredModelId: params.modelRequirements.preferredModelId as string }
            : {}),
          ...("allowedProviders" in params.modelRequirements
            ? { allowedProviders: params.modelRequirements.allowedProviders as string[] }
            : {}),
          ...("deniedProviders" in params.modelRequirements
            ? { deniedProviders: params.modelRequirements.deniedProviders as string[] }
            : {}),
          ...("residencyPolicy" in params.modelRequirements
            ? {
                residencyPolicy: params.modelRequirements.residencyPolicy as
                  | "local_only"
                  | "approved_cloud"
                  | "any_enabled",
              }
            : {}),
          ...("defaultEffort" in params.modelRequirements
            ? {
                effort: params.modelRequirements.defaultEffort as
                  | "low"
                  | "medium"
                  | "high"
                  | "max",
              }
            : {}),
        }
      : {};

  if (!params.agentModelConfig) return codeConfig;

  return {
    ...codeConfig,
    minimumDimensions:
      TIER_MINIMUM_DIMENSIONS[params.agentModelConfig.minimumTier as QualityTier] ??
      codeConfig.minimumDimensions ??
      {},
    budgetClass: params.agentModelConfig.budgetClass as
      | "minimize_cost"
      | "balanced"
      | "quality_first",
    preferredProviderId:
      params.agentModelConfig.pinnedProviderId ?? codeConfig.preferredProviderId,
    preferredModelId:
      params.agentModelConfig.pinnedModelId ?? codeConfig.preferredModelId,
  };
}

/** Detect when the agent claims completion or narrates code without having called authoritative tools. */
export function detectFabrication(
  response: string,
  executedToolCount: number,
  hasProposal: boolean,
  executedToolNames?: string[],
  authoritativeToolNames?: Set<string>,
  hasAuthoritativeToolAvailable: boolean = true,
): boolean {
  if (hasProposal) return false;

  // If the agent has no authoritative (action/build) tool available to call,
  // a completion-claim or narration in its reply is ordinary conversational
  // advice — there is no tool-backed work it could have recorded, so there is
  // nothing to fabricate. This is the normal case for advise-mode coworkers:
  // e.g. the setup tour, where the route persona is asked to "guide me through
  // this step" and naturally says things like "once your hours are configured".
  // Flagging that as fabrication kills a perfectly good reply and replaces it
  // with the build-oriented failure copy. Note: authoritative ≠ side-effecting
  // — internal build tools (saveBuildEvidence, reviewBuildPlan, …) are
  // sideEffect:false yet still authoritative, so the caller computes this flag
  // against both the side-effecting set and BUILD_TOOL_NAMES.
  if (!hasAuthoritativeToolAvailable) return false;

  // If no tools were called at all, any completion claim is fabrication
  if (executedToolCount === 0) return COMPLETION_CLAIM_PATTERN.test(response);

  // If tools were called but none were authoritative action tools (only read/search), the
  // agent still cannot claim completion or narrate implementation as if it
  // persisted build-state evidence. Read-only investigation is not enough to
  // say a plan is ready, implementation started, or code was changed.
  const usedAuthoritativeTool = hasAuthoritativeToolProgress(executedToolNames, authoritativeToolNames);
  if (!usedAuthoritativeTool && (
    COMPLETION_CLAIM_PATTERN.test(response) ||
    NARRATION_PATTERN.test(response)
  )) return true;

  return false;
}

function buildFabricationRecoveryNudge(params: {
  response: string;
  tools: ToolDefinition[];
  executedTools: Array<{ name: string }>;
  routeContext?: string | null;
}): string {
  const availableToolNames = new Set(params.tools.map((tool) => tool.name));
  const looksLikePlanReady =
    /plan(?:ning)?\s+(?:is\s+done|ready)|start\s+implementation|building\s+now/i.test(params.response);

  if (
    looksLikePlanReady
    && availableToolNames.has("saveBuildEvidence")
    && availableToolNames.has("reviewBuildPlan")
  ) {
    return 'STOP. Do not say the plan is ready yet. First call saveBuildEvidence with field "buildPlan" and a valid value containing top-level "fileStructure" and "tasks" arrays. Then call reviewBuildPlan. Only after those tool calls succeed may you say Start Implementation is the next approval.';
  }

  // Conversational coworker routes are advisory chats, not code-build sessions.
  // The build copy ("Do NOT show code to the user") is meaningless there and the
  // value is the advice itself. Nudge the model to PERSIST the concrete
  // recommendation with its own artifact tool, while keeping the advice it
  // already gave — do not tell it to suppress its answer.
  if (!BUILD_ROUTE_PATTERN.test(params.routeContext ?? "")) {
    const routeContext = params.routeContext ?? "";
    if (routeContext.startsWith("/customer/marketing")) {
      const persistTool = ["save_marketing_review", "create_marketing_campaign_brief", "create_marketing_asset_task"]
        .find((toolName) => availableToolNames.has(toolName));
      if (persistTool) {
        return `You gave a concrete marketing recommendation but did not record it. Keep that recommendation, and now call ${persistTool} to persist it so it shows on the page. Do not restate the diagnosis — advance the work. Only after the tool result confirms the save may you tell the user it was saved.`;
      }
    }
    const sideEffectTool = params.tools.find((tool) => tool.sideEffect)?.name;
    if (sideEffectTool) {
      return `You described an action or outcome but did not actually perform it. Keep your advice, but if you are recording or changing something, call ${sideEffectTool} now and only claim it is done after the tool result confirms it.`;
    }
    // No action tool to call — the reply is ordinary advice; ask the model to
    // simply give its answer directly without claiming work it cannot perform.
    return "Give your answer directly as advice. Do not claim you saved, created, sent, or scheduled anything — you have no tool to do so on this page.";
  }

  return `STOP. You described code or claimed actions without using tools. Do NOT show code to the user. ${getPhaseSpecificNudge(params.executedTools)} Call a tool NOW.`;
}

/**
 * Honest, conversational note appended to a coworker's advice when it made a
 * hard completion claim ("I've saved that") that no tool actually backed. We
 * keep the advice (it's the value) but correct the misleading claim WITHOUT the
 * build-oriented copy ("open the build details") that is nonsensical on a chat
 * route. Respects IDENTITY_BLOCK rule #5 — no tool names or internals exposed.
 */
export function buildUnsavedAdviceNote(routeContext?: string | null): string {
  if ((routeContext ?? "").startsWith("/customer/marketing")) {
    return (
      "_Note: I haven't saved this to your marketing workspace yet — the recommendation "
      + "above is ready to go. Reply “save it” and I'll record it so it shows on the page._"
    );
  }
  return (
    "_Note: I wasn't able to record that on your workspace just now — the details above are "
    + "complete. Tell me to save it and I'll record it._"
  );
}

function buildFabricationFailureMessage(params: {
  response: string;
  tools: ToolDefinition[];
  executedTools: Array<{ name: string }>;
  routeContext?: string | null;
}): string {
  // User-facing message: respects IDENTITY_BLOCK rule #5 — never expose tool
  // names, schema fields ("buildPlan"), or internal architecture terms like
  // "authoritative state" / "persisted evidence" to a non-technical user.
  // The underlying technical context is preserved in the executedTools list
  // and console logs for engineers.
  const availableToolNames = new Set(params.tools.map((tool) => tool.name));

  if (
    /plan(?:ning)?\s+(?:is\s+done|ready)|start\s+implementation|building\s+now/i.test(params.response)
    && availableToolNames.has("saveBuildEvidence")
    && availableToolNames.has("reviewBuildPlan")
  ) {
    return (
      "I described the plan as ready before it was actually recorded, so the build "
      + "doesn't have a saved plan yet. Try the request again, or open the build "
      + "details to see what's saved so far."
    );
  }

  // Conversational coworker routes have no "build details" panel — pointing a
  // marketing user there is nonsensical. This path is only reached on a
  // conversational route as a last resort (the main loop keeps the advice
  // instead); keep the copy honest and route-appropriate.
  if (!BUILD_ROUTE_PATTERN.test(params.routeContext ?? "")) {
    return (
      "I couldn't record that on your workspace just now. Nothing was left half-saved. "
      + "Please try again in a moment, or tell me to save it and I'll record it."
    );
  }

  return (
    "I couldn't complete that — the underlying work wasn't recorded. "
    + "Try rephrasing the request, or open the build details to see what's saved so far."
  );
}

/**
 * Honest, infrastructure-aware copy for when a completion-claim trips the
 * fabrication guard ON A DOWNGRADED TURN — i.e. the preferred AI provider
 * failed and a backup produced the answer. The fabrication signal here is most
 * likely an artifact of the failover (a weaker backup model), NOT the model
 * faking work, so we must NOT show the build-recording failure copy ("the
 * underlying work wasn't recorded") — that misreports an infrastructure failure
 * as model misbehavior. This is the exact 2026-06-02 incident. Respects
 * IDENTITY_BLOCK rule #5 — no provider/model/tool internals exposed.
 * See spec docs/specs/routing-resilience-and-failure-observability-spec.md §4.5.
 */
function buildDowngradedFabricationMessage(): string {
  return (
    "My usual AI provider was unavailable, so I worked through a backup that "
    + "couldn't fully complete this — nothing was left half-saved on your side. "
    + "Please try again (the primary connection may have recovered), or break "
    + "the request into a smaller step."
  );
}

function buildLocalToolCallFailureMessage(_result: RoutedInferenceResult): string {
  // Respects IDENTITY_BLOCK rule #5 — no infrastructure names, model ids, or
  // routing architecture; engineers get those from RoutedInferenceResult.
  // Copy must stay honest (G2, 2026-05-23): an earlier version promised a
  // re-route the loop never performs.
  // Rung 4 (BI-33F1EA72): connecting a provider is work only the human can do,
  // so this hands off rather than apologizing — steps, then the resumption.
  return buildHumanHandoff({
    blocker: "I'm on the local AI here, and it couldn't carry this one through.",
    steps: ["Open Platform > AI > Providers.", "Connect a stronger provider — Claude, Gemini, or OpenAI."],
    verify: "confirm the stronger provider is live",
  });
}

type ExecutedTool = { name: string; args?: Record<string, unknown>; result: ToolResult };

function summarizeExecutedToolNames(executedTools: ExecutedTool[]): string {
  const counts = new Map<string, number>();
  for (const tool of executedTools) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name, count]) => count > 1 ? `${name} x${count}` : name)
    .join(", ");
}

// BI-0C19AFDD: this message must stay domain-agnostic. The prior copy hard-coded
// a "finance reports"/"finance-summary tool" suggestion, which confabulated an
// unrelated domain for every non-finance coworker (e.g. Dale's truck-parts build
// was told to "use the finance reports directly"). Keep the guidance generic,
// mirroring the honest max-iter sibling below.
export function buildRuntimeLimitToolLoopMessage(executedTools: ExecutedTool[]): string {
  const toolSummary = summarizeExecutedToolNames(executedTools) || "the available tools";
  return [
    `I used ${toolSummary}, but the coworker hit the runtime limit before it produced a final answer.`,
    "I stopped before returning another raw tool request.",
    "The route and tool attempts were recorded; try a narrower question, or break the request into a smaller step.",
  ].join(" ");
}

import { buildMaxIterationsExhaustedMessage } from "./max-iterations-message";
export { buildMaxIterationsExhaustedMessage };

// Pattern: response is a short clarifying question asking for a required field.
// System prompt rule 13 allows ONE round of "I need X and Y" before acting.
// Nudging these responses toward tools breaks legitimate HR / data-entry flows
// (e.g. "What's the employee's last name?" after "add John as employee") and
// ideate-phase conversational gates where the model asks one clarifying question
// before starting research (e.g. "Happy to help. Who is the primary user?").
// The old strict pattern required the entire response to be a bare question —
// that rejected valid mixed responses. The new check: short + contains "?".
const CLARIFYING_QUESTION_PATTERN = /\?/;

export function shouldNudge(params: {
  continuationNudges: number;
  iteration: number;
  maxIterations: number;
  hasTools: boolean;
  executedToolCount: number;
  responseLength: number;
  responseText?: string;
  hasAuthoritativeToolExecution?: boolean;
  /** True when text alone cannot satisfy the caller's contract. */
  requireToolExecution?: boolean;
  /**
   * True when this turn is part of the setup tour. SetupOverlay sends an
   * auto-message prefixed "[Setup step: …]" whose route persona explicitly
   * instructs a brief text-only reply ("no tool calls"). On such turns a
   * nudge to "call a tool now" contradicts the route's own instruction, so we
   * skip the iteration-0 nudge. Narrowed to this signal (rather than any
   * no-authoritative-tool route) so routes like /finance still nudge — and the
   * local-model diagnostic still fires — when a tool ought to have been used.
   * Companion to detectFabrication's advise-mode guard (c70a7db6).
   */
  isSetupTourTurn?: boolean;
  allowFirstTurnTextOnlyReply?: boolean;
  /**
   * True when this turn is on a conversational (non-/build) coworker route. On
   * such routes there is no ideate→plan→build→review→ship phase-transition
   * contract, so the permission-seeking nudge — which exists to push a BUILD
   * agent past a mid-phase "should I proceed?" stall — does not apply. A
   * substantive answer that merely ends with a helpful offer ("…would you like
   * me to…?") is a COMPLETE conversational reply, not a stall. Without this,
   * such an answer was nudged away after tools had run and (paired with the
   * local-spinning guard) surfaced the misleading "not strong enough"
   * diagnostic while a correct answer was already in hand. See BI-C145F650.
   */
  isConversationalRoute?: boolean;
}): boolean {
  // One nudge maximum. Extra nudges multiply cost — if the model doesn't respond
  // to one targeted nudge, it won't respond to more and will just burn tokens.
  const isPermission = params.responseText ? PERMISSION_SEEKING_PATTERN.test(params.responseText) : false;
  const isNarration = params.responseText ? NARRATION_PATTERN.test(params.responseText) : false;
  void isPermission; void isNarration; // retained for future use
  const maxNudges = 1;
  if (params.continuationNudges >= maxNudges) return false;
  if (params.iteration >= params.maxIterations - 1) return false;
  if (!params.hasTools) return false;
  const permitsTextCompletion = !params.requireToolExecution;

  if (
    params.executedToolCount === 0
    && params.iteration === 0
    && params.isSetupTourTurn === true
  ) {
    return false;
  }

  // Conversational (non-/build) route: a substantive answer is FINAL even if it
  // ends with a helpful offer ("…would you like me to…?"). The permission-seeking
  // and narration nudges below enforce the BUILD phase-transition contract, which
  // has no analogue on a conversational coworker turn — so nudging a complete
  // answer there discards it and, with the local-spinning guard, surfaces the
  // misleading "not strong enough" diagnostic. This lifts the iteration-0
  // substantive-reply rule (below) to every iteration on conversational routes.
  // See BI-C145F650.
  if (params.isConversationalRoute) {
    const text = params.responseText?.trim() ?? "";
    const isSubstantiveReply = text.length >= 100
      && !COMPLETION_CLAIM_PATTERN.test(text)
      && !NARRATION_PATTERN.test(text);
    if (permitsTextCompletion && isSubstantiveReply) return false;
  }

  // First iteration with no tools called — nudge UNLESS the response is a
  // clarifying question or a substantive conversational reply. Short questions
  // ending in "?" mean the model is asking for a required field it can't
  // reasonably assume (per rule 13). Conversational replies (>100 chars,
  // no completion claim or narration) are also valid — nudging those toward
  // tool calls causes empty second responses that trigger quality-gate failures.
  if (params.executedToolCount === 0 && params.iteration === 0) {
    const text = params.responseText?.trim() ?? "";
    const isAskingClarification = text.length < 250 && CLARIFYING_QUESTION_PATTERN.test(text);
    const isSubstantiveReply = permitsTextCompletion && text.length >= 100
      && !COMPLETION_CLAIM_PATTERN.test(text) && !NARRATION_PATTERN.test(text);
    const isAllowedDirectReply = permitsTextCompletion
      && !!params.allowFirstTurnTextOnlyReply
      && text.length > 0
      && !COMPLETION_CLAIM_PATTERN.test(text)
      && !NARRATION_PATTERN.test(text)
      && !PERMISSION_SEEKING_PATTERN.test(text)
      && !FRUSTRATION_PATTERN.test(text);
    if (isAskingClarification || isSubstantiveReply || isAllowedDirectReply) return false;
    return true;
  }

  // Short response after using tools — model may have stalled. A short response
  // after an authoritative action tool is allowed because scheduled/procedural
  // runs often summarize a persisted tool result in one sentence.
  if (
    params.hasAuthoritativeToolExecution
    && params.executedToolCount > 0
    && params.responseText
    && !NARRATION_PATTERN.test(params.responseText)
    && !PERMISSION_SEEKING_PATTERN.test(params.responseText)
  ) return false;

  // Short response after using only read/context tools — model may have stalled
  if (params.executedToolCount > 0 && params.responseLength < 200) return true;

  // Agent is narrating code instead of using tools — nudge to use build tools
  if (params.responseText && NARRATION_PATTERN.test(params.responseText)) return true;

  // Agent is asking permission instead of acting — nudge to proceed
  if (params.responseText && PERMISSION_SEEKING_PATTERN.test(params.responseText)) return true;

  return false;
}

// ─── Build-specialist Operator Contract — clause 2.6 platform-side guards ────
// Spec: docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md §2.6
// Hallucinating LLMs cannot be trusted to self-report; the platform detects.

/**
 * Clause 2.2: phase advance is illegal without saved evidence; therefore
 * a turn in a build phase that produces zero tool calls is a contract
 * violation. Returns true when the phase requires a tool call before close.
 */
export function phaseRequiresToolCall(phase: string | null | undefined): boolean {
  if (!phase) return false;
  return ["ideate", "plan", "build", "review"].includes(phase);
}

function latestUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "user" || typeof message.content !== "string") continue;
    return message.content;
  }
  return "";
}

/**
 * True when the latest user turn is a setup-tour auto-message. SetupOverlay
 * (components/setup/SetupOverlay.tsx) prefixes every step trigger with
 * "[Setup step: …]", and those route personas are instructed to reply with a
 * brief text-only welcome and no tool calls — so the iteration-0 nudge should
 * be suppressed for them specifically (see shouldNudge).
 */
export function isSetupTourTurn(messages: ChatMessage[]): boolean {
  return /^\s*\[setup step:/i.test(latestUserText(messages));
}

function shouldAllowProviderStatusTextReply(params: {
  routeContext: string;
  taskType?: string;
  providerId: string;
  messages: ChatMessage[];
  responseText: string;
}): boolean {
  if (!params.routeContext.startsWith("/platform/ai/providers/")) return false;
  // Provider-detail status questions are often classified as "unknown" or
  // platform operations because the route carries most of the intent. The
  // route and status-language checks below are the durable guard here.
  if (params.providerId === "local") return false;

  const latestUser = latestUserText(params.messages).toLowerCase();
  const text = params.responseText.toLowerCase();
  const userAskedProviderStatus =
    /\b(?:do you work|are you working|can you respond|provider|model|inference|without using tools|no tools|just answer)\b/.test(latestUser);
  const answerLooksLikeProviderStatus =
    /\b(?:chat|inference|provider|model|endpoint|gemini|anthropic|openai|claude|codex)\b/.test(text)
    && /\b(?:operational|working|available|reachable|responding|unavailable|configured|healthy)\b/.test(text);

  return userAskedProviderStatus || answerLooksLikeProviderStatus;
}

/**
 * Clause 2.4: if a turn produces specific phase-evidence content in the
 * response text but does not call saveBuildEvidence with the matching field,
 * the evidence is ephemeral. Returns the field name that should have been
 * saved, or null. Conservative — only fires on clear evidence-content signals.
 */
export function detectUnsavedEvidence(
  responseText: string,
  executedTools: Array<{ name: string; args?: Record<string, unknown> }>,
  phase: string | null | undefined,
): string | null {
  if (!phase) return null;
  const phaseFieldMap: Record<string, { field: string; signal: RegExp }> = {
    ideate: { field: "designDoc", signal: /\b(?:design\s+doc|design\s+document|approach[:\s]|here['’]s\s+the\s+design)\b/i },
    plan: { field: "buildPlan", signal: /\b(?:build\s+plan|implementation\s+plan|tasks?[:\s]|file\s+structure)\b/i },
    review: { field: "verificationOut", signal: /\b(?:typecheck\s+(?:passed|failed)|tests?\s+(?:passed|failed)|verification\s+(?:complete|done))\b/i },
  };
  const entry = phaseFieldMap[phase];
  if (!entry) return null;
  if (!entry.signal.test(responseText)) return null;
  const wasSaved = executedTools.some(
    (t) => t.name === "saveBuildEvidence" &&
      (t.args as Record<string, unknown> | undefined)?.field === entry.field,
  );
  return wasSaved ? null : entry.field;
}

export type AgenticResult = {
  /** Final text response from the agent */
  content: string;
  /** Provider that generated the final response */
  providerId: string;
  modelId: string;
  /** Whether the provider was downgraded */
  downgraded: boolean;
  downgradeMessage: string | null;
  /** Total tokens across all iterations */
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Tool calls executed during the loop */
  executedTools: ExecutedTool[];
  /** If a proposal tool was called, return it for approval card rendering */
  proposal: { name: string; arguments: Record<string, unknown>; content: string } | null;
  failure?: InferenceDeadEndOutcome;
  /**
   * BI-2AC48661: the execution plan as it stood when the loop returned, when
   * `enableExecutionPlan` was set. Null when planning was off or the model
   * never recorded one. Carried out for observability and for the streamed-plan
   * UX (BI-95C0835E).
   */
  executionPlan?: ExecutionPlan | null;
};

async function resolveUserContext(userId: string): Promise<UserContext> {
  const row = await prisma.user
    .findUnique({
      where: { id: userId },
      select: {
        isSuperuser: true,
        groups: { include: { platformRole: true }, take: 1 },
      },
    })
    .catch(() => null);

  return {
    userId,
    platformRole: row?.groups?.[0]?.platformRole?.roleId ?? null,
    isSuperuser: row?.isSuperuser ?? false,
  };
}

/** Generate a phase-aware nudge based on which tools have been used so far. */
function getPhaseSpecificNudge(executedTools: Array<{ name: string }>): string {
  const usedNames = new Set(executedTools.map(t => t.name));

  // If sandbox tools were used, we're likely in build phase
  if (usedNames.has("launch_sandbox") || usedNames.has("generate_code") || usedNames.has("write_sandbox_file")) {
    if (!usedNames.has("run_sandbox_tests")) return "Try run_sandbox_tests to verify your work, or read_sandbox_file to check what exists.";
    return "Try run_sandbox_command to debug, or edit_sandbox_file to fix the issue.";
  }

  // If search/read tools were used, we're likely in ideate
  if (usedNames.has("search_project_files") || usedNames.has("read_project_file")) {
    return "Call saveBuildEvidence with field 'designDoc' to save your design.";
  }

  // If evidence tools were used, we're likely in plan/review
  if (usedNames.has("saveBuildEvidence") || usedNames.has("reviewDesignDoc")) {
    return "Call reviewBuildPlan to review the plan, or saveBuildEvidence to save your progress.";
  }

  // Deploy/ship tools
  if (usedNames.has("deploy_feature") || usedNames.has("check_deployment_windows")) {
    return "Call execute_promotion or schedule_promotion to complete deployment.";
  }

  // Generic fallback
  return "Check your available tools and call the most relevant one now.";
}

// Review tools succeed at the protocol level (success=true) but can emit
// data.review.decision === "fail" — a *content* rejection of the artifact
// produced by an earlier saveBuildEvidence call. Without surfacing that
// rejection back to the model, it will retry saveBuildEvidence with identical
// content and the agentic-loop guard will trip after 3 identical calls.
// See: docs/.../wwmd-mcp-exposure FB-C26D5B50 Ideate loop, 2026-05-19.
type ReviewResultShape = {
  review?: { decision?: string; rationale?: string; summary?: string };
  blocked?: boolean;
};
function reviewFailMessage(t: { name: string; result: { success: boolean; data?: Record<string, unknown>; message?: string } }): string | null {
  if (t.name !== "reviewDesignDoc" && t.name !== "reviewBuildPlan") return null;
  if (!t.result.success) return null;
  const data = t.result.data as ReviewResultShape | undefined;
  const decision = data?.review?.decision;
  if (decision !== "fail" && !data?.blocked) return null;
  const detail =
    data?.review?.rationale
    ?? data?.review?.summary
    ?? t.result.message
    ?? "review rejected the saved artifact";
  const artifact = t.name === "reviewDesignDoc" ? "design doc" : "build plan";
  return `Your previous ${artifact} was REJECTED by ${t.name}. Reason: ${detail.slice(0, 200)}. Regenerate the content addressing this specific gap before calling saveBuildEvidence again — submitting identical arguments will be rejected the same way and the run will be stopped.`;
}

type ExecutedToolRecord = {
  name: string;
  args?: Record<string, unknown>;
  result: { success: boolean; error?: string; data?: Record<string, unknown>; message?: string };
};

/**
 * Compute session-aware tool signals from what the agent has already tried:
 * a per-tool last-error map (cleared once that tool later succeeds) and a
 * sticky content-level review-veto map (cleared only by a passing review).
 * Pure — mutates nothing.
 */
function computeToolSessionSignals(
  executedTools: Array<ExecutedToolRecord>,
): { failures: Map<string, string>; reviewVetoes: Map<string, string> } {
  // Build failure map: tool name → last error. If a tool succeeded after
  // failing, clear the warning — the tool recovered.
  const failures = new Map<string, string>();
  // Separate veto map for content-level review rejections that target a
  // different write tool. Stays sticky across subsequent saveBuildEvidence
  // tool-level successes until a passing review clears it.
  const reviewVetoes = new Map<string, string>();
  for (const t of executedTools) {
    const veto = reviewFailMessage(t);
    if (veto) {
      reviewVetoes.set("saveBuildEvidence", veto);
      continue;
    }
    // A passing review clears the veto on the corresponding write tool.
    if ((t.name === "reviewDesignDoc" || t.name === "reviewBuildPlan") && t.result.success) {
      const data = t.result.data as ReviewResultShape | undefined;
      if (data?.review?.decision === "pass" && !data?.blocked) {
        reviewVetoes.delete("saveBuildEvidence");
      }
    }
    if (!t.result.success && t.result.error) {
      failures.set(t.name, t.result.error.slice(0, 150));
    } else if (t.result.success) {
      failures.delete(t.name);
    }
  }
  return { failures, reviewVetoes };
}

/**
 * Build a per-turn "session tool notes" user message from what the agent has
 * already tried, or null when there is nothing to warn about.
 *
 * BI-56804810 — this REPLACES annotating tool `description` fields in place.
 * Anthropic's prompt-cache prefix is ordered tools → system → messages, so the
 * stable system-prefix cache breakpoint (see routing/anthropic-cache.ts) also
 * covers the tools block. The previous approach appended
 * `[WARNING …]` / `[REVIEW REJECTION …]` strings into tool descriptions every
 * turn, so once any tool failed or was review-vetoed the tools block changed on
 * nearly every subsequent turn — busting the cached tools+system prefix and
 * re-billing it at full input rate (vs ~0.1x cache reads) for the rest of the
 * session. Emitting the identical signal as a message keeps the tools block
 * byte-identical turn-over-turn so the cache actually hits; the message sits
 * AFTER the cached prefix, where its per-turn churn carries no cache cost, and
 * the model still gets the "don't blindly retry" guidance just as well.
 *
 * Provider-agnostic: the hint reaches every provider through the messages tail,
 * so no per-provider branching is needed; only Anthropic gets the extra cache
 * benefit, and the local served-model path is unaffected.
 */
export function buildToolSessionHintMessage(
  executedTools: Array<ExecutedToolRecord>,
): string | null {
  if (executedTools.length === 0) return null;

  const { failures, reviewVetoes } = computeToolSessionSignals(executedTools);
  if (failures.size === 0 && reviewVetoes.size === 0) return null;

  const lines: string[] = [];
  for (const [name, veto] of reviewVetoes) {
    lines.push(`- ${name}: [REVIEW REJECTION: ${veto}]`);
  }
  for (const [name, lastError] of failures) {
    lines.push(
      `- ${name}: [WARNING: This tool failed earlier in this session with: "${lastError}". ` +
        `Consider a different approach or different arguments.]`,
    );
  }

  return (
    "[Session tool notes — based on tool calls you already made this session. " +
    "Do not blindly re-issue the same call with the same arguments; address the note first:\n" +
    lines.join("\n") +
    "]"
  );
}

function truncateMessageContent(content: string, maxChars: number, label: string): string {
  if (content.length <= maxChars) return content;
  const omitted = content.length - maxChars;
  const suffix = `\n...[truncated ${omitted} chars of earlier ${label}]`;
  return `${content.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function compactAgenticMessages(
  messages: ChatMessage[],
  maxContextTokens?: number | null,
  zone?: import("./context-pressure").ContextPressureZone,
): ChatMessage[] {
  // BI-9679EB1A: size the caps from the real model window when known, never
  // below today's floor. Unknown window (incl. iteration 0) -> floor exactly,
  // so the unknown-window path is byte-for-byte identical to before.
  // BI-3C8220ED: a live overload `zone` tightens the trim (never below floor).
  const caps = deriveCompactionCaps(maxContextTokens, {
    maxHistory: MAX_AGENTIC_HISTORY_MESSAGES,
    toolCap: MAX_TOOL_RESULT_CHARS,
    textCap: MAX_TEXT_MESSAGE_CHARS,
  }, zone);
  let scopedMessages: ChatMessage[];
  if (messages.length <= caps.maxHistory) {
    scopedMessages = messages;
  } else {
    // R9a (P11): the middle of a long turn is dropped entirely. Before
    // discarding it, distill its TOOL ACTIVITY into a one-line digest — zero
    // inference, because the local-first single-GPU path can't afford a
    // summarization call — and re-insert it right after message[0] so "what was
    // already tried / what failed" survives compaction instead of being silently
    // lost (which lets the model repeat completed work or re-hit a known fail).
    const dropped = messages.slice(1, messages.length - (caps.maxHistory - 1));
    const digest = summarizeDroppedMessages(dropped);
    const tail = messages.slice(-(caps.maxHistory - 1));
    scopedMessages = digest
      ? [messages[0]!, { role: "assistant" as const, content: `[System notice] ${digest}` }, ...tail]
      : [messages[0]!, ...tail];
  }

  const retainedToolCallIds = new Set(
    scopedMessages.flatMap((message) =>
      message.role === "assistant" && message.toolCalls
        ? message.toolCalls.map((toolCall) => toolCall.id)
        : [],
    ),
  );

  return scopedMessages
    .filter((message) =>
      message.role !== "tool" ||
      !message.toolCallId ||
      retainedToolCallIds.has(message.toolCallId),
    )
    .map((message) => {
      if (typeof message.content !== "string") return message;
      if (message.role === "tool") {
        return {
          ...message,
          content: truncateMessageContent(message.content, caps.toolCap, "tool output"),
        };
      }
      return {
        ...message,
        content: truncateMessageContent(message.content, caps.textCap, "message context"),
      };
    });
}

export type RunAgenticLoopParams = {

  chatHistory: ChatMessage[];
  systemPrompt: string;
  /** Instruction spans in `systemPrompt`; see RouteAndCallOptions (BI-463BE12A). */
  systemPromptInstructionSpans?: string[];
  /** What each `chatHistory` entry is — labels only (BI-40EF7C44). */
  messageOrigins?: readonly MessageOrigin[];
  sensitivity: import("@/lib/agent-sensitivity").RouteSensitivity;
  tools: ToolDefinition[];
  toolsForProvider: Array<Record<string, unknown>> | undefined;
  /** Read-only turn already grounded in authorized semantic state. */
  allowToolFreeInference?: boolean;
  /**
   * Authorized-but-not-attached tools (EP-COWORKER-INTERACTIVITY, BI-6A745E3C).
   * The chat coworker path right-sizes the per-turn attached set and passes the
   * remaining granted tools here; the model pulls them back on demand via the
   * load_tools meta-tool (intercepted in the tool loop, like the plan tools).
   * Undefined/empty for autonomous + build callers, whose behavior is unchanged.
   */
  deferredTools?: ToolDefinition[];
  userId: string;
  routeContext: string;
  agentId: string;
  threadId: string;
  taskType?: string;
  /**
   * EP-27FD96BC · P1 (BI-DA26BF90). The unified per-turn effort warrant. When
   * present, its `maxIterations` bounds the loop and its `maxDurationMs` sets the
   * conversation-phase duration baseline (heavy tool phases still win via max).
   * Absent = today's exact behavior (MAX_ITERATIONS / MAX_DURATION_MS).
   */
  effortWarrant?: import("./effort-warrant").EffortWarrant;
  modelRequirements?: Record<string, unknown>;
  /** @deprecated V2 routing is handled internally by routeAndCall. Ignored. */
  routeDecision?: unknown;
  onProgress?: (event: import("./agent-event-bus").AgentEvent) => void;
  /**
   * When true, fail fast if no tool-capable endpoint is available instead of
   * silently stripping tools. Set by Build Studio routes where tools are
   * required for correct task execution.
   */
  requireTools?: boolean;
  /**
   * Display name of the coworker (e.g. "AI Ops Engineer"). Passed through to
   * routeAndCall so the degraded-mode system prompt can identify the coworker
   * by name rather than becoming a generic "AI Assistant".
   */
  agentDisplayName?: string;
  /**
   * Optional active build phase ('ideate' | 'plan' | 'build' | 'review' | 'ship'
   * | 'complete'). Set by /build route callers from FeatureBuild.phase. When
   * set and equal to a phase that requires a tool call, a turn that produces
   * zero tool calls writes a PlatformIssueReport (Build Specialist Operator
   * Contract clause 2.6 platform path).
   */
  buildPhase?: string | null;
  /**
   * Distinguish autonomous phase execution from interactive chat.
   *
   * - `"autonomous"` (default): orchestrator / pipeline / scheduled runs.
   *   Operator Contract guards (clauses 2.4 unsaved-evidence,
   *   2.6a tool-refused-despite-availability, 2.6b zero-tool-call) fire
   *   on zero-tool-call iterations because those are real contract
   *   violations in autonomous phase execution.
   * - `"chat"`: a real user typed a message and is waiting for a reply.
   *   Conversational answers ("yes do the truck list first") legitimately
   *   produce zero tool calls and may mention plan-phase keywords without
   *   intent to save evidence. The contract guards no-op in this mode so
   *   the chat path does not generate phantom PlatformIssueReport rows.
   *
   * Default `"autonomous"` preserves prior behavior for the
   * build-orchestrator / build-pipeline / autonomous-work-run direct
   * callers. Chat callers (agent-coworker -> executeAutonomousAgenticLoop)
   * must opt in to `"chat"` explicitly.
   */
  interactionMode?: "chat" | "autonomous";
  /**
   * BI-80532D5C — when true, a side-effecting non-artifact tool the model calls
   * is diverted to an AgentActionProposal (status "proposed") instead of being
   * executed. Set by the scheduler when the run's proactivity actionBoundary is
   * "propose". Default false preserves the act path for every existing caller.
   */
  proposeSideEffects?: boolean;
  /**
   * Optional active FeatureBuild.id for attribution on guard-written
   * PlatformIssueReport rows. Caller should look this up alongside buildPhase.
   */
  featureBuildId?: string | null;
  /** EP-31815F97 S2 (BI-F82F4E04): active DelegationChain grouping id when this
   *  loop runs a delegated coworker, so each ToolExecution joins its
   *  chain-of-custody back to the human origin. Omitted for direct turns. */
  delegationChainId?: string;
  /**
   * Parent TaskRun for this agentic loop. When set, each governed tool call
   * records the same TaskRun id in ToolExecution audit rows.
   */
  taskRunId?: string | null;
  /**
   * External MCP token that submitted this loop. When set, each governed tool
   * call records the same token id in ToolExecution audit rows.
   */
  apiTokenId?: string | null;
  tokenScope?: "read" | "write" | "admin";
  /**
   * Governed Hermes learning Slice 1: active coworker skill for this run.
   * When set, every governed tool call records the same skillId in
   * ToolExecution audit rows so reflection and metrics can attribute action
   * evidence to the originating skill. Null when the run was not triggered
   * by a specific skill invocation.
   */
  activeSkillId?: string | null;
  /**
   * Pre-allocated AgentMessage id for the assistant turn this loop is
   * producing. Threaded down to AdapterRunTelemetry so the badge/cost-rollup
   * join (telemetry.agentMessageId → AgentMessage.id) succeeds even though
   * the AgentMessage row is persisted by the caller (agent-coworker) only
   * after the loop returns. When omitted, telemetry rows are written without
   * the join key and the UI badge degrades to provider-name-only.
   */
  agentMessageId?: string | null;
  /**
   * BI-2AC48661 (EP-F7E35344): opt into the persistent ExecutionPlan. When
   * true, two loop-intrinsic tools (record_execution_plan,
   * update_execution_plan_step) are appended to the model's tool list, the
   * current plan is rendered into the prompt every iteration (outside the
   * compacted window, so it never scrolls away), and a text-only "done" reply
   * is gated on all plan steps being closed. Default false — every existing
   * caller is byte-for-byte unchanged until it opts in.
   */
  enableExecutionPlan?: boolean;
  /** Bounded evidence-reader surface with a reserved governed writer step. */
  terminalToolPolicy?: TerminalToolPolicy;
};

export async function runAgenticLoop(params: RunAgenticLoopParams): Promise<AgenticResult> {
  const tracker = { activeSkillId: params.activeSkillId ?? null };
  let isSuccess = false;
  try {
    const result = await _runAgenticLoop(params, tracker);
    isSuccess = true;
    return result;
  } finally {
    if (tracker.activeSkillId) {
      const { recordSkillUsageEvents } = await import("@/lib/skills/usage-events");
      void recordSkillUsageEvents({
        phase: isSuccess ? "completed" : "failed",
        skillIds: [tracker.activeSkillId],
        agentId: params.agentId,
        userId: params.userId,
        threadId: params.threadId,
        taskRunId: params.taskRunId ?? null,
        routeContext: params.routeContext,
      });
    }
  }
}

async function _runAgenticLoop(params: RunAgenticLoopParams, tracker: { activeSkillId: string | null }): Promise<AgenticResult> {
  const {
    chatHistory,
    systemPrompt,
    systemPromptInstructionSpans,
    messageOrigins,
    sensitivity,
    tools,
    toolsForProvider,
    userId,
    routeContext,
    agentId,
    threadId,
    taskType,
    effortWarrant,
    modelRequirements,
    onProgress,
    requireTools,
    agentDisplayName,
    taskRunId,
    apiTokenId,
    agentMessageId,
  } = params;
  let hasResolvedSkillInvocation = false;
  const interactionMode: "chat" | "autonomous" = params.interactionMode ?? "autonomous";
  const proposeSideEffects = params.proposeSideEffects ?? false;
  const userContext = await resolveUserContext(userId);

  // Admin DB configuration takes precedence over registry defaults.
  const agentModelConfig = await prisma.agentModelConfig.findUnique({ where: { agentId } }).catch(() => null);

  const rawMinCaps = agentModelConfig?.minimumCapabilities as AgentMinimumCapabilities | null | undefined;
  const turnToolPosture = {
    allowToolFreeInference: params.allowToolFreeInference === true,
    hasProviderTools: Boolean(toolsForProvider?.length),
    requireTools: Boolean(requireTools),
  };
  const baseMinimumCapabilities = resolveTurnMinimumCapabilities(rawMinCaps, {
    ...turnToolPosture,
  });
  const turnCarriesImage = chatHistory.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some(
        (b) => b != null && typeof b === "object" && "type" in b && ((b as { type?: unknown }).type === "image_url" || (b as { type?: unknown }).type === "image"),
      ),
  );
  const minimumCapabilities: AgentMinimumCapabilities = turnCarriesImage
    ? { ...baseMinimumCapabilities, imageInput: true }
    : baseMinimumCapabilities;
  const agentMinimumContextTokens: number =
    agentModelConfig?.minimumContextTokens ?? DEFAULT_MINIMUM_CONTEXT_TOKENS;

  const effectiveConfig = resolveEffectiveAgentRouteConfig({
    agentModelConfig,
    modelRequirements,
  });
  const turnRoute = resolveTurnGroundedGuidanceRoute(
    taskType ?? "conversation",
    effectiveConfig.minimumDimensions,
    turnToolPosture,
  );
  effectiveConfig.minimumDimensions = turnRoute.minimumDimensions;

  // BI-E8BCA547 — spend-aware routing. Check the agent's live daily spend once
  // per turn and, when it is near the budget, bias the routing budget class
  // toward cost so the router picks a cheaper (still capability-floor-respecting)
  // model — instead of only logging the warning until the 100% hard-reject.
  // Advisory: any failure leaves the class untouched and never blocks the turn.
  try {
    const { checkAgentBudgetFromRegistry, writeBudgetEvent } = await import("@/lib/inference/budget-gate");
    const { spendAwareBudgetClass } = await import("@/lib/inference/spend-aware-routing");
    const budget = await checkAgentBudgetFromRegistry(agentId);
    const nearBudget = budget.status === "warning_80" || budget.status === "warning_95";
    const biased = spendAwareBudgetClass(effectiveConfig.budgetClass, budget.status);
    if (nearBudget && biased !== effectiveConfig.budgetClass) {
      console.log(
        `[budget-gate] spend-aware downgrade agent=${JSON.stringify(agentId)} ` +
          `status=${budget.status} ratio=${budget.ratioPercent}% ` +
          `${effectiveConfig.budgetClass} -> ${biased}`,
      );
      void writeBudgetEvent({
        agentId,
        eventKind: "downgrade",
        actualTokens: budget.actualTokens,
        limitTokens: budget.limitTokens,
      });
      effectiveConfig.budgetClass = biased;
    }
  } catch {
    // Budget gate is advisory — never block a turn on it.
  }

  // Build routeAndCall options once (reused every iteration)
  const routeOptions: RouteAndCallOptions = {
    ...(toolsForProvider ? { tools: toolsForProvider } : {}),
    ...(systemPromptInstructionSpans?.length ? { systemPromptInstructionSpans } : {}),
    ...(messageOrigins?.length ? { messageOrigins } : {}),
    taskType: turnRoute.taskType,
    ...effectiveConfig,
    ...(requireTools ? { requireTools: true } : {}),
    ...(agentDisplayName ? { agentDisplayName } : {}),
    // EP-AGENT-CAP-002: Capability floor — passed through to pipeline Stage 1
    minimumCapabilities,
    agentMinimumContextTokens,
    agentId, routeContext,
    ...(agentMessageId ? { agentMessageId } : {}),
    // mcpSession is forwarded through callWithFallbackChain → callProvider →
    // AdapterRequest. The Claude CLI execution adapter consumes it to mint a
    // short-lived JWT for `--mcp-config`, exposing platform tools as native
    // `mcp__dpf__*` tools instead of text-described prompt content. Other
    // adapters ignore the field. The agentic loop is the only place with
    // both userId and threadId in scope, so it is the natural source.
    mcpSession: { userId, agentId, threadId, routeContext },
  };

  // BI-2AC48661: persistent execution plan. When enabled, expose the two
  // plan tools to the model and keep the plan in loop state (never in the
  // compacted message array). MAX_PLAN_NUDGES caps how many times a text-only
  // "done" with open steps is bounced back to work before we accept the stop,
  // mirroring the existing one-shot continuation-nudge discipline.
  const planEnabled = params.enableExecutionPlan === true;
  const MAX_PLAN_NUDGES = 2;
  let executionPlan: ExecutionPlan | null = null;
  let planNudges = 0;
  if (planEnabled) {
    // BI-655507BA: resume a crash-durable plan persisted for this thread, so a
    // portal recycle mid-loop doesn't lose the plan + step progress. Best-effort
    // (never throws); null on miss -> the model simply re-plans, as today.
    executionPlan = await loadExecutionPlan(threadId);
    const planProviderTools = executionPlanProviderTools();
    routeOptions.tools = [
      ...((routeOptions.tools as Array<Record<string, unknown>> | undefined) ?? []),
      ...planProviderTools,
    ];
  }
  const terminalProviderTools = [...((routeOptions.tools as Array<Record<string, unknown>> | undefined) ?? [])];

  // EP-COWORKER-INTERACTIVITY (BI-6A745E3C): on-demand tool attachment. The chat
  // coworker path right-sizes the attached tool set and hands the remaining
  // authorized tools here as a deferred pool; the model pulls them back via the
  // load_tools meta-tool (intercepted below, like the plan tools). Empty for
  // autonomous/build callers, so their behavior is byte-for-byte unchanged.
  const dynamicToolSurface = new DynamicToolSurface({ active: tools, deferred: params.deferredTools });

  // Append the current plan as an ephemeral reminder to the messages handed to
  // the model. NOT stored in `messages`, so it is regenerated from live plan
  // state every iteration and can never be compacted away — this is the
  // "reads the plan outside the compacted window" mechanism. No-op when off.
  const withPlanReminder = (msgs: ChatMessage[]): ChatMessage[] => {
    if (!planEnabled) return msgs;
    const reminder = executionPlan ? renderPlanReminder(executionPlan) : renderNoPlanReminder();
    const block = `[System notice]\n${reminder}`;
    // Merge into a trailing user message to avoid two consecutive user turns
    // (some providers reject that); otherwise append after the assistant/tool
    // tail, which is a valid alternation.
    const last = msgs[msgs.length - 1];
    if (last && last.role === "user" && typeof last.content === "string") {
      return [...msgs.slice(0, -1), { ...last, content: `${last.content}\n\n${block}` }];
    }
    return [...msgs, { role: "user" as const, content: block }];
  };

  let messages = [...chatHistory];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const executedTools: AgenticResult["executedTools"] = [];
  let lastResult: RoutedInferenceResult | null = null;
  let continuationNudges = 0;
  // BI-PIR-2fc2106c: one soft no-progress nudge per args signature.
  const noProgressNudgedSigs = new Set<string>();
  let fabricationRetries = 0;
  let frustrationCount = 0;
  // BI-1D144CC1: bounded continue-generation budget for max_tokens-truncated
  // turns. A truncation stop is not a natural end_turn; we ask the model to
  // finish (up to this many times) before falling through to the best partial.
  const MAX_TRUNCATION_CONTINUES = 2;
  let truncationContinues = 0;
  // Evidence-integrity gate (INV-1). Decide once whether this turn's answer
  // depends on live operational state (a route with authoritative domain tools +
  // a live-state question); the terminal guard in the zero-tool branch enforces
  // that such a turn never returns factual prose without a successful tool call.
  const evidenceRequirement = classifyEvidenceRequirement({
    routeContext,
    domainTools: resolveRouteContext(routeContext).domainTools,
    message: latestUserText(messages),
  });
  let evidenceRecoveryNudges = 0;
  let terminalToolNudges = 0;
  let terminalToolSurfaceOverride: string[] | null = null;
  const completeResult = (
    content: string,
    source: Pick<RoutedInferenceResult, "providerId" | "modelId" | "downgraded" | "downgradeMessage"> | null = lastResult,
    extra: Partial<Pick<AgenticResult, "failure" | "executionPlan">> = {},
  ): AgenticResult => ({
    content,
    providerId: source?.providerId ?? "",
    modelId: source?.modelId ?? "",
    downgraded: source?.downgraded ?? false,
    downgradeMessage: source?.downgradeMessage ?? null,
    totalInputTokens,
    totalOutputTokens,
    executedTools,
    proposal: null,
    ...extra,
  });
  const terminalFailure = (message: string, source = lastResult): AgenticResult =>
    completeResult(message, source, { failure: { kind: "terminal-writer-missing", message } });
  let bestPreNudgeContent = ""; // Preserve best text from before nudge
  const startTime = Date.now();
  let inferenceCallCount = 0;
  let ctxPeakTokens = 0; // Peak assembled context (est. tokens) this turn — dumb-zone gauge.
  let resolvedMaxContextTokens: number | null = null; // BI-9679EB1A: learned from the first dispatch; sizes compaction + the gauge to the real window.
  let sandboxUnavailableCount = 0; // Circuit breaker: stop trying sandbox tools if unavailable
  // Stop grant-starved agents before they burn the full turn trying different
  // forbidden tools. Reset on any success so mixed grant surfaces remain valid.
  let forbiddenGrantStreak = 0;
  const forbiddenGrantTools = new Set<string>(); // names seen rejected, for the blocked message
  let previousResponseId: string | undefined; // Responses API conversation chaining

  // Per-turn observability: one structured summary line with the correlation
  // key and the figures that make slow or tool-heavy turns self-evident.
  const toolsAttachedForTurn = Boolean((toolsForProvider && toolsForProvider.length > 0) || planEnabled);
  const logTurnSummary = (provider: string, model: string): void => {
    // Context-economy gauge (R8/P12): observability only, never model input.
    const ctxPressure = classifyContextPressure(ctxPeakTokens, resolvedMaxContextTokens);
    const surface = assessToolSurface({ tools: toolsForProvider, windowTokens: resolvedMaxContextTokens });
    const turnToolAccuracy = computeToolSelectionAccuracy(
      executedTools.map((t) => ({ toolName: t.name, success: t.result.success })),
    );
    const economyMetrics = contextEconomyTurnMetricFields(
      ctxPressure.estimatedTokens,
      resolvedMaxContextTokens,
      surface,
      turnToolAccuracy,
    );
    console.log(
      sanitizeForLog(
        `[turn] thread=${JSON.stringify(threadId)} agent=${JSON.stringify(agentId)} ` +
        `route=${JSON.stringify(routeContext)} provider=${provider} model=${model} ` +
        `dispatches=${inferenceCallCount} nudges=${continuationNudges} ` +
        `toolsAttached=${toolsAttachedForTurn} executedTools=${executedTools.length} ` +
        `totalMs=${Date.now() - startTime} ` +
        `ctxPeakTokens=${ctxPeakTokens} ctxZone=${ctxPressure.zone} ` +
        `toolSurface=${surface.toolCount} estToolTokens=${surface.estDefinitionTokens} surfaceZone=${surface.zone} ` +
        `toolAccuracy=${economyMetrics.toolSelectionAccuracy === null ? "na" : economyMetrics.toolSelectionAccuracy.toFixed(2)}`,
      ),
    );
    // BI-47443B67: persist the same rollup durably so the regression detector
    // can compute nudge-rate windows. Fire-and-forget — the writer never throws.
    void recordCoworkerTurnMetric({
      threadId,
      agentMessageId: agentMessageId ?? null,
      agentId,
      routeContext,
      taskType: taskType ?? null,
      providerId: provider,
      modelId: model,
      dispatches: inferenceCallCount,
      nudges: continuationNudges,
      toolsAttached: toolsAttachedForTurn,
      executedTools: executedTools.length,
      totalMs: Date.now() - startTime,
      ...economyMetrics,
    });
  };

  // EP-27FD96BC · P1 — the unified warrant bounds iterations for this turn.
  // Clamped to the hard MAX_ITERATIONS safety ceiling; absent warrant = 200.
  const iterationCeiling = Math.min(
    MAX_ITERATIONS,
    effortWarrant?.maxIterations ?? MAX_ITERATIONS,
  );
  if (effortWarrant) {
    console.log(
      `[agentic-loop] effort-warrant level=${effortWarrant.level} ` +
        `iterations=${iterationCeiling} durationBaselineMs=${effortWarrant.maxDurationMs} ` +
        `toolBudgetTarget=${effortWarrant.toolBudgetTarget} signals=${effortWarrant.signals.join(",")}`,
    );
  }
  for (let iteration = 0; iteration < iterationCeiling; iteration++) {
    if (params.terminalToolPolicy) {
      routeOptions.tools = terminalToolSurfaceOverride
        ? selectTerminalToolSurface(terminalProviderTools, terminalToolSurfaceOverride)
        : applyTerminalToolSurface(params.terminalToolPolicy, executedTools, terminalProviderTools);
      const writerOnlySurface = routeOptions.tools.length === 1
        && selectTerminalToolSurface(routeOptions.tools, [params.terminalToolPolicy.writerToolName]).length === 1;
      routeOptions.toolChoice = writerOnlySurface ? "required" : undefined;
      routeOptions.terminalWriterToolName = writerOnlySurface ? params.terminalToolPolicy.writerToolName : undefined;
    }
    // EP-ASYNC-COWORKER-001: Check cancellation flag at each iteration boundary
    if (agentEventBus.isCancelled(threadId)) {
      agentEventBus.clearCancel(threadId);
      console.log(`[agentic-loop] cancelled by user at iteration ${iteration}`);
      break;
    }

    // BI-4ab6be39 — cooperative heartbeat. If the row was canceled elsewhere
    // (status != "working"), heartbeat returns false; we treat that as a
    // cooperative-cancel signal and break out of the loop.
    if (taskRunId) {
      const { heartbeat } = await import("@/lib/observability/heartbeat");
      const alive = await heartbeat(taskRunId);
      if (!alive) {
        console.log(`[agentic-loop] heartbeat reports row no longer working at iteration ${iteration} — breaking`);
        break;
      }
    }

    // No artificial inference call cap. The loop exits when the model responds with
    // text-only (natural completion). Runaway protection comes from:
    // - Sandbox circuit breaker (2 failures → immediate abort)
    // - Repetition detector (same tool+args 3x → break with message)
    // - Duration limits (phase-aware time ceilings)
    // - Nudge cap (1 nudge max, then accept the response)

    // Sandbox circuit breaker — if sandbox is consistently unavailable, stop trying sandbox tools
    // and surface the error so the user can start a sandbox rather than spinning expensively.
    if (sandboxUnavailableCount >= 2) {
      console.warn(`[agentic-loop] sandbox unavailable after ${sandboxUnavailableCount} attempts. Aborting loop.`);
      return completeResult("The sandbox is not available — no slots are free. Please ensure the sandbox container is running (check Docker Desktop), then try again.");
    }

    // Grant-starvation circuit breaker — after 3 consecutive forbidden_grant
    // rejections with no intervening success, this agent's profile is missing
    // the grants for the work it was handed. Continuing only burns iterations
    // (repetition detector won't fire — the model varies which forbidden tool
    // it tries). Exit with an actionable, honest blocked status that names the
    // held-back tools so the operator can grant them, rather than spinning to
    // MAX_DURATION with executedTools=0.
    if (forbiddenGrantStreak >= 3) {
      const blockedTools = Array.from(forbiddenGrantTools).sort();
      console.warn(
        `[agentic-loop] grant-starved: ${forbiddenGrantStreak} consecutive forbidden_grant rejections. ` +
        `agent=${JSON.stringify(agentId)} route=${JSON.stringify(routeContext)} tools=${JSON.stringify(blockedTools)}. Aborting loop.`,
      );
      return completeResult(
          `Blocked — hard stop, not a retry situation. This agent's profile lacks the grant(s) required for ` +
          `the tools it needs: ${blockedTools.join(", ")}. Every attempt was rejected with \`forbidden_grant\`. ` +
          `A platform operator needs to grant \`${agentId}\` access to these tools (or hand the work to a peer that already holds them) before it can proceed.`,
      );
    }

    // Time ceiling — phase-aware duration limits.
    // Weaker models (Haiku, local) need more iterations for the same quality,
    // and different phases have different workloads. Inspired by Claude Code's
    // ULTRAPLAN giving Opus 30 min for planning — we scale proportionally.
    const hasBuildTools = executedTools.some(t =>
      t.name === "launch_sandbox" || t.name === "generate_code" || t.name === "run_sandbox_tests" ||
      t.name === "write_sandbox_file" || t.name === "edit_sandbox_file" ||
      t.name === "read_sandbox_file" || t.name === "run_sandbox_command"
    );
    const hasIdeateTools = executedTools.some(t =>
      t.name === "search_project_files" || t.name === "read_project_file" ||
      t.name === "saveBuildEvidence" || t.name === "reviewDesignDoc" ||
      t.name === "save_build_notes" || t.name === "save_phase_handoff"
    );
    const hasPlanTools = executedTools.some(t =>
      t.name === "reviewBuildPlan" || (t.name === "saveBuildEvidence" &&
        (t.args as Record<string, unknown> | undefined)?.field === "buildPlan")
    );
    // BI-3907AF35: a governed initiative review is review-phase work too. It
    // reads an artifact at an immutable version and writes a structured
    // receipt; on the 120s conversation baseline the reviewer ran out of budget
    // after four reads and never reached its writer (FB-EB292B9F).
    const hasReviewTools = executedTools.some(t =>
      t.name === "run_ux_test" || t.name === "evaluate_page" ||
      t.name === "check_deployment_windows"
    ) || usesGovernedReviewTools(executedTools);
    const hasShipTools = executedTools.some(t =>
      t.name === "deploy_feature" || t.name === "execute_promotion" ||
      t.name === "register_digital_product_from_build" || t.name === "schedule_promotion"
    );
    // EP-27FD96BC · P1 — the effort warrant sets the conversation-phase baseline:
    // a trivial turn earns less wall-clock, an effortful reasoning turn earns more
    // even with no heavy tools. A tool-revealed heavy phase (build/ship/plan/
    // review) still takes its own ceiling. Absent warrant = the prior 120s.
    const conversationDurationBaseline = effortWarrant?.maxDurationMs ?? MAX_DURATION_MS;
    const durationLimit = hasBuildTools ? MAX_DURATION_BUILD_MS
      : hasShipTools ? MAX_DURATION_SHIP_MS
      : hasPlanTools ? MAX_DURATION_PLAN_MS
      : hasReviewTools ? MAX_DURATION_REVIEW_MS
      : hasIdeateTools ? MAX_DURATION_PLAN_MS
      : conversationDurationBaseline;
    if (Date.now() - startTime > durationLimit) {
      console.warn(`[agentic-loop] hit MAX_DURATION (${durationLimit}ms). executedTools=${executedTools.length}.`);
      break;
    }

    // Local-model spinning guard: small local fallback models (Docker Model
    // Runner, 7-13B class) often don't converge on a final answer when handed
    // a large tool surface — they keep emitting plausibly-different tool calls
    // that don't trip the exact-args repetition detector. After ~8 tool calls
    // on a local provider with no text-only response, accept it isn't going to
    // converge and return a diagnostic rather than burning the full 200
    // iterations. See FB-71FB3A53 thread, 2026-05-22.
    if (lastResult?.providerId === "local" && executedTools.length >= 8) {
      // Defect-B safety net (BI-C145F650): a correct answer captured before a
      // nudge is returned rather than discarded for the canned diagnostic.
      console.warn(
        `[agentic-loop] local model spun through ${executedTools.length} tool calls without converging` +
        (bestPreNudgeContent.length > 0
          ? `; recovering preserved pre-nudge answer (${bestPreNudgeContent.length} chars).`
          : ` on a text answer. Exiting early with diagnostic.`) +
        ` agent=${JSON.stringify(agentId)} route=${JSON.stringify(routeContext)}`,
      );
      return completeResult(bestPreNudgeContent || buildLocalToolCallFailureMessage(lastResult), lastResult);
    }

    // Repetition detector (runtime-issues). BI-PIR-2fc2106c: no-progress hard-stops
    // without warm-up; soft-nudge once at threshold-1 for identical successes.
    const repeated = detectRepeatedToolCall({ executedTools, iteration });
    if (repeated) {
      console.warn(`[agentic-loop] stuck: ${repeated.toolName} x${repeated.count} same args.${repeated.reasonHint}`);
      const content = buildRepeatedToolStopMessage({
        toolName: repeated.toolName, count: repeated.count, routeContext, reasonHint: repeated.reasonHint,
      });
      await recordRepeatedToolIssue({
        repeated, routeContext: routeContext ?? null, userId,
        agentId: agentId ?? null, threadId: threadId ?? null, taskRunId: taskRunId ?? null,
      });
      return completeResult(content, null);
    }
    const approaching = detectApproachingRepeatedToolCall({ executedTools });
    if (approaching && !noProgressNudgedSigs.has(approaching.signature)) {
      noProgressNudgedSigs.add(approaching.signature);
      console.warn(`[agentic-loop] no-progress nudge: ${approaching.toolName} x${approaching.count}`);
      messages = [...messages, { role: "user" as const, content: buildNoProgressNudgeMessage(approaching) }];
    }

    // EP-INF-009b: All inference goes through V2 routing pipeline
    inferenceCallCount++;
    // Assemble the compacted, plan-reminded context once (it was built twice,
    // once per heartbeat branch below) and gauge its pressure. Observability
    // only — the array is sent unchanged; this just makes context fill visible
    // per dispatch (the autonomous loop is the run most likely to drift into
    // the dumb zone). See ./context-pressure.
    // BI-3C8220ED — overload→trim. Measure the pressure BEFORE compaction and
    // feed the zone into the trim, so a turn already in the warning/dumb zone
    // compacts harder instead of only being logged after the fact.
    const preCompactionZone = classifyContextPressure(
      estimateContextTokens(messages, systemPrompt),
      resolvedMaxContextTokens,
    ).zone;
    const assembledMessages = withPlanReminder(
      compactAgenticMessages(messages, resolvedMaxContextTokens, preCompactionZone),
    );
    const ctxPressure = classifyContextPressure(estimateContextTokens(assembledMessages, systemPrompt), resolvedMaxContextTokens);
    if (ctxPressure.estimatedTokens > ctxPeakTokens) ctxPeakTokens = ctxPressure.estimatedTokens;
    if (ctxPressure.zone !== "sharp") {
      console.log(
        sanitizeForLog(
          `[context-pressure] thread=${JSON.stringify(threadId)} iteration=${iteration} ` +
            `preZone=${preCompactionZone} postZone=${ctxPressure.zone} ` +
            `estTokens=${ctxPressure.estimatedTokens} messages=${assembledMessages.length}`,
        ),
      );
    }
    // Session tool notes ride in the messages tail — AFTER the cached
    // tools→system prefix — instead of mutating tool descriptions, so the
    // Anthropic prompt-cache prefix stays byte-identical turn-over-turn even
    // after a tool fails or is review-vetoed. See buildToolSessionHintMessage.
    const toolHints = [
      buildToolSessionHintMessage(executedTools),
      params.terminalToolPolicy ? buildTerminalToolReminder(params.terminalToolPolicy, executedTools) : null,
    ].filter((hint): hint is string => Boolean(hint));
    const messagesForCall = toolHints.length
      ? [...assembledMessages, { role: "user" as const, content: toolHints.join("\n\n") }]
      : assembledMessages;
    let result: RoutedInferenceResult;
    try {
      // BI-e299d4d3 — wrap the slow inference with withHeartbeatTicker.
      // routeAndCall is the loop's long-running work; an inference can take
      // 30-300 seconds. The iteration-boundary heartbeat fires before this
      // await and the next one fires after — no coverage during the call.
      // The ticker keeps heartbeats flowing at (heartbeatTimeoutSeconds / 3)
      // cadence so the watchdog doesn't false-positive on slow models.
      if (taskRunId) {
        const { withHeartbeatTicker } = await import("@/lib/observability/heartbeat");
        result = await withHeartbeatTicker(taskRunId, () =>
          routeAndCall(
            messagesForCall,
            systemPrompt,
            sensitivity,
            { ...routeOptions, previousResponseId },
          ),
        );
      } else {
        result = await routeAndCall(
          messagesForCall,
          systemPrompt,
          sensitivity,
          { ...routeOptions, previousResponseId },
        );
      }
    } catch (routeErr) {
      const msg = routeErr instanceof Error ? routeErr.message : String(routeErr);
      const failure = describeToolRouteFailureOutcome(msg, routeOptions.tools?.length ?? 0, routeErr);
      console.warn(`[agentic-loop] routeAndCall threw: ${msg}`);
      logTurnSummary("unknown", "unknown");
      if (params.terminalToolPolicy) {
        // BI-8B8731EE. A THROW from routeAndCall means the model never ran, so
        // this is not the reviewer declining its writer contract.
        //
        // `failure` above already classifies why. Preserve an adapter capability
        // refusal on every required-writer call; preserve RESOURCE waits only
        // before any tool work, because the platform already knows what
        // to do with it: `preInferenceResourceWait` projects a `provider-capacity`
        // wait that resumes on the same TaskRun. Rewriting it to
        // `terminal-writer-missing` made that handling unreachable for every
        // governed reviewer route and reported a reservation that clears itself
        // in ~195s as a failure of the writer contract.
        //
        // Measured cost of the substitution: five dispatches spent auditing
        // grants, autonomy tiers and tool surfaces that were correct throughout.
        // Capacity/busy is preserved only before tool work, mirroring
        // `preInferenceResourceWait`. Once a reader runs, its work is banked and
        // the resumable writer wait is better than a resource wait. An adapter
        // refusal is still pre-inference for the current writer call, though,
        // so preserve it regardless of completed reader work.
        if (failure.kind === "required-terminal-writer-not-enforceable" || ((failure.kind === "capacity" || failure.kind === "busy") && executedTools.length === 0)) {
          return completeResult(failure.message, null, { failure });
        }
        const message = routeOptions.toolChoice === "required"
          ? `The required governed writer ${params.terminalToolPolicy.writerToolName} could not be dispatched. The same TaskRun remains resumable. No receipt was created.`
          : `The governed review route failed before ${params.terminalToolPolicy.writerToolName} could be recorded. The same TaskRun remains resumable. No receipt was created.`;
        return terminalFailure(message, null);
      }
      return {
        content: failure.message,
        providerId: "unknown",
        modelId: "unknown",
        downgraded: false,
        downgradeMessage: null,
        totalInputTokens,
        totalOutputTokens,
        executedTools,
        proposal: null,
        failure,
      };
    }
    // Track response ID for conversation chaining (Responses API)
    if (result.responseId) {
      previousResponseId = result.responseId;
    }

    // First iteration: check if the routed model matches the preferred model.
    // If not, warn — the agent may not be able to orchestrate tools effectively.
    if (iteration === 0 && routeOptions.preferredModelId && result.modelId !== routeOptions.preferredModelId) {
      console.warn(
        `[agentic-loop] Model mismatch: wanted ${routeOptions.preferredModelId} but got ${result.modelId}. ` +
        `The agent may not be able to use tools effectively. Check AI Workforce > Providers to ensure ` +
        `the preferred model is active and not retired.`,
      );
      // Inject a system hint so the model knows its limitations
      if (result.modelId?.includes("claude-3-haiku")) {
        messages = [
          ...messages,
          {
            role: "user" as const,
            content: "[System notice: You are running on a limited model that may not support multi-step tool orchestration. " +
              "Focus on one tool call at a time. If tools aren't working, explain what you would do and ask the user to check " +
              "AI Workforce > Providers configuration.]",
          },
        ];
      }
    }

    lastResult = result;
    if (resolvedMaxContextTokens == null && result.resolvedMaxContextTokens != null) {
      resolvedMaxContextTokens = result.resolvedMaxContextTokens;
    }
    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;

    // No tool calls — check if agent stalled with intent to continue
    if (!result.toolCalls || result.toolCalls.length === 0) {
      const trimmed = result.content.trim();

      // Diagnostic: log raw response so we can trace stalls
      console.log(
        `[agentic-loop] thread=${JSON.stringify(threadId)} iter=${iteration} provider=${result.providerId} model=${result.modelId} ` +
        `toolCalls=0 contentLen=${trimmed.length} nudges=${continuationNudges} ` +
        `executedTools=${executedTools.length} content=${JSON.stringify(trimmed.slice(0, 200))}`,
      );

      if (params.terminalToolPolicy) {
        const exit = resolveTerminalTextExit(params.terminalToolPolicy, executedTools, terminalToolNudges);
        if (exit.kind === "complete") {
          logTurnSummary(result.providerId, result.modelId);
          return completeResult(result.content, result);
        }
        if (exit.kind === "nudge") {
          terminalToolNudges++;
          terminalToolSurfaceOverride = exit.allowedToolNames;
          messages = [...messages, { role: "assistant", content: result.content }, { role: "user", content: exit.message }];
          await rotateTerminalWriterRoute({ policy: params.terminalToolPolicy, records: executedTools, options: routeOptions, providerId: result.providerId, messages, systemPrompt: params.systemPrompt, sensitivity: params.sensitivity });
          continue;
        }
        if (exit.kind === "input-required") {
          return terminalFailure(exit.message, result);
        }
      }

      // BI-1D144CC1: truncation stop. The provider cut generation off at the
      // output-token ceiling (stop_reason=max_tokens / finish_reason=length /
      // MAX_TOKENS / Responses incomplete). A reply that ends without a tool call
      // because it RAN OUT OF TOKENS is not a natural end_turn — returning its
      // partial text as the final answer is the defect this guards. Ask the model
      // to finish (bounded) BEFORE the "why did you stop" contract/fabrication/
      // nudge guards run: we already know why it stopped, so those diagnostics
      // would misfire. This realizes the stop_reason==="end_turn" contract the
      // loop's own header comment claims but never enforced.
      if (result.truncated && truncationContinues < MAX_TRUNCATION_CONTINUES) {
        truncationContinues++;
        // Never regress below today's behaviour: keep the longest partial as the
        // fallback answer in case a continuation returns empty.
        if (trimmed.length > bestPreNudgeContent.length) bestPreNudgeContent = trimmed;
        console.warn(
          `[agentic-loop] response truncated at output-token ceiling with no tool call; ` +
          `continuing generation (${truncationContinues}/${MAX_TRUNCATION_CONTINUES}). ` +
          `thread=${JSON.stringify(threadId)} iter=${iteration}`,
        );
        messages = [
          ...messages,
          { role: "assistant" as const, content: result.content },
          {
            role: "user" as const,
            content:
              "Your previous response was cut off because it reached the output length limit " +
              "before you finished. Provide the COMPLETE answer now in a single response — be " +
              "more concise so it fits within the limit. Do not rely on the truncated version.",
          },
        ];
        continue;
      }

      // Build-specialist Operator Contract clause 2.6 — platform-side guards.
      // Detect contract violations the LLM cannot self-report. Each guard
      // writes a PlatformIssueReport tagged to the active build (when known).
      // Spec: docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md §2.6
      //
      // Skip guards in chat mode. A user asking a build coworker "yes do the
      // truck list first" legitimately produces a conversational reply with
      // zero tool calls — that's not a contract violation, the agent is
      // answering a question. Without this gate the guard regexes
      // false-positive on any plan-phase chat reply mentioning "tasks" or
      // "build plan", producing phantom PlatformIssueReport rows that
      // misdirect troubleshooting. See Phase J of
      // docs/dogfood/2026-05-23-dale-hvac-build-studio.md (D42, D43).
      const runContractGuards = interactionMode === "autonomous";
      const writeContractIssue = (
        category: "tool-refused-despite-availability" | "zero-tool-call" | "unsaved-evidence",
        title: string,
        description: string,
        severity: "high" | "medium" | "low" = "high",
        status: string = "open",
      ): void => {
        prisma.platformIssueReport.create({
          data: {
            reportId: `coworker-process-${Date.now()}-${threadId.slice(0, 8)}-${category}`,
            type: "runtime_error",
            severity,
            status,
            title: `[coworker-process] ${title}`,
            description,
            routeContext,
            agentId,
            featureBuildId: params.featureBuildId ?? null,
            source: "agentic-loop-guard",
          },
        }).catch((err) => {
          console.warn(`[agentic-loop] failed to write contract issue (${category}):`, err);
        });
      };

      // 2.6a: tool-refused-despite-availability
      const refusedToolName = runContractGuards ? detectToolRefusedDespiteAvailability(trimmed, tools) : null;
      if (refusedToolName) {
        // BI-PIR-6de01e8d: recover in-loop when the model closed with no tools.
        const recovered = appendToolRefusedRecoveryMessages({
          messages, assistantContent: result.content, refusedToolName, deliveredTools: tools,
          executedToolCount: executedTools.length, toolsStripped: Boolean(result.toolsStripped),
        });
        // BI-09C2480B: a refusal the loop self-corrects is a low-severity,
        // resolved_locally trend record — not one of the ~24 duplicate OPEN
        // BI-PIR-* items the triage cron would project. An unrecovered refusal
        // stays a high-severity OPEN contract issue.
        const { severity: refusedSeverity, status: refusedStatus } =
          classifyToolRefusedIssue({ recovered: Boolean(recovered) });
        console.warn(
          `[agentic-loop] contract-violation tool-refused-despite-availability: ${refusedToolName}` +
            (recovered ? " (recovered in-loop)" : ""),
        );
        writeContractIssue(
          "tool-refused-despite-availability",
          recovered
            ? `tool-refused-despite-availability (recovered): ${refusedToolName}`
            : `tool-refused-despite-availability: ${refusedToolName}`,
          `Agent ${agentId} on route ${routeContext} asserted that ${refusedToolName} is unavailable in iteration ${iteration}, but the tool was in the delivered tool list.` +
            (recovered
              ? " The loop issued a corrective nudge and continued; recorded for trend analysis, not operator action."
              : "") +
            ` Response excerpt: ${trimmed.slice(0, 500)}`,
          refusedSeverity,
          refusedStatus,
        );
        if (recovered) { continuationNudges++; messages = recovered; continue; }
      }

      // 2.6b: zero-tool-call on phase-required turn
      if (runContractGuards && executedTools.length === 0 && phaseRequiresToolCall(params.buildPhase)) {
        console.warn(`[agentic-loop] contract-violation zero-tool-call phase=${params.buildPhase}`);
        writeContractIssue(
          "zero-tool-call",
          `zero-tool-call on phase=${params.buildPhase}`,
          `Agent ${agentId} on route ${routeContext} closed iteration ${iteration} of build phase '${params.buildPhase}' with zero tool calls. Response excerpt: ${trimmed.slice(0, 500)}`,
        );
      }

      // 2.4: save-before-final-response — evidence in text but not persisted
      const unsavedField = runContractGuards
        ? detectUnsavedEvidence(trimmed, executedTools, params.buildPhase)
        : null;
      if (unsavedField) {
        console.warn(`[agentic-loop] contract-violation unsaved-evidence: ${unsavedField} described but not saved`);
        writeContractIssue(
          "unsaved-evidence",
          `unsaved-evidence: ${unsavedField}`,
          `Agent ${agentId} on route ${routeContext} produced ${unsavedField} content in iteration ${iteration} but did not call saveBuildEvidence({ field: "${unsavedField}", ... }). Response excerpt: ${trimmed.slice(0, 500)}`,
          "medium",
        );
      }

      // Empty response guard: if the model returns empty content AND zero tool calls,
      // it can't handle the request (wrong tool format, model doesn't support tools, etc).
      // Don't nudge — break immediately with a clear error.
      if (trimmed.length === 0 && executedTools.length === 0) {
        console.warn(`[agentic-loop] Empty response from ${result.providerId}/${result.modelId} on iteration ${iteration}. Model may not support tool use. Breaking.`);
        return completeResult(`The model (${result.modelId}) returned an empty response and did not use any tools. This typically means it does not support the tool format required for this task. Try a different model or provider.`, result);
      }

      // Evidence-integrity gate (INV-1). When this turn's answer depends on live
      // operational state and NO authoritative tool ran, the model's factual
      // prose is unverifiable. Nudge once for a tool, then refuse rather than
      // guess. Recovery cannot escalate providers (INV-4); load_tools is not evidence.
      if (evidenceRequirement.required && trimmed.length > 0) {
        const authoritativeToolExecutions = executedTools.filter(
          (t) => t.result?.success && t.name !== LOAD_TOOLS_TOOL_NAME,
        ).length;
        const recovery = resolveEvidenceRecovery({
          required: true,
          authoritativeToolExecutions,
          authoritativeSurfaceEvidence: params.allowToolFreeInference,
          content: trimmed,
          recoveryNudgesUsed: evidenceRecoveryNudges,
        });
        if (recovery.kind === "nudge") {
          evidenceRecoveryNudges++;
          console.warn(`[agentic-loop] evidence-required turn, zero authoritative tools; nudging. route=${JSON.stringify(routeContext)}`);
          messages = [
            ...messages,
            { role: "assistant" as const, content: result.content },
            { role: "user" as const, content: recovery.nudgeMessage },
          ];
          continue;
        }
        if (recovery.kind === "refuse") {
          // BI-0C0669B5: log the WITHHELD length so a turn whose reasoning was
          // quarantined is greppable, and so the extractor's zero can be
          // compared against what the model actually produced.
          console.warn(`[agentic-loop] evidence-required turn unverifiable; could-not-verify (INV-1/5). route=${JSON.stringify(routeContext)} withheldChars=${recovery.withheldContent.trim().length}`);
          return completeResult(recovery.message, result);
        }
      }

      const hasAuthoritativeToolAvailable = tools.some(
        (tool) => tool.sideEffect || BUILD_TOOL_NAMES.has(tool.name),
      );
      const looksFabricated = detectFabrication(
        trimmed,
        executedTools.length,
        false,
        executedTools.map((t) => t.name),
        new Set(tools.filter((tool) => tool.sideEffect).map((tool) => tool.name)),
        hasAuthoritativeToolAvailable,
      );

      const isBuildRoute = BUILD_ROUTE_PATTERN.test(routeContext);
      const hasConcreteBuildProgress = executedTools.some((t) => t.result.success && BUILD_PROGRESS_TOOL_NAMES.has(t.name));
      const looksStatusOnly = STATUS_ONLY_PROGRESS_PATTERN.test(trimmed);
      const looksReadFailureStall = READ_FAILURE_STALL_PATTERN.test(trimmed);
      if (!result.toolsStripped && isBuildRoute && executedTools.length > 0 && !hasConcreteBuildProgress && looksReadFailureStall) {
        continuationNudges++;
        messages = [
          ...messages,
          { role: "assistant" as const, content: result.content },
          {
            role: "user" as const,
            content:
              "Do not pause after a failed read. Keep executing with fallback steps now: use list_sandbox_files to locate the path, then read_sandbox_file with offset/limit or describe_model to inspect schema fields. Continue implementing and report concrete changes or a specific blocker.",
          },
        ];
        continue;
      }
      if (!result.toolsStripped && isBuildRoute && executedTools.length > 0 && !hasConcreteBuildProgress && looksStatusOnly) {
        continuationNudges++;
        messages = [
          ...messages,
          { role: "assistant" as const, content: result.content },
          {
            role: "user" as const,
            content:
              "Do not pause with status-only updates. Continue implementing now in a larger chunk: create or modify files, run verification commands, and report concrete changes or a specific blocker.",
          },
        ];
        continue;
      }

      // Repetition detector: if the model is REDUNDANTLY re-asking a question
      // it already asked, nudge it to proceed with the answer already given.
      // This prevents the "ask the same scope question 5 times" loop WITHOUT
      // misfiring on a substantive answer that merely ends with an engagement
      // question — see isRedundantReaskQuestion for the false-positive history.
      {
        const previousAssistantMessages = messages
          .filter(m => m.role === "assistant")
          .map(m => typeof m.content === "string" ? m.content : "");
        if (isRedundantReaskQuestion(trimmed, previousAssistantMessages)) {
          console.log(`[agentic-loop] Repeated question detected, injecting proceed nudge: ${trimmed.slice(0, 100)}`);
          continuationNudges++;
          messages = [
            ...messages,
            { role: "assistant" as const, content: result.content },
            {
              role: "user" as const,
              content: buildRepeatedQuestionNudge({
                tools,
                routeContext,
              }),
            },
          ];
          continue;
        }
      }

      if (looksFabricated) {
        // Routing-resilience Slice D: an infrastructure failover (the preferred
        // provider failed and a backup answered) is NOT model fabrication. On a
        // downgraded conversational turn the fabrication signal is a false
        // positive caused by the failover — keep the backup's answer rather than
        // replacing it with the build-recording failure copy. This is the exact
        // 2026-06-02 incident (a good estate answer hidden behind "the
        // underlying work wasn't recorded"). detectFabrication stays pure; the
        // infra context (downgraded, build-route) is applied only here.
        if (result.downgraded && !isBuildRoute) {
          console.warn(
            "[agentic-loop] fabrication signal on a downgraded conversational turn — keeping the backup answer (infra failover, not fabrication).",
          );
          return completeResult(trimmed, result);
        }

        // Conversational coworker routes (e.g. the marketing strategist): the
        // fabrication guard exists to stop a BUILD agent from falsely claiming
        // it shipped code. On an advisory chat the same signal mostly fires on a
        // genuinely useful answer that ends with an intent to persist ("let me
        // draft that") — and the marketing route is the one advise-mode route
        // that still carries authoritative artifact tools, so it is exactly
        // where this misfires. Discarding the advice and showing build copy
        // ("open the build details") is the wrong cure: it is the failure the
        // user reported. Retry ONCE with a domain nudge to coax the persist
        // tool; if the model still won't call it, KEEP the advice rather than
        // nuke it. Only when the reply makes a hard, unbacked completion claim
        // ("I've saved that", "it's live") do we append an honest note so the
        // user is not misled. detectFabrication stays pure; route handling lives
        // here. BI-3E92B28B (EP-MARKETING-EXEC).
        if (!isBuildRoute) {
          if (fabricationRetries < 1) {
            fabricationRetries++;
            console.warn(
              "[agentic-loop] fabrication signal on a conversational route — retrying once with a persist nudge before keeping the advice.",
            );
            messages = [
              ...messages,
              { role: "assistant" as const, content: result.content },
              {
                role: "user" as const,
                content: buildFabricationRecoveryNudge({
                  response: trimmed,
                  tools,
                  executedTools,
                  routeContext,
                }),
              },
            ];
            continue;
          }

          const makesHardCompletionClaim = HARD_COMPLETION_CLAIM_PATTERN.test(trimmed);
          console.warn(
            `[agentic-loop] conversational fabrication retry exhausted — keeping the advice${makesHardCompletionClaim ? " with an unsaved-work note" : ""} rather than discarding it.`,
          );
          const base = makesHardCompletionClaim
            ? `${trimmed}\n\n${buildUnsavedAdviceNote(routeContext)}`
            : trimmed;
          return completeResult(
            applyEscalationLadderGuard(applyBacklogCreateClaimGuard(base, executedTools), executedTools),
            result,
          );
        }

        // BI-PIR-cc091267 — a build-route fabrication signal (completion claim
        // with zero tool calls) is most often a TRANSIENT provider downgrade:
        // the preferred provider 529s, a weaker backup confabulates "done"
        // without emitting the required tool call. A single retry can't ride out
        // a blip that self-clears in ~30s, so give build routes a few attempts —
        // each re-dispatches and can re-route to the recovered preferred
        // provider.
        const maxFabricationRetries = 3;
        if (fabricationRetries < maxFabricationRetries) {
          fabricationRetries++;
          console.warn(
            `[agentic-loop] fabrication detected: claimed completion without the required tool-backed evidence. Retrying (${fabricationRetries}/${maxFabricationRetries}).`,
          );
          messages = [
            ...messages,
            { role: "assistant" as const, content: result.content },
            {
              role: "user" as const,
              content: buildFabricationRecoveryNudge({
                response: trimmed,
                tools,
                executedTools,
                routeContext,
              }),
            },
          ];
          continue;
        }

        return {
          // Downgraded build-route claim: the completion claim is load-bearing
          // ("I shipped it"), so we don't keep it — but we still attribute the
          // failure to infrastructure, not to the model fabricating work.
          content: result.downgraded
            ? buildDowngradedFabricationMessage()
            : buildFabricationFailureMessage({
                response: trimmed,
                tools,
                executedTools,
                routeContext,
              }),
          providerId: result.providerId,
          modelId: result.modelId,
          downgraded: result.downgraded,
          downgradeMessage: result.downgradeMessage,
          totalInputTokens,
          totalOutputTokens,
          executedTools,
          proposal: null,
        };
      }

      // Safety net: nudge the model to use tools if it responded with text-only.
      // Catches both mid-workflow stalls AND first-iteration zero-tool responses.
      // Skip nudging entirely when tools were stripped by routing degradation —
      // the model gave a correct conversational response, nudging would push it
      // to hallucinate tool calls it can't make.
      const shouldNudgeNow = result.toolsStripped ? false : shouldNudge({
        continuationNudges,
        iteration,
        maxIterations: iterationCeiling,
        hasTools: !!(toolsForProvider && toolsForProvider.length > 0) || planEnabled,
        executedToolCount: executedTools.length,
        responseLength: trimmed.length,
        responseText: trimmed,
        hasAuthoritativeToolExecution: executedTools.some(
          (executedTool) => executedTool.result.success && tools.some(
            (tool) => tool.name === executedTool.name && tool.sideEffect,
          ),
        ),
        isSetupTourTurn: isSetupTourTurn(messages),
        isConversationalRoute: !BUILD_ROUTE_PATTERN.test(routeContext ?? ""),
        allowFirstTurnTextOnlyReply: shouldAllowProviderStatusTextReply({
          routeContext,
          taskType,
          providerId: result.providerId,
          messages,
          responseText: trimmed,
        }),
        requireToolExecution: requireTools,
      });

        // Local model produced text-only on iteration 0 of a tool-backed turn:
        // exit with a diagnostic instead of nudging — nudging won't teach a
        // small local model to use tools mid-turn, it just burns iterations.
        // The previous Build-Studio carve-out (!BUILD_ROUTE_PATTERN) was the
        // root cause of 200-iteration hangs on /build threads when the
        // preferred provider was unavailable and routing fell back to local.
        // See FB-71FB3A53 thread, 2026-05-22.
        if (
          shouldNudgeNow &&
          iteration === 0 &&
          executedTools.length === 0 &&
          result.providerId === "local"
        ) {
          console.warn(
            `[agentic-loop] local model produced text-only response for tool-backed turn; returning diagnostic instead of issuing a second nudge. agent=${JSON.stringify(agentId)} route=${JSON.stringify(routeContext)}`,
          );
          return completeResult(buildLocalToolCallFailureMessage(result), result);
        }

        if (shouldNudgeNow) {
          // Preserve the best text-only response before nudging, in case the
          // nudge produces an empty response (common with ChatGPT/gpt-5.4).
          // Never preserve content that already looks fabricated — otherwise a
          // later empty retry can resurrect an ungrounded "plan ready" / "built"
          // claim as the fallback response.
          if (trimmed.length > bestPreNudgeContent.length) {
            bestPreNudgeContent = trimmed;
          }
          continuationNudges++;

        // Permission-seeking gets a specific nudge — tell it to act, not ask.
        // Allow up to 3 permission nudges (not just 1) since models persist.
        const isPermissionSeeking = PERMISSION_SEEKING_PATTERN.test(trimmed);
        if (isPermissionSeeking && continuationNudges <= 3) {
          console.log(`[agentic-loop] permission-seeking nudge (${continuationNudges}/3): ${trimmed.slice(0, 100)}`);
          messages = [
            ...messages,
            { role: "assistant" as const, content: result.content },
            {
              role: "user" as const,
              content: "Do not ask for permission. Proceed with the next step. You only need user approval at phase transitions (ideate→plan→build→review→ship), not within a phase. Act now.",
            },
          ];
          continue;
        }

        // If the narration names a specific tool, call it out explicitly in the nudge
        // so the model doesn't pick a wrong tool from a generic list.
        const allToolNames = tools.map((t) => t.name);
        const mentionedTool = allToolNames.find((n) =>
          trimmed.toLowerCase().includes(n.toLowerCase().replace(/_/g, " ")) ||
          trimmed.includes(n),
        );
        const toolListStr = allToolNames.slice(0, 10).join(", ");
        const nudgeContent = mentionedTool
          ? `Stop narrating — call ${mentionedTool} now. Do not respond with text.`
          : `You have tools available — call one directly instead of describing what you want to do. Available: ${toolListStr}. Call the most relevant one now.`;
        // Tool names are user-influenced; route through the registered
        // sanitizeForLog sanitizer (strips control chars) so a CR/LF can't
        // forge a log entry, and use %s substitution (CodeQL js/log-injection).
        console.log(
          "[agentic-loop] nudging (tools used=%d, short response, mentioned=%s)",
          executedTools.length,
          sanitizeForLog(mentionedTool ?? "none"),
        );
        messages = [
          ...messages,
          ...(trimmed.length > 0
            ? [{ role: "assistant" as const, content: result.content }]
            : []),
          {
            role: "user" as const,
            content: nudgeContent,
          },
        ];
        continue;
      }

      // Frustration guardrail: agent is apologizing/hedging instead of acting.
      if (frustrationCount < 3 && FRUSTRATION_PATTERN.test(trimmed) && !result.toolsStripped) {
        frustrationCount++;
        console.warn(`[agentic-loop] frustration detected (${frustrationCount}/3): ${trimmed.slice(0, 100)}`);
        if (frustrationCount >= 3) {
          // 3 strikes — break and be honest with the user
          return completeResult(
            trimmed + "\n\nI've been struggling with this. Let me be direct about what's not working so you can help me get unstuck.",
            result,
          );
        }
        // Phase-aware nudge: suggest tools specific to what the agent should be doing
        const phaseTools = getPhaseSpecificNudge(executedTools);
        messages = [
          ...messages,
          { role: "assistant" as const, content: result.content },
          {
            role: "user" as const,
            content: `STOP apologizing and hedging. You have tools — use them. ${phaseTools} If a previous tool call failed, try a DIFFERENT approach. Do not repeat the same failing call.`,
          },
        ];
        continue;
      }

      // BI-2AC48661: plan completion gate. The model's text-only reply is its
      // natural "done" signal — but with an execution plan that still has open
      // steps, "done" is premature. Bounce it back to the next open step
      // (capped at MAX_PLAN_NUDGES so a model that refuses to mark steps can
      // still terminate). Skipped when tools were stripped (degraded mode) —
      // a tool-less model can't work the plan and must be allowed to answer.
      if (planEnabled && !result.toolsStripped) {
        const gate = planCompletionGate({ plan: executionPlan, planNudges, maxPlanNudges: MAX_PLAN_NUDGES });
        if (gate.action === "nudge" && gate.nudge) {
          planNudges++;
          console.log(`[agentic-loop] plan-incomplete nudge (${planNudges}/${MAX_PLAN_NUDGES})`);
          if (trimmed.length > bestPreNudgeContent.length) bestPreNudgeContent = trimmed;
          messages = [
            ...messages,
            ...(trimmed.length > 0 ? [{ role: "assistant" as const, content: result.content }] : []),
            { role: "user" as const, content: gate.nudge },
          ];
          continue;
        }
      }

      // Prefer pre-nudge content over empty; BI-1BB7408D strips unproven create claims.
      if (trimmed.length === 0 && bestPreNudgeContent.length > 0) {
        console.log(`[agentic-loop] recovering pre-nudge content (${bestPreNudgeContent.length} chars)`);
      }
      const finalContent = applyEscalationLadderGuard(applyBacklogCreateClaimGuard(
        trimmed.length > 0 ? result.content : (bestPreNudgeContent || result.content), executedTools), executedTools);
      // BI-41F15FD7 — observability only; content is returned unchanged.
      logGeneratedProse(finalContent, { threadId, modelId: result.modelId }, sanitizeForLog);
      logTurnSummary(result.providerId, result.modelId);
      return completeResult(finalContent, result, { executionPlan });
    }

    // Collect all immediate tool results for this iteration
    const iterationResults: Array<{ tc: ToolCallEntry; toolResult: ToolResult }> = [];

    for (const providerToolCall of result.toolCalls) {
      let tc = providerToolCall;
      if (params.terminalToolPolicy) {
        const normalized = normalizeTerminalToolArguments(
          params.terminalToolPolicy,
          tc.name,
          tc.arguments,
        );
        if (normalized.kind === "refuse") {
          executedTools.push({ name: tc.name, args: tc.arguments, result: normalized.result });
          iterationResults.push({ tc, toolResult: normalized.result });
          continue;
        }
        tc = { ...tc, arguments: normalized.arguments };
      }

      // BI-2AC48661: plan tools are loop-intrinsic. Intercept them here — they
      // mutate loop state and return a synthetic result; they never reach
      // governedExecuteTool, take no capability grant, and write no audit row.
      if (planEnabled && EXECUTION_PLAN_TOOL_NAMES.has(tc.name)) {
        const applied = applyPlanToolCall(executionPlan, tc.name, tc.arguments, iteration);
        executionPlan = applied.plan;
        // BI-655507BA: best-effort write-through so the plan survives a process
        // restart (not just compaction). Fire-and-forget; never throws.
        void persistExecutionPlan(threadId, executionPlan);
        console.log(
          `[agentic-tool] PLAN iter=${iteration} tool=${tc.name} success=${applied.result.success}` +
          (executionPlan ? ` progress=${planProgress(executionPlan).done}/${planProgress(executionPlan).total}` : ""),
        );
        // BI-95C0835E: stream the plan so the UI can render it executing
        // step-by-step. Only on a successful mutation that left a plan in place.
        if (applied.result.success && executionPlan) {
          const { done, total } = planProgress(executionPlan);
          onProgress?.({
            type: "plan:update",
            goal: executionPlan.goal,
            steps: executionPlan.steps.map((s) => ({ id: s.id, description: s.description, status: s.status })),
            done,
            total,
          });
        }
        iterationResults.push({ tc, toolResult: applied.result });
        continue;
      }

      // Loop-intrinsic: load_tools attaches deferred (already-authorized) tools
      // on demand so a right-sized coworker can reach its full granted surface
      // without paying every schema up front. Like the plan tools, it mutates
      // loop state, returns a synthetic result, and never reaches
      // governedExecuteTool (EP-COWORKER-INTERACTIVITY, BI-6A745E3C).
      if (tc.name === LOAD_TOOLS_TOOL_NAME) {
        const req = (tc.arguments ?? {}) as { names?: string[]; query?: string };
        const change = dynamicToolSurface.load(req);
        routeOptions.tools = toolsToOpenAIFormat(change.active);
        const loadedNames = change.loaded.map((t) => t.name);
        console.log(
          `[agentic-tool] LOAD_TOOLS iter=${iteration} initial=${dynamicToolSurface.initialCount} ` +
          `loaded=${JSON.stringify(loadedNames)} displaced=${JSON.stringify(change.displaced.map((t) => t.name))} ` +
          `unattached=${JSON.stringify(change.unattached.map((t) => t.name))} reason=${change.unattached.length ? "ceiling" : "none"} ` +
          `final=${change.active.length} ceiling=${dynamicToolSurface.ceiling} remaining=${dynamicToolSurface.deferredCount}`,
        );
        iterationResults.push({
          tc,
          toolResult: {
            success: true,
            message:
              loadedNames.length > 0
                ? `Loaded ${loadedNames.length} tool(s): ${loadedNames.join(", ")}. Call them on your next step.`
                : "No deferred tools matched. Use search_tool_marketplace to discover tools, or proceed with your current set.",
          },
        });
        continue;
      }

      if (params.terminalToolPolicy) {
        const disposition = resolveTerminalToolCall(params.terminalToolPolicy, executedTools, tc.name);
        if (disposition.kind === "refuse") {
          iterationResults.push({ tc, toolResult: disposition.result });
          continue;
        }
      }

      let toolDef = dynamicToolSurface.definition(tc.name);

      // Authority-preserving on-demand attach: if the model calls an authorized
      // tool that was deferred (not in this turn's attached set), promote it from
      // the deferred pool and execute it now. Deferral caps per-turn COST without
      // ever removing CAPABILITY — whether or not the model first called load_tools.
      if (dynamicToolSurface.isDeferred(tc.name)) {
        const change = dynamicToolSurface.promote(tc.name);
        if (change.loaded.length > 0) {
          routeOptions.tools = toolsToOpenAIFormat(change.active);
          toolDef = change.loaded[0];
          console.log(`[agentic-tool] AUTO_LOAD iter=${iteration} tool=${tc.name} (deferred → attached on direct call)`);
        }
      }

      // Proposal tools (side-effecting, need approval) — break the loop and return
      // Check for explicit "proposal" only — undefined executionMode defaults to immediate
      if (toolDef && toolDef.executionMode === "proposal") {
        // Pre-authorization gate: a tool can declare `autoApproveWhen` to skip
        // the proposal card when platform config already constitutes approval
        // (e.g. contribute_to_hive under contributionMode=contribute_all + DCO).
        // Without this gate, autonomous runs — where no human is present to
        // click approve — silently stall forever after emitting the tool call.
        let preAuthorized = false;
        if (toolDef.autoApproveWhen) {
          try {
            preAuthorized = await toolDef.autoApproveWhen({ userId, params: tc.arguments });
          } catch (err) {
            console.warn(`[agentic-tool] autoApproveWhen threw for ${tc.name}:`, err);
            preAuthorized = false;
          }
        }
        if (!preAuthorized) {
          logTurnSummary(result.providerId, result.modelId);
          return {
            content: result.content || `I'd like to ${tc.name.replace(/_/g, " ")} with the following details.`,
            providerId: result.providerId,
            modelId: result.modelId,
            downgraded: result.downgraded,
            downgradeMessage: result.downgradeMessage,
            totalInputTokens,
            totalOutputTokens,
            executedTools,
            proposal: {
              name: tc.name,
              arguments: tc.arguments,
              content: result.content || "",
            },
          };
        }
        console.log(`[agentic-tool] auto-approved iter=${iteration} tool=${tc.name} (pre-authorized via platform config)`);
        // Fall through to immediate execution below.
      }

      // Tool not in available list — capability-gated or not exposed on this route
      if (!toolDef) {
        const platformTool = PLATFORM_TOOLS.find((t) => t.name === tc.name);
        const reason = platformTool?.requiredCapability
          ? `requires the \`${platformTool.requiredCapability}\` capability, which is not available on this page`
          : `is not available in this context`;
        const hint = platformTool?.requiredCapability
          ? ` You can access this from the relevant section of the platform (e.g. Storefront, Customer, or Operations pages).`
          : "";
        console.warn(`[agentic-tool] NOT_AVAILABLE iter=${iteration} tool=${tc.name} reason=${reason}`);
        iterationResults.push({
          tc,
          toolResult: {
            success: false,
            error: `Tool not available`,
            message: `The tool \`${tc.name}\` ${reason}.${hint}`,
          },
        });
        continue;
      }

      // Propose-interception (BI-80532D5C): under a propose boundary, a
      // side-effecting non-artifact tool is captured as an AgentActionProposal
      // for the owner to approve instead of running now (null = execute normally).
      const proposalResult = await interceptToolCallAsProposal({
        toolDef,
        proposeSideEffects,
        toolName: tc.name,
        args: tc.arguments,
        agentId,
        threadId,
        routeContext,
        taskRunId: taskRunId ?? null,
      });
      if (proposalResult) {
        console.log(`[agentic-tool] PROPOSED iter=${iteration} tool=${tc.name} (propose boundary)`);
        executedTools.push({ name: tc.name, args: tc.arguments, result: proposalResult });
        iterationResults.push({ tc, toolResult: proposalResult });
        onProgress?.({ type: "tool:complete", tool: tc.name, success: proposalResult.success });
        continue;
      }

      // Immediate tools — execute
      onProgress?.({ type: "tool:start", tool: tc.name, iteration });

      const argsPreview = JSON.stringify(tc.arguments).slice(0, 300);
      console.log(`[agentic-tool] CALL iter=${iteration} tool=${tc.name} args=${argsPreview}`);

      const toolStartMs = Date.now();
      let toolResult: ToolResult;
      try {
        if (!tracker.activeSkillId && !hasResolvedSkillInvocation && tc.name !== LOAD_TOOLS_TOOL_NAME && !EXECUTION_PLAN_TOOL_NAMES.has(tc.name)) {
          hasResolvedSkillInvocation = true;
          try {
            const { getSkillsForAgent } = await import("@/lib/skills/runtime");
            const agentSkills = await getSkillsForAgent(agentId);
            const matchingSkill = agentSkills.find((s) => s.allowedTools.includes(tc.name));
            if (matchingSkill) {
              tracker.activeSkillId = matchingSkill.skillId;
              const { recordSkillUsageEvents } = await import("@/lib/skills/usage-events");
              void recordSkillUsageEvents({
                phase: "invoked",
                skillIds: [tracker.activeSkillId],
                agentId,
                userId,
                threadId,
                taskRunId: taskRunId ?? null,
                routeContext,
              });
            }
          } catch (err) {
            console.warn("[agentic-loop] failed to infer skill invocation:", err);
          }
        }

        toolResult = await governedExecuteTool({
          toolName: tc.name,
          rawParams: tc.arguments,
          userId,
          userContext,
          context: {
            routeContext,
            agentId,
            threadId,
            taskRunId: taskRunId ?? undefined,
            apiTokenId: apiTokenId ?? undefined,
            tokenScope: params.tokenScope,
            skillId: tracker.activeSkillId ?? undefined,
            // In-portal coworker chat turns attach COWORKER_READ_BASELINE_GRANTS
            // to the tool surface (actions/agent-coworker.ts). Flag the turn so
            // the governed grant check honours the same baseline at execution
            // time (BI-FD7E4D72) — otherwise a coworker whose own grants lack a
            // baseline read grant gets the tool attached but rejected on call.
            // Autonomous turns leave this false, so their authority is unchanged.
            coworkerReadBaseline: interactionMode === "chat",
            ...createAuthorizedSurfaceTurnGovernance({ interactionMode, apiTokenId, route: routeContext, chatHistory }),
            externalAccessEnabled: toolDef.requiresExternalAccess || undefined,
            // BI-F4A30FCB (Dale dogfood 2026-05-24): plumb the build the
            // user is messaging from into tool context so phase-scoped
            // tools (start_ideate_research, start_scout_research) can
            // target the correct build instead of "latest in phase".
            featureBuildId: params.featureBuildId ?? undefined,
            // EP-31815F97 S2 (BI-F82F4E04): when this loop runs a delegated
            // coworker, carry the active DelegationChain grouping id so each
            // ToolExecution joins its chain-of-custody back to the human origin.
            delegationChainId: params.delegationChainId ?? undefined,
          },
          source: "agentic-loop",
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[agentic-tool] UNCAUGHT iter=${iteration} tool=${tc.name}:`, errorMsg);
        toolResult = { success: false, error: errorMsg, message: `Tool ${tc.name} failed: ${errorMsg}` };
      }

      const durationMs = Date.now() - toolStartMs;
      const resultPreview = (toolResult.message ?? "").slice(0, 200);
      console.log(`[agentic-tool] RESULT iter=${iteration} tool=${JSON.stringify(tc.name)} success=${toolResult.success} duration=${durationMs}ms msg=${JSON.stringify(resultPreview)}`);

      // Sandbox circuit breaker: track consecutive unavailable responses
      if (!toolResult.success && (toolResult.error ?? toolResult.message ?? "").includes("No sandbox slots available")) {
        sandboxUnavailableCount++;
      }

      // Grant-starvation circuit breaker: governedExecuteTool returns the
      // rejection code in `error` ("forbidden_grant"). Count consecutive
      // rejections; any successful tool clears the streak so a mixed surface
      // (some grants present) never trips it.
      if (!toolResult.success && toolResult.error === "forbidden_grant") {
        forbiddenGrantStreak++;
        forbiddenGrantTools.add(tc.name);
      } else if (toolResult.success) {
        forbiddenGrantStreak = 0;
      }

      executedTools.push({ name: tc.name, args: tc.arguments, result: toolResult });
      if (toolResult.success && params.terminalToolPolicy?.readerToolNames.includes(tc.name)) {
        terminalToolSurfaceOverride = null; terminalToolNudges = 0;
      }
      iterationResults.push({ tc, toolResult });
      onProgress?.({ type: "tool:complete", tool: tc.name, success: toolResult.success });


    }

    // Append ONE assistant message (with toolCalls preserved) + N tool result messages.
    // This gives the model its own tool-call history in the native structured format
    // that callProvider will serialize correctly per provider.
    messages = [
      ...messages,
      {
        role: "assistant" as const,
        content: result.content,
        toolCalls: iterationResults.map(({ tc }) => tc.gemini ? result.toolCalls!.find((original) => original.id === tc.id) ?? tc : tc),
      },
      ...iterationResults.map(({ tc, toolResult }) => ({
        role: "tool" as const,
        // G1/P6 (context-engineering-standards.md): bound the model-facing
        // serialization to a window-proportional cap with an explicit
        // truncation notice. Replaces the prior silent `slice(0, 3000)`, which
        // left `message` unbounded and gave the model no signal that data was
        // cut. The stored toolResult (audit/receipts) is unaffected.
        content: clampToolResultForModel(toolResult, {
          maxChars: resolveToolResultCharCap(resolvedMaxContextTokens),
        }).text,
        toolCallId: tc.id,
      })),
    ];
  }

  // Safety limit reached — log it so we can tune if needed
  console.warn(
    `[agentic-loop] hit iteration ceiling (${iterationCeiling}` +
    `${iterationCeiling !== MAX_ITERATIONS ? `, warranted level=${effortWarrant?.level}` : ""}). ` +
    `executedTools=${executedTools.length}. ` +
    `This may indicate the model needs more room or is stuck in a loop.`,
  );
  if (params.terminalToolPolicy) {
    const terminalExit = resolveTerminalTextExit(params.terminalToolPolicy, executedTools, Math.max(1, terminalToolNudges));
    if (terminalExit.kind === "input-required") {
      return terminalFailure(terminalExit.message);
    }
  }
  const fallbackContent = lastResult?.content?.trim() ?? "";
  const fallbackIsRawToolUse = fallbackContent.length > 0 && extractToolCalls(fallbackContent).length > 0;
  const fallbackIsFabricated = detectFabrication(
    fallbackContent,
    executedTools.length,
    false,
    executedTools.map((tool) => tool.name),
    new Set(tools.filter((tool) => tool.sideEffect).map((tool) => tool.name)),
    tools.some((tool) => tool.sideEffect || BUILD_TOOL_NAMES.has(tool.name)),
  );
  const downgraded = lastResult?.downgraded ?? false;
  const exhaustedMessage = buildMaxIterationsExhaustedMessage({
    // BI-F4D3B9E9(d): carry the routed cause, not just the boolean, so this copy
    // agrees with the downgrade banner instead of contradicting it. Older results
    // that predate the field fall back to the unavailable reading only when they
    // actually reported a downgrade.
    downgradeReason: lastResult?.downgradeReason ?? (downgraded ? "provider-unavailable" : null),
    // The same binding cause the banner named, so the advice below it addresses
    // the constraint the owner was actually told about (BI-FB184D69).
    cause: lastResult?.downgradeCause ?? null,
    executedTools,
  });
  return {
    // Routing-resilience Slice D: a raw tool-use loop is a genuine model
    // hallucination and still gets the loop message. But a fabrication signal on
    // a DOWNGRADED turn yields to the downgrade-aware exhausted message (honest
    // infra copy) instead of the "underlying work wasn't recorded" build copy —
    // the exhaustion was driven by the backup provider, not by the model faking
    // work. Fabrication copy is reserved for healthy-provider false claims.
    content: fallbackIsRawToolUse
      ? buildRuntimeLimitToolLoopMessage(executedTools)
      : fallbackIsFabricated
      ? (downgraded
          ? exhaustedMessage
          // Conversational routes: keep the advice rather than discard it for a
          // build-recording failure that does not apply. Append an honest note
          // only on a hard, unbacked completion claim. Build routes keep the
          // existing fabrication copy.
          : !BUILD_ROUTE_PATTERN.test(routeContext)
          ? (HARD_COMPLETION_CLAIM_PATTERN.test(fallbackContent)
              ? `${fallbackContent}\n\n${buildUnsavedAdviceNote(routeContext)}`
              : fallbackContent)
          : buildFabricationFailureMessage({
              response: fallbackContent,
              tools,
              executedTools,
              routeContext,
            }))
      // Defect-B safety net (BI-C145F650): before the canned exhausted message,
      // prefer a correct answer preserved before a nudge over discarding it.
      : (lastResult?.content?.trim() ? lastResult.content : (bestPreNudgeContent || exhaustedMessage)),
    providerId: lastResult?.providerId ?? "unknown",
    modelId: lastResult?.modelId ?? "unknown",
    downgraded: lastResult?.downgraded ?? false,
    downgradeMessage: lastResult?.downgradeMessage ?? null,
    totalInputTokens,
    totalOutputTokens,
    executedTools,
    proposal: null,
    executionPlan,
  };
}
