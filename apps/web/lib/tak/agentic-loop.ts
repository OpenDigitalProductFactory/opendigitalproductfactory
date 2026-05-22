// apps/web/lib/agentic-loop.ts
// Agentic execution loop: LLM calls tools iteratively until it responds with text only.
// This is the core behavioral difference between a chatbot and an agent.

import { routeAndCall, type RoutedInferenceResult } from "@/lib/routed-inference";
import { detectRepeatedToolCall, recordRepeatedToolIssue } from "@/lib/tak/runtime-issues";
import { PLATFORM_TOOLS, type ToolDefinition, type ToolResult } from "@/lib/mcp-tools";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import type { ChatMessage } from "@/lib/ai-inference";
import { prisma } from "@dpf/db";
import { agentEventBus } from "./agent-event-bus";
import { TIER_MINIMUM_DIMENSIONS, type QualityTier } from "../routing/quality-tiers";
import {
  DEFAULT_MINIMUM_CAPABILITIES,
  DEFAULT_MINIMUM_CONTEXT_TOKENS,
} from "@/lib/routing/agent-capability-types";
import { extractToolCalls } from "@/lib/routing/extract-tool-calls";
import type { AgentMinimumCapabilities } from "@/lib/routing/agent-capability-types";
import type { UserContext } from "@/lib/permissions";

// Safety ceiling — NOT a behavioral limit. The loop terminates when the model
// responds with text only (no tool calls), matching the Anthropic API pattern
// where the loop runs until stop_reason === "end_turn". This limit only prevents
// runaway loops. The model decides when it's done.
// Safety nets — the loop exits naturally when the model responds with text-only.
// These prevent infinite loops from bugs, not from normal workflows.
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
): boolean {
  if (hasProposal) return false;

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

  return `STOP. You described code or claimed actions without using tools. Do NOT show code to the user. ${getPhaseSpecificNudge(params.executedTools)} Call a tool NOW.`;
}

function buildFabricationFailureMessage(params: {
  response: string;
  tools: ToolDefinition[];
  executedTools: Array<{ name: string }>;
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
      "I caught myself saying the plan is ready before I'd actually recorded it. "
      + "I stopped so we don't end up with a half-saved plan. "
      + "Send me the same instruction again and I'll record it properly this time, "
      + "or open the build details to see what's saved so far."
    );
  }

  return (
    "I caught myself describing work without actually doing it, and stopped so we "
    + "don't end up with progress that isn't real. "
    + "Send me the same instruction again, or check the build details to see what's "
    + "been recorded so far."
  );
}

