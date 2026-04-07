// apps/web/lib/agentic-loop.ts
// Agentic execution loop: LLM calls tools iteratively until it responds with text only.
// This is the core behavioral difference between a chatbot and an agent.

import { routeAndCall, type RoutedInferenceResult } from "@/lib/routed-inference";
import { executeTool, type ToolDefinition, type ToolResult } from "@/lib/mcp-tools";
import type { ChatMessage } from "@/lib/ai-inference";
import { prisma } from "@dpf/db";
import { agentEventBus } from "./agent-event-bus";
import { TIER_MINIMUM_DIMENSIONS, type QualityTier } from "../routing/quality-tiers";

// Safety ceiling — NOT a behavioral limit. The loop terminates when the model
// responds with text only (no tool calls), matching the Anthropic API pattern
// where the loop runs until stop_reason === "end_turn". This limit only prevents
// runaway loops. The model decides when it's done.
// Safety nets — the loop exits naturally when the model responds with text-only.
// These prevent infinite loops from bugs, not from normal workflows.
const MAX_ITERATIONS = 100;

// ─── Duration limits by task type ──────────────────────────────────────────
// Claude Code's ULTRAPLAN gives Opus 30 minutes for planning. We don't need
// that extreme, but weaker models (Haiku, local) need more time per iteration
// to produce the same quality — especially for ideate/plan phases where the
// model must search, reason, and compose structured evidence.
//
// Architecture: similar to Claude Code's model-per-task routing, but tuned
// for our narrower use case (digital product factory, not general coding).

const MAX_DURATION_MS = 120_000;          // 2 min — normal conversation
const MAX_DURATION_BUILD_MS = 600_000;    // 10 min — sandbox code gen (frontier models)
const MAX_DURATION_PLAN_MS = 300_000;     // 5 min — ideate/plan phases (evidence + search)
const MAX_DURATION_REVIEW_MS = 240_000;   // 4 min — review (tests + gate checks)
const MAX_DURATION_SHIP_MS = 300_000;     // 5 min — ship (deploy + promotion pipeline)
const MAX_AGENTIC_HISTORY_MESSAGES = 24;
const MAX_TOOL_RESULT_CHARS = 1_500;
const MAX_TEXT_MESSAGE_CHARS = 4_000;

// ─── Extracted for testability ──────────────────────────────────────────────

/** Determine whether the loop should nudge the model to use tools. */
const COMPLETION_CLAIM_PATTERN = /\b(built|deployed|shipped|created|implemented|saved|configured|tested|fixed|completed|installed|launched|starting up|initializing|applying|generating)\b|tests?\s+pass/i;

// Narration patterns: agent describes code or announces intent instead of calling tools.
// Includes preamble narration ("Let me check", "I need to fix") and intent announcements
// ("I'd like to generate...", "I would like to call...") that precede but do not replace tool use.
const NARRATION_PATTERN = /(?:here(?:'s| is) (?:the |exactly |what )|code (?:to add|change|pattern)|add (?:this |the following )|insert (?:this |before )|exact (?:lines|code|changes)|manually|copy[- ]paste|(?:let me|I (?:need to|should|will|'ll|can see)) (?:check|fix|add|read|look|verify|update|create|modify|examine|review|search|generate|call|run|fetch)|(?:I(?:'d| would) like to|I(?:'m going to| am going to)) (?:check|fix|add|read|look|verify|update|create|modify|examine|review|search|generate|call|run|fetch|use|get|pull|grab|query|scan|find|load|save|send))/i;

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

