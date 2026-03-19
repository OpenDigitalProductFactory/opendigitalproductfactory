// apps/web/lib/agentic-loop.ts
// Agentic execution loop: LLM calls tools iteratively until it responds with text only.
// This is the core behavioral difference between a chatbot and an agent.

import { callWithFailover, type FailoverResult } from "./ai-provider-priority";
import { callWithFallbackChain, type FallbackResult } from "./routing/fallback";
import type { RouteDecision } from "./routing/types";
import { executeTool, type ToolDefinition, type ToolResult } from "./mcp-tools";
import type { ChatMessage } from "./ai-inference";

// Safety ceiling — NOT a behavioral limit. The loop terminates when the model
// responds with text only (no tool calls), matching the Anthropic API pattern
// where the loop runs until stop_reason === "end_turn". This limit only prevents
// runaway loops. The model decides when it's done.
const MAX_ITERATIONS = 40;

// ─── Extracted for testability ──────────────────────────────────────────────

/** Determine whether the loop should nudge the model to use tools. */
const COMPLETION_CLAIM_PATTERN = /\b(built|deployed|shipped|created|implemented|saved|configured|tested|fixed|completed|installed|launched|starting up|initializing|applying|generating)\b|tests?\s+pass/i;

// Narration patterns: agent describes code for the user instead of calling tools
const NARRATION_PATTERN = /(?:here(?:'s| is) (?:the |exactly |what )|code (?:to add|change|pattern)|add (?:this |the following )|insert (?:this |before )|exact (?:lines|code|changes)|manually|copy[- ]paste)/i;

// Tools that actually build/write — not just read/search
const BUILD_TOOL_NAMES = new Set([
  "saveBuildEvidence", "reviewDesignDoc", "reviewBuildPlan",
  "launch_sandbox", "generate_code", "iterate_sandbox",
  "run_sandbox_tests", "deploy_feature", "generate_ux_test", "run_ux_test",
  "propose_file_change", "update_feature_brief", "create_backlog_item",
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

export function shouldNudge(params: {
  continuationNudges: number;
  iteration: number;
  maxIterations: number;
  hasTools: boolean;
  executedToolCount: number;
  responseLength: number;
  responseText?: string;
}): boolean {
  if (params.continuationNudges >= 1) return false;
  if (params.iteration >= params.maxIterations - 1) return false;
  if (!params.hasTools) return false;

  // First iteration with no tools called — always nudge
  if (params.executedToolCount === 0 && params.iteration === 0) return true;

  // Short response after using tools — model may have stalled
  if (params.executedToolCount > 0 && params.responseLength < 200) return true;

  // Agent is narrating code instead of using tools — nudge to use build tools
  if (params.responseText && NARRATION_PATTERN.test(params.responseText)) return true;

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
  executedTools: Array<{ name: string; result: ToolResult }>;
  /** If a proposal tool was called, return it for approval card rendering */
  proposal: { name: string; arguments: Record<string, unknown>; content: string } | null;
};

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
  modelRequirements?: Record<string, unknown>;
  routeDecision?: RouteDecision;
  onProgress?: (event: import("./agent-event-bus").AgentEvent) => void;
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
    modelRequirements,
    routeDecision,
    onProgress,
  } = params;

  let messages = [...chatHistory];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const executedTools: AgenticResult["executedTools"] = [];
  let lastResult: FailoverResult | FallbackResult | null = null;
  let continuationNudges = 0;
  let fabricationRetried = false;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let result: FailoverResult | FallbackResult;

    if (routeDecision?.selectedEndpoint) {
      // EP-INF-001: Use manifest-based routing with fallback chain
      const fbResult = await callWithFallbackChain(
        routeDecision,
        messages,
        systemPrompt,
        toolsForProvider,
      );
      result = fbResult;
    } else {
      // Legacy path: callWithFailover builds its own priority list
      result = await callWithFailover(
        messages,
        systemPrompt,
        sensitivity,
        {
          ...(toolsForProvider ? { tools: toolsForProvider } : {}),
          ...(modelRequirements && Object.keys(modelRequirements).length > 0 ? { modelRequirements } : {}),
        },
      );
    }

    lastResult = result;
    // Handle both token formats: FailoverResult has flat fields, FallbackResult has nested
    const inputTok = "inputTokens" in result ? (result as FailoverResult).inputTokens : result.tokenUsage?.inputTokens;
    const outputTok = "outputTokens" in result ? (result as FailoverResult).outputTokens : result.tokenUsage?.outputTokens;
    totalInputTokens += inputTok ?? 0;
    totalOutputTokens += outputTok ?? 0;

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
      const shouldNudgeNow = shouldNudge({
        continuationNudges,
        iteration,
        maxIterations: MAX_ITERATIONS,
        hasTools: !!(toolsForProvider && toolsForProvider.length > 0),
        executedToolCount: executedTools.length,
        responseLength: trimmed.length,
        responseText: trimmed,
      });

      if (shouldNudgeNow) {
        continuationNudges++;
        const toolNames = tools.slice(0, 5).map((t) => t.name).join(", ");
        console.log(`[agentic-loop] nudging (tools used=${executedTools.length}, short response)`);
        messages = [
          ...messages,
          ...(trimmed.length > 0
            ? [{ role: "assistant" as const, content: result.content }]
            : []),
          {
            role: "user" as const,
            content: `Do NOT describe code. Use your tools to make changes directly. Your build tools include: ${toolNames}. Call the most relevant one NOW — saveBuildEvidence to save evidence, launch_sandbox to start a sandbox, propose_file_change to modify files directly, or generate_code to write code in the sandbox.`,
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
            content: "STOP. You described code or claimed actions without using tools. Do NOT show code to the user. Call saveBuildEvidence to save your design, launch_sandbox to start the sandbox, propose_file_change to modify files, or create_backlog_item if you cannot proceed. Call a tool NOW.",
          },
        ];
        continue;
      }

      return {
        content: result.content,
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

      const toolResult = await executeTool(
        tc.name,
        tc.arguments,
        userId,
        { routeContext, agentId, threadId },
      );

      executedTools.push({ name: tc.name, result: toolResult });
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