function buildLocalToolCallFailureMessage(_result: RoutedInferenceResult): string {
  // User-facing message: respects IDENTITY_BLOCK rule #5 — never expose
  // infrastructure names ("Docker Model Runner"), model IDs, or routing
  // architecture. The internal route + model details are already recorded
  // for engineers via RoutedInferenceResult.
  return (
    "I couldn't complete this with the model my admin assigned me. "
    + "Please try the question again — I'll route through a different model. "
    + "If it keeps failing, an admin can update my model assignment in the AI Workforce settings."
  );
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

function buildRuntimeLimitToolLoopMessage(executedTools: ExecutedTool[]): string {
  const toolSummary = summarizeExecutedToolNames(executedTools) || "the available tools";
  return [
    `I used ${toolSummary}, but the coworker hit the runtime limit before it produced a final answer.`,
    "I stopped before returning another raw tool request.",
    "The route and tool attempts were recorded; try a narrower question or use the finance reports directly for the current totals while we add a more direct finance-summary tool.",
  ].join(" ");
}

/**
 * Plain-English message for when the loop hits MAX_ITERATIONS without
 * producing a text-only response. Replaces the prior generic "I ran into
 * a limit while working on this. Try breaking your request into smaller
 * steps." which obscured the actual cause (usually: preferred provider
 * unavailable → fallback model overwhelmed by the tool surface). Respects
 * IDENTITY_BLOCK rule #5 — no provider/model/tool internals exposed.
 */
function buildMaxIterationsExhaustedMessage(params: {
  downgraded: boolean;
  executedTools: ExecutedTool[];
}): string {
  const toolSummary = summarizeExecutedToolNames(params.executedTools);
  const downgradeLead = params.downgraded
    ? "The model my admin assigned me was unavailable, so I worked through a backup that wasn't able to keep up with this task. "
    : "";
  const workNote = toolSummary
    ? `I made several attempts (${toolSummary}) but couldn't complete a final answer before hitting my safety limit.`
    : "I worked through several attempts but couldn't complete a final answer before hitting my safety limit.";
  const suggestion = params.downgraded
    ? "Please try the same question again — I'll route through a different model. If it keeps failing, an admin can update my model assignment in the AI Workforce settings."
    : "Try the same question again, or break it into a smaller piece.";
  return `${downgradeLead}${workNote} ${suggestion}`;
}

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
  allowFirstTurnTextOnlyReply?: boolean;
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

  // First iteration with no tools called — nudge UNLESS the response is a
  // clarifying question or a substantive conversational reply. Short questions
  // ending in "?" mean the model is asking for a required field it can't
  // reasonably assume (per rule 13). Conversational replies (>100 chars,
  // no completion claim or narration) are also valid — nudging those toward
  // tool calls causes empty second responses that trigger quality-gate failures.
  if (params.executedToolCount === 0 && params.iteration === 0) {
    const text = params.responseText?.trim() ?? "";
    const isAskingClarification = text.length < 250 && CLARIFYING_QUESTION_PATTERN.test(text);
    const isSubstantiveReply = text.length >= 100 && !COMPLETION_CLAIM_PATTERN.test(text) && !NARRATION_PATTERN.test(text);
    const isAllowedDirectReply = !!params.allowFirstTurnTextOnlyReply
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
 * Clause 2.6 platform path: detect when the agent's text asserts a tool
 * is unavailable AND that tool name appears in its delivered tool list.
 * Returns the offending tool name (or `(unspecified — generic refusal)`
 * for blanket "currently empty / pending" claims), or null.
 */
export function detectToolRefusedDespiteAvailability(
  responseText: string,
  deliveredTools: Array<{ name: string }>,
): string | null {
  if (!responseText) return null;
  const refusalPattern = /(?:not (?:available|enabled|granted|callable|in (?:my )?tool list|exposed)|isn['’]t (?:available|enabled|granted|callable|in (?:my )?tool list|exposed)|is missing|currently `?\[\]`?|pending (?:follow-on |grant)|don['’]t have (?:access|the ability))(?:\s+(?:in|for|to|yet|now|here))?/i;
  if (!refusalPattern.test(responseText)) return null;
  for (const tool of deliveredTools) {
    if (responseText.includes(tool.name)) return tool.name;
  }
  if (/currently `?\[\]`?|pending (?:follow-on |grant)/i.test(responseText)) {
    return "(unspecified — generic refusal)";
  }
  return null;
}

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

/**
 * Annotate tool descriptions with session-aware hints based on what the agent
 * has already tried. Inspired by Claude Code's dynamic tool description system.
 * Mutates nothing — returns a new array.
 */
export function enrichToolDescriptions(
  toolsForProvider: Array<Record<string, unknown>>,
  executedTools: Array<{ name: string; args?: Record<string, unknown>; result: { success: boolean; error?: string; data?: Record<string, unknown>; message?: string } }>,
): Array<Record<string, unknown>> {
  if (executedTools.length === 0) return toolsForProvider;

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

  if (failures.size === 0 && reviewVetoes.size === 0) return toolsForProvider;

  return toolsForProvider.map((tool) => {
    const name = tool.name as string;
    const lastError = failures.get(name);
    const veto = reviewVetoes.get(name);
    if (!lastError && !veto) return tool;

    const desc = tool.description as string;
    const warning = veto
      ? `[REVIEW REJECTION: ${veto}]`
      : `[WARNING: This tool failed earlier in this session with: "${lastError}". Consider a different approach or different arguments.]`;
    return {
      ...tool,
      description: `${desc} ${warning}`,
    };
  });
}

function truncateMessageContent(content: string, maxChars: number, label: string): string {
  if (content.length <= maxChars) return content;
  const omitted = content.length - maxChars;
  const suffix = `\n...[truncated ${omitted} chars of earlier ${label}]`;
  return `${content.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}


function compactAgenticMessages(messages: ChatMessage[]): ChatMessage[] {
  const scopedMessages = messages.length <= MAX_AGENTIC_HISTORY_MESSAGES
    ? messages
    : [messages[0]!, ...messages.slice(-(MAX_AGENTIC_HISTORY_MESSAGES - 1))];

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
          content: truncateMessageContent(message.content, MAX_TOOL_RESULT_CHARS, "tool output"),
        };
      }
      return {
        ...message,
        content: truncateMessageContent(message.content, MAX_TEXT_MESSAGE_CHARS, "message context"),
      };
    });
}

export async function runAgenticLoop(params: {
  chatHistory: ChatMessage[];
  systemPrompt: string;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
  tools: ToolDefinition[];
  toolsForProvider: Array<Record<string, unknown>> | undefined;
  userId: string;
  routeContext: string;
  agentId: string;
  threadId: string;
  taskType?: string;
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
   * Optional active FeatureBuild.id for attribution on guard-written
   * PlatformIssueReport rows. Caller should look this up alongside buildPhase.
   */
  featureBuildId?: string | null;
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
}): Promise<AgenticResult> {
  const {
    chatHistory,
    systemPrompt,
    sensitivity,
    tools,
    toolsForProvider,
    userId,
    routeContext,
    agentId,
    threadId,
    taskType,
    modelRequirements,
    onProgress,
    requireTools,
    agentDisplayName,
    taskRunId,
    apiTokenId,
    activeSkillId,
    agentMessageId,
  } = params;

  const userContext = await resolveUserContext(userId);

  // EP-INF-012: Load admin-configured model assignment for this agent.
  // DB config takes precedence over code defaults in modelRequirements.
  const agentModelConfig = await prisma.agentModelConfig.findUnique({ where: { agentId } }).catch(() => null);

  // EP-AGENT-CAP-002: Read capability floor from agent config.
  // Null DB value = use system default { toolUse: true }.
  // {} DB value = passive agent, no floor.
  const rawMinCaps = agentModelConfig?.minimumCapabilities as AgentMinimumCapabilities | null | undefined;
  const minimumCapabilities: AgentMinimumCapabilities =
    rawMinCaps !== null && rawMinCaps !== undefined ? rawMinCaps : DEFAULT_MINIMUM_CAPABILITIES;
  const agentMinimumContextTokens: number =
    agentModelConfig?.minimumContextTokens ?? DEFAULT_MINIMUM_CONTEXT_TOKENS;

  // Resolve effective config: DB row > code defaults > nothing
  const effectiveConfig = resolveEffectiveAgentRouteConfig({
    agentModelConfig,
    modelRequirements,
  });

  // Build routeAndCall options once (reused every iteration)
  const routeOptions = {
    ...(toolsForProvider ? { tools: toolsForProvider } : {}),
    taskType: taskType ?? "conversation",
    ...effectiveConfig,
    ...(requireTools ? { requireTools: true } : {}),
    ...(agentDisplayName ? { agentDisplayName } : {}),
    // EP-AGENT-CAP-002: Capability floor — passed through to pipeline Stage 1
    minimumCapabilities,
    agentMinimumContextTokens,
    agentId,
    ...(agentMessageId ? { agentMessageId } : {}),
    // mcpSession is forwarded through callWithFallbackChain → callProvider →
    // AdapterRequest. The Claude CLI execution adapter consumes it to mint a
    // short-lived JWT for `--mcp-config`, exposing platform tools as native
    // `mcp__dpf__*` tools instead of text-described prompt content. Other
    // adapters ignore the field. The agentic loop is the only place with
    // both userId and threadId in scope, so it is the natural source.
    mcpSession: { userId, agentId, threadId, routeContext },
  };

  let messages = [...chatHistory];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const executedTools: AgenticResult["executedTools"] = [];
  let lastResult: RoutedInferenceResult | null = null;
  let continuationNudges = 0;
  let fabricationRetried = false;
  let frustrationCount = 0;
  let bestPreNudgeContent = ""; // Preserve best text from before nudge
  const startTime = Date.now();
  let inferenceCallCount = 0;
  let sandboxUnavailableCount = 0; // Circuit breaker: stop trying sandbox tools if unavailable
  let previousResponseId: string | undefined; // Responses API conversation chaining
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
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
      return {
        content: "The sandbox is not available — no slots are free. Please ensure the sandbox container is running (check Docker Desktop), then try again.",
        providerId: lastResult?.providerId ?? "",
        modelId: lastResult?.modelId ?? "",
        downgraded: lastResult?.downgraded ?? false,
        downgradeMessage: lastResult?.downgradeMessage ?? null,
        totalInputTokens,
        totalOutputTokens,
        executedTools,
        proposal: null,
      };
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
    const hasReviewTools = executedTools.some(t =>
      t.name === "run_ux_test" || t.name === "evaluate_page" ||
      t.name === "check_deployment_windows"
    );
    const hasShipTools = executedTools.some(t =>
      t.name === "deploy_feature" || t.name === "execute_promotion" ||
      t.name === "register_digital_product_from_build" || t.name === "schedule_promotion"
    );
    const durationLimit = hasBuildTools ? MAX_DURATION_BUILD_MS
      : hasShipTools ? MAX_DURATION_SHIP_MS
      : hasPlanTools ? MAX_DURATION_PLAN_MS
      : hasReviewTools ? MAX_DURATION_REVIEW_MS
      : hasIdeateTools ? MAX_DURATION_PLAN_MS
      : MAX_DURATION_MS;
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
      console.warn(
        `[agentic-loop] local model spun through ${executedTools.length} tool calls without converging on a text answer. ` +
        `Exiting early with diagnostic. agent=${agentId} route=${routeContext}`,
      );
      return {
        content: buildLocalToolCallFailureMessage(lastResult),
        providerId: lastResult.providerId,
        modelId: lastResult.modelId,
        downgraded: lastResult.downgraded,
        downgradeMessage: lastResult.downgradeMessage,
        totalInputTokens,
        totalOutputTokens,
        executedTools,
        proposal: null,
      };
    }

    // Repetition detector — extracted to lib/tak/runtime-issues.ts so the
    // existing "agent stuck" PlatformIssueReport write and the new reflection
    // trigger share one detection site.
    //
    // No special-casing for review tools. reviewDesignDoc/reviewBuildPlan take no args,
    // so every call hashes identically — 3 calls trips the guard. This caps the agent at
    // 2 revision attempts per review, which is enough. If the design/plan still fails after
    // 2 revisions the user needs to intervene.
    const repeated = detectRepeatedToolCall({ executedTools, iteration });
    if (repeated) {
      console.warn(
        `[agentic-loop] stuck: ${repeated.toolName} called ${repeated.count}x with same args in last 40 calls.${repeated.reasonHint}`,
      );
      const content = buildRepeatedToolStopMessage({
        toolName: repeated.toolName,
        count: repeated.count,
        routeContext,
        reasonHint: repeated.reasonHint,
      });
      await recordRepeatedToolIssue({
        repeated,
        routeContext: routeContext ?? null,
        userId,
        agentId: agentId ?? null,
        threadId: threadId ?? null,
        taskRunId: taskRunId ?? null,
      });
      // Return immediately — do NOT make another inference call here.
      // The summary inference call was the source of 300s hangs when the preferred provider
      // was unavailable. The executedTools list already contains the full work history.
      return {
        content,
        providerId: "",
        modelId: "",
        downgraded: false,
        downgradeMessage: null,
        totalInputTokens,
        totalOutputTokens,
        executedTools,
        proposal: null,
      };
    }

    // Dynamic tool descriptions: annotate tools that failed earlier in this session
    // Inspired by Claude Code's session-aware tool description system.
    const enrichedRouteOptions = {
      ...routeOptions,
      ...(routeOptions.tools ? { tools: enrichToolDescriptions(routeOptions.tools as Array<Record<string, unknown>>, executedTools) } : {}),
    };

    // EP-INF-009b: All inference goes through V2 routing pipeline
    inferenceCallCount++;
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
            compactAgenticMessages(messages),
            systemPrompt,
            sensitivity,
            { ...enrichedRouteOptions, previousResponseId },
          ),
        );
      } else {
        result = await routeAndCall(
          compactAgenticMessages(messages),
          systemPrompt,
          sensitivity,
          { ...enrichedRouteOptions, previousResponseId },
        );
      }
    } catch (routeErr) {
      const msg = routeErr instanceof Error ? routeErr.message : String(routeErr);
      console.warn(`[agentic-loop] routeAndCall threw: ${msg}`);
      const isTooLarge = msg.startsWith("REQUEST_TOO_LARGE:");
      return {
        content: isTooLarge
          ? "Your conversation is too long for this AI provider. Please start a new thread to continue."
          : "The AI provider is temporarily unavailable. Please try again in about 30 seconds.",
        providerId: "unknown",
        modelId: "unknown",
        downgraded: false,
        downgradeMessage: null,
        totalInputTokens,
        totalOutputTokens,
        executedTools,
        proposal: null,
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
    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;

    // No tool calls — check if agent stalled with intent to continue
    if (!result.toolCalls || result.toolCalls.length === 0) {
      const trimmed = result.content.trim();

      // Diagnostic: log raw response so we can trace stalls
      console.log(
        `[agentic-loop] iter=${iteration} provider=${result.providerId} model=${result.modelId} ` +
        `toolCalls=0 contentLen=${trimmed.length} nudges=${continuationNudges} ` +
        `executedTools=${executedTools.length} content=${JSON.stringify(trimmed.slice(0, 200))}`,
      );

      // Build-specialist Operator Contract clause 2.6 — platform-side guards.
      // Detect contract violations the LLM cannot self-report. Each guard
      // writes a PlatformIssueReport tagged to the active build (when known).
      // Spec: docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md §2.6
      const writeContractIssue = (
        category: "tool-refused-despite-availability" | "zero-tool-call" | "unsaved-evidence",
        title: string,
        description: string,
        severity: "high" | "medium" = "high",
      ): void => {
        prisma.platformIssueReport.create({
          data: {
            reportId: `coworker-process-${Date.now()}-${threadId.slice(0, 8)}-${category}`,
            type: "runtime_error",
            severity,
            status: "open",
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
      const refusedToolName = detectToolRefusedDespiteAvailability(trimmed, tools);
      if (refusedToolName) {
        console.warn(`[agentic-loop] contract-violation tool-refused-despite-availability: ${refusedToolName}`);
        writeContractIssue(
          "tool-refused-despite-availability",
          `tool-refused-despite-availability: ${refusedToolName}`,
          `Agent ${agentId} on route ${routeContext} asserted that ${refusedToolName} is unavailable in iteration ${iteration}, but the tool was in the delivered tool list. Response excerpt: ${trimmed.slice(0, 500)}`,
        );
      }

      // 2.6b: zero-tool-call on phase-required turn
      if (executedTools.length === 0 && phaseRequiresToolCall(params.buildPhase)) {
        console.warn(`[agentic-loop] contract-violation zero-tool-call phase=${params.buildPhase}`);
        writeContractIssue(
          "zero-tool-call",
          `zero-tool-call on phase=${params.buildPhase}`,
          `Agent ${agentId} on route ${routeContext} closed iteration ${iteration} of build phase '${params.buildPhase}' with zero tool calls. Response excerpt: ${trimmed.slice(0, 500)}`,
        );
      }

      // 2.4: save-before-final-response — evidence in text but not persisted
      const unsavedField = detectUnsavedEvidence(trimmed, executedTools, params.buildPhase);
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
        return {
          content: `The model (${result.modelId}) returned an empty response and did not use any tools. This typically means it does not support the tool format required for this task. Try a different model or provider.`,
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

      const looksFabricated = detectFabrication(
        trimmed,
        executedTools.length,
        false,
        executedTools.map((t) => t.name),
        new Set(tools.filter((tool) => tool.sideEffect).map((tool) => tool.name)),
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

      // Repetition detector: if the model's response is asking a question that's
      // very similar to a previous assistant message, the user already answered it.
      // Inject a nudge telling the model to proceed with the answer already given.
      // This prevents the "ask the same scope question 5 times" loop.
      if (trimmed.length > 20 && trimmed.includes("?")) {
        const previousAssistantMessages = messages
          .filter(m => m.role === "assistant")
          .map(m => typeof m.content === "string" ? m.content : "");
        const trimmedLower = trimmed.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        const isRepeatQuestion = previousAssistantMessages.some(prev => {
          const prevLower = prev.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
          if (prevLower.length < 20) return false;
          // Check word overlap — if >60% of words match, it's a repeated question
          const trimmedWords = new Set(trimmedLower.split(/\s+/));
          const prevWords = prevLower.split(/\s+/);
          const overlap = prevWords.filter(w => trimmedWords.has(w)).length;
          return overlap / Math.max(prevWords.length, 1) > 0.6;
        });
        if (isRepeatQuestion) {
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
        if (!fabricationRetried) {
          fabricationRetried = true;
          console.warn(
            "[agentic-loop] fabrication detected: claimed completion without the required tool-backed evidence. Retrying.",
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
              }),
            },
          ];
          continue;
        }

        return {
          content: buildFabricationFailureMessage({
            response: trimmed,
            tools,
            executedTools,
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
        maxIterations: MAX_ITERATIONS,
        hasTools: !!(toolsForProvider && toolsForProvider.length > 0),
        executedToolCount: executedTools.length,
        responseLength: trimmed.length,
        responseText: trimmed,
        hasAuthoritativeToolExecution: executedTools.some(
          (executedTool) => executedTool.result.success && tools.some(
            (tool) => tool.name === executedTool.name && tool.sideEffect,
          ),
        ),
        allowFirstTurnTextOnlyReply: shouldAllowProviderStatusTextReply({
          routeContext,
          taskType,
          providerId: result.providerId,
          messages,
          responseText: trimmed,
        }),
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
            `[agentic-loop] local model produced text-only response for tool-backed turn; returning diagnostic instead of issuing a second nudge. agent=${agentId} route=${routeContext}`,
          );
          return {
            content: buildLocalToolCallFailureMessage(result),
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
        console.log(`[agentic-loop] nudging (tools used=${executedTools.length}, short response, mentioned=${mentionedTool ?? "none"})`);
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
          return {
            content: trimmed + "\n\nI've been struggling with this. Let me be direct about what's not working so you can help me get unstuck.",
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

      // If the final response is empty but we had a good pre-nudge response,
      // use that instead of returning nothing. This prevents quality-gate
      // failures when the nudge causes the model to return empty.
      const finalContent = trimmed.length > 0 ? result.content : (bestPreNudgeContent || result.content);
      if (trimmed.length === 0 && bestPreNudgeContent.length > 0) {
        console.log(`[agentic-loop] recovering pre-nudge content (${bestPreNudgeContent.length} chars)`);
      }

      return {
        content: finalContent,
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

    // Collect all immediate tool results for this iteration
    const iterationResults: Array<{
      tc: { id: string; name: string; arguments: Record<string, unknown> };
      toolResult: ToolResult;
    }> = [];

    for (const tc of result.toolCalls) {
      const toolDef = tools.find((t) => t.name === tc.name);

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

      // Immediate tools — execute
      onProgress?.({ type: "tool:start", tool: tc.name, iteration });

      const argsPreview = JSON.stringify(tc.arguments).slice(0, 300);
      console.log(`[agentic-tool] CALL iter=${iteration} tool=${tc.name} args=${argsPreview}`);

      const toolStartMs = Date.now();
      let toolResult: ToolResult;
      try {
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
            skillId: activeSkillId ?? undefined,
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
      console.log(`[agentic-tool] RESULT iter=${iteration} tool=${tc.name} success=${toolResult.success} duration=${durationMs}ms msg=${resultPreview}`);

      // Sandbox circuit breaker: track consecutive unavailable responses
      if (!toolResult.success && (toolResult.error ?? toolResult.message ?? "").includes("No sandbox slots available")) {
        sandboxUnavailableCount++;
      }

      executedTools.push({ name: tc.name, args: tc.arguments, result: toolResult });
      iterationResults.push({ tc, toolResult });
      onProgress?.({ type: "tool:complete", tool: tc.name, success: toolResult.success });

      // Governed Hermes learning Slice 1: attribute tool outcome to the
      // active skill (if any). Fire-and-forget — the SkillUsageEvent writer
      // catches DB errors so this can never delay the user response.
      if (activeSkillId) {
        const { recordSkillUsageEvents } = await import("@/lib/skills/usage-events");
        void recordSkillUsageEvents({
          phase: toolResult.success ? "completed" : "failed",
          skillIds: [activeSkillId],
          agentId,
          userId,
          threadId,
          taskRunId: taskRunId ?? null,
          routeContext,
          metadata: { toolName: tc.name, iteration, durationMs },
        });
      }
    }

    // Append ONE assistant message (with toolCalls preserved) + N tool result messages.
    // This gives the model its own tool-call history in the native structured format
    // that callProvider will serialize correctly per provider.
    messages = [
      ...messages,
      {
        role: "assistant" as const,
        content: result.content,
        toolCalls: result.toolCalls,
      },
      ...iterationResults.map(({ tc, toolResult }) => ({
        role: "tool" as const,
        content: toolResult.success
          ? `${toolResult.message}${toolResult.data ? `\n${JSON.stringify(toolResult.data).slice(0, 3000)}` : ""}`
          : `Error: ${toolResult.error ?? "unknown error"}`,
        toolCallId: tc.id,
      })),
    ];
  }

  // Safety limit reached — log it so we can tune if needed
  console.warn(
    `[agentic-loop] hit MAX_ITERATIONS (${MAX_ITERATIONS}). executedTools=${executedTools.length}. ` +
    `This may indicate the model needs more room or is stuck in a loop.`,
  );
  const fallbackContent = lastResult?.content?.trim() ?? "";
  const fallbackIsRawToolUse = fallbackContent.length > 0 && extractToolCalls(fallbackContent).length > 0;
  const fallbackIsFabricated = detectFabrication(
    fallbackContent,
    executedTools.length,
    false,
    executedTools.map((tool) => tool.name),
    new Set(tools.filter((tool) => tool.sideEffect).map((tool) => tool.name)),
  );
  const exhaustedMessage = buildMaxIterationsExhaustedMessage({
    downgraded: lastResult?.downgraded ?? false,
    executedTools,
  });
  return {
    content: fallbackIsRawToolUse
      ? buildRuntimeLimitToolLoopMessage(executedTools)
      : fallbackIsFabricated
      ? buildFabricationFailureMessage({
          response: fallbackContent,
          tools,
          executedTools,
        })
      : (lastResult?.content?.trim() ? lastResult.content : exhaustedMessage),
    providerId: lastResult?.providerId ?? "unknown",
    modelId: lastResult?.modelId ?? "unknown",
    downgraded: lastResult?.downgraded ?? false,
    downgradeMessage: lastResult?.downgradeMessage ?? null,
    totalInputTokens,
    totalOutputTokens,
    executedTools,
    proposal: null,
  };
}