/** Detect when the agent claims completion or narrates code without having called build tools. */
export function detectFabrication(
  response: string,
  executedToolCount: number,
  hasProposal: boolean,
  executedToolNames?: string[],
): boolean {
  if (hasProposal) return false;

  // If no tools were called at all, any completion claim is fabrication
  if (executedToolCount === 0) return COMPLETION_CLAIM_PATTERN.test(response);

  // If tools were called but none were BUILD tools (only read/search), and the
  // response narrates code for the user — that's still fabrication
  const usedBuildTool = executedToolNames?.some((n) => BUILD_TOOL_NAMES.has(n)) ?? false;
  if (!usedBuildTool && NARRATION_PATTERN.test(response)) return true;

  return false;
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
}): boolean {
  // Permission-seeking gets up to 3 nudges; other nudge types get 1
  const isPermission = params.responseText ? PERMISSION_SEEKING_PATTERN.test(params.responseText) : false;
  const maxNudges = isPermission ? 3 : 1;
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
    if (isAskingClarification || isSubstantiveReply) return false;
    return true;
  }

  // Short response after using tools — model may have stalled
  if (params.executedToolCount > 0 && params.responseLength < 200) return true;

  // Agent is narrating code instead of using tools — nudge to use build tools
  if (params.responseText && NARRATION_PATTERN.test(params.responseText)) return true;

  // Agent is asking permission instead of acting — nudge to proceed
  if (params.responseText && PERMISSION_SEEKING_PATTERN.test(params.responseText)) return true;

  return false;
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
  executedTools: Array<{ name: string; args?: Record<string, unknown>; result: ToolResult }>;
  /** If a proposal tool was called, return it for approval card rendering */
  proposal: { name: string; arguments: Record<string, unknown>; content: string } | null;
};

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

/**
 * Annotate tool descriptions with session-aware hints based on what the agent
 * has already tried. Inspired by Claude Code's dynamic tool description system.
 * Mutates nothing — returns a new array.
 */
function enrichToolDescriptions(
  toolsForProvider: Array<Record<string, unknown>>,
  executedTools: Array<{ name: string; args?: Record<string, unknown>; result: { success: boolean; error?: string } }>,
): Array<Record<string, unknown>> {
  if (executedTools.length === 0) return toolsForProvider;

  // Build failure map: tool name → last error. If a tool succeeded after
  // failing, clear the warning — the tool recovered.
  const failures = new Map<string, string>();
  for (const t of executedTools) {
    if (!t.result.success && t.result.error) {
      failures.set(t.name, t.result.error.slice(0, 150));
    } else if (t.result.success) {
      failures.delete(t.name);
    }
  }

  if (failures.size === 0) return toolsForProvider;

  return toolsForProvider.map((tool) => {
    const name = tool.name as string;
    const lastError = failures.get(name);
    if (!lastError) return tool;

    const desc = tool.description as string;
    return {
      ...tool,
      description: `${desc} [WARNING: This tool failed earlier in this session with: "${lastError}". Consider a different approach or different arguments.]`,
    };
  });
}

function truncateMessageContent(content: string, maxChars: number, label: string): string {
  if (content.length <= maxChars) return content;
  const omitted = content.length - maxChars;
  const suffix = `\n...[truncated ${omitted} chars of earlier ${label}]`;
  return `${content.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function buildSaveEvidenceSignature(args: Record<string, unknown>): string | null {
  const field = typeof args.field === "string" ? args.field : null;
  if (!field) return null;

  if (field === "buildPlan") {
    const rawValue = (args.value ?? args.data) as Record<string, unknown> | undefined;
    if (!rawValue || typeof rawValue !== "object") return "buildPlan:empty";
    const fileStructure = Array.isArray(rawValue.fileStructure) ? rawValue.fileStructure : [];
    const tasks = Array.isArray(rawValue.tasks) ? rawValue.tasks : [];
    const taskTitles = tasks
      .slice(0, 3)
      .map((task) => (task && typeof task === "object" && "title" in task ? String((task as Record<string, unknown>).title ?? "") : ""))
      .join("|");
    return `buildPlan:${fileStructure.length}:${tasks.length}:${taskTitles}`;
  }

  return field;
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
  } = params;

  // EP-INF-012: Load admin-configured model assignment for this agent.
  // DB config takes precedence over code defaults in modelRequirements.
  const agentModelConfig = await prisma.agentModelConfig.findUnique({ where: { agentId } }).catch(() => null);

  // Resolve effective config: DB row > code defaults > nothing
  const effectiveConfig = agentModelConfig
    ? {
        minimumDimensions: TIER_MINIMUM_DIMENSIONS[agentModelConfig.minimumTier as QualityTier] ?? {},
        budgetClass: agentModelConfig.budgetClass as "minimize_cost" | "balanced" | "quality_first",
        preferredProviderId: agentModelConfig.pinnedProviderId ?? undefined,
        preferredModelId: agentModelConfig.pinnedModelId ?? undefined,
        // EP-INF-013: defaultEffort not yet in AgentModelConfig schema (EP-INF-013b).
        // Fall through to code-level default when DB row exists.
        ...(modelRequirements && typeof modelRequirements === "object" && "defaultEffort" in modelRequirements
          ? { effort: modelRequirements.defaultEffort as "low" | "medium" | "high" | "max" }
          : {}),
      }
    : {
        // Fall back to code-level modelRequirements (defaultMinimumTier / legacy)
        ...(modelRequirements && typeof modelRequirements === "object" && "defaultMinimumTier" in modelRequirements
          ? { minimumDimensions: TIER_MINIMUM_DIMENSIONS[modelRequirements.defaultMinimumTier as QualityTier] ?? {} }
          : modelRequirements && typeof modelRequirements === "object" && "minimumDimensions" in modelRequirements
            ? { minimumDimensions: modelRequirements.minimumDimensions as Record<string, number> }
            : {}),
        ...(modelRequirements && typeof modelRequirements === "object" && "defaultBudgetClass" in modelRequirements
          ? { budgetClass: modelRequirements.defaultBudgetClass as "minimize_cost" | "balanced" | "quality_first" }
          : modelRequirements && typeof modelRequirements === "object" && "budgetClass" in modelRequirements
            ? { budgetClass: modelRequirements.budgetClass as "minimize_cost" | "balanced" | "quality_first" }
            : {}),
        ...(modelRequirements && typeof modelRequirements === "object" && "preferredProviderId" in modelRequirements
          ? { preferredProviderId: modelRequirements.preferredProviderId as string }
          : {}),
        ...(modelRequirements && typeof modelRequirements === "object" && "preferredModelId" in modelRequirements
          ? { preferredModelId: modelRequirements.preferredModelId as string }
          : {}),
        // EP-INF-013: Read defaultEffort from code-level modelRequirements
        ...(modelRequirements && typeof modelRequirements === "object" && "defaultEffort" in modelRequirements
          ? { effort: modelRequirements.defaultEffort as "low" | "medium" | "high" | "max" }
          : {}),
      };

  // Build routeAndCall options once (reused every iteration)
  const routeOptions = {
    ...(toolsForProvider ? { tools: toolsForProvider } : {}),
    taskType: taskType ?? "conversation",
    ...effectiveConfig,
    ...(requireTools ? { requireTools: true } : {}),
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

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // EP-ASYNC-COWORKER-001: Check cancellation flag at each iteration boundary
    if (agentEventBus.isCancelled(threadId)) {
      agentEventBus.clearCancel(threadId);
      console.log(`[agentic-loop] cancelled by user at iteration ${iteration}`);
      break;
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

    // Repetition detector — if the same tool+key has been called 3+ times, the model is stuck.
    // For tools like saveBuildEvidence, different field arguments are distinct operations
    // (e.g., saving "designDoc" vs "buildPlan" is progress, not repetition).
    // Repetition = same tool with same key arguments called 3+ times.
    // Different arguments (e.g., different search queries, different fields) = progress.
    const toolCallCounts = new Map<string, number>();
    for (const t of executedTools) {
      const args = t.args as Record<string, unknown> | undefined;
      // Build a signature from the tool name + distinguishing argument values
      const keyParts = [t.name];
      if (t.name === "saveBuildEvidence" && args) {
        const evidenceSignature = buildSaveEvidenceSignature(args);
        if (evidenceSignature) keyParts.push(evidenceSignature);
      } else if (args?.field) keyParts.push(String(args.field));
      if (args?.query) keyParts.push(String(args.query).slice(0, 50));
      if (args?.glob) keyParts.push(String(args.glob).slice(0, 80));
      if (args?.path) keyParts.push(String(args.path));
      if (args?.offset != null) keyParts.push(`offset=${args.offset}`);
      if (args?.pattern) keyParts.push(String(args.pattern).slice(0, 50));
      if (args?.command) keyParts.push(String(args.command).slice(0, 80));
      if (args?.instruction) keyParts.push(String(args.instruction).slice(0, 50));
      const sig = keyParts.join(":");
      toolCallCounts.set(sig, (toolCallCounts.get(sig) ?? 0) + 1);
    }
    const repeatedTool = [...toolCallCounts.entries()].find(([, count]) => count >= 3);
    if (repeatedTool && iteration > 5) {
      console.warn(`[agentic-loop] tool repetition: ${repeatedTool[0]} called ${repeatedTool[1]} times. Breaking loop.`);
      messages = [
        ...messages,
        {
          role: "user" as const,
          content: `You've called ${repeatedTool[0]} ${repeatedTool[1]} times. Stop retrying and give the user a summary of what you accomplished so far. If something isn't working, say so honestly.`,
        },
      ];
      // Allow one more iteration for the model to respond with a summary, then exit
      const summaryResult = await routeAndCall(compactAgenticMessages(messages), systemPrompt, sensitivity, routeOptions);
      return {
        content: summaryResult.content || "I got stuck in a loop. Here's what I have so far — please check the build evidence.",
        providerId: summaryResult.providerId,
        modelId: summaryResult.modelId,
        downgraded: summaryResult.downgraded,
        downgradeMessage: summaryResult.downgradeMessage,
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
    const result = await routeAndCall(compactAgenticMessages(messages), systemPrompt, sensitivity, enrichedRouteOptions);

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
      });

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

      if (shouldNudgeNow) {
        // Preserve the best text-only response before nudging, in case the
        // nudge produces an empty response (common with ChatGPT/gpt-5.4).
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

        const toolNames = tools.slice(0, 5).map((t) => t.name).join(", ");
        console.log(`[agentic-loop] nudging (tools used=${executedTools.length}, short response)`);
        messages = [
          ...messages,
          ...(trimmed.length > 0
            ? [{ role: "assistant" as const, content: result.content }]
            : []),
          {
            role: "user" as const,
            content: `You have tools available — use them directly instead of responding with text. Your available tools include: ${toolNames}. Call the most relevant one now to complete the task.`,
          },
        ];
        continue;
      }

      // Fabrication guardrail: if agent claims completion without calling tools, retry once
      if (!fabricationRetried && detectFabrication(trimmed, executedTools.length, false, executedTools.map((t) => t.name))) {
        fabricationRetried = true;
        console.warn(
          `[agentic-loop] fabrication detected: claimed completion with 0 tools. Retrying.`,
        );
        messages = [
          ...messages,
          { role: "assistant" as const, content: result.content },
          {
            role: "user" as const,
            content: `STOP. You described code or claimed actions without using tools. Do NOT show code to the user. ${getPhaseSpecificNudge(executedTools)} Call a tool NOW.`,
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
      if (toolDef && toolDef.executionMode !== "immediate") {
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

      // Immediate tools — execute
      onProgress?.({ type: "tool:start", tool: tc.name, iteration });

      const argsPreview = JSON.stringify(tc.arguments).slice(0, 300);
      console.log(`[agentic-tool] CALL iter=${iteration} tool=${tc.name} args=${argsPreview}`);

      const toolStartMs = Date.now();
      let toolResult: ToolResult;
      try {
        toolResult = await executeTool(
          tc.name,
          tc.arguments,
          userId,
          { routeContext, agentId, threadId },
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[agentic-tool] UNCAUGHT iter=${iteration} tool=${tc.name}:`, errorMsg);
        toolResult = { success: false, error: errorMsg, message: `Tool ${tc.name} failed: ${errorMsg}` };
      }

      const durationMs = Date.now() - toolStartMs;
      const resultPreview = (toolResult.message ?? "").slice(0, 200);
      console.log(`[agentic-tool] RESULT iter=${iteration} tool=${tc.name} success=${toolResult.success} duration=${durationMs}ms msg=${resultPreview}`);

      // Audit: record every tool execution (fire-and-forget)
      prisma.toolExecution.create({
        data: {
          threadId: threadId ?? "",
          agentId: agentId ?? "unknown",
          userId,
          toolName: tc.name,
          parameters: tc.arguments as any,
          result: toolResult as any,
          success: toolResult.success,
          executionMode: "immediate",
          routeContext: routeContext ?? null,
          durationMs: Date.now() - toolStartMs,
        },
      }).catch(() => {});

      executedTools.push({ name: tc.name, args: tc.arguments, result: toolResult });
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
  return {
    content: lastResult?.content || "I ran into a limit while working on this. Try breaking your request into smaller steps.",
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
