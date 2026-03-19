// apps/web/lib/agentic-loop.ts
// Agentic execution loop: LLM calls tools iteratively until it responds with text only.
// This is the core behavioral difference between a chatbot and an agent.

import { callWithFailover, type FailoverResult } from "./ai-provider-priority";
import { callWithFallbackChain, type FallbackResult } from "./routing/fallback";
import type { RouteDecision } from "./routing/types";
import { executeTool, type ToolDefinition, type ToolResult } from "./mcp-tools";
import type { ChatMessage } from "./ai-inference";

const MAX_ITERATIONS = 6;

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
  } = params;

  let messages = [...chatHistory];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const executedTools: AgenticResult["executedTools"] = [];
  let lastResult: FailoverResult | FallbackResult | null = null;
  let continuationNudges = 0;

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

      // Detect "stalled intent": agent narrates or acknowledges but doesn't call tools.
      // Only nudge once per loop, and only if iterations remain.
      const hasTools = toolsForProvider && toolsForProvider.length > 0;
      const canNudge = continuationNudges < 1 && iteration < MAX_ITERATIONS - 1 && hasTools;

      if (canNudge) {
        // Pattern (a): After tool use, agent says it will continue but stops
        const postToolStall = executedTools.length > 0
          && /(?:now I (?:have enough|can|will|'ll)|(?:I(?:'ll| will| need to| am going to| can now| have enough to)) (?:design|create|build|implement|proceed|set up|start|prepare|draft|generate|produce|write|put together|outline|define|propose))/i.test(trimmed);
        // Pattern (b): Agent narrates tool intent instead of calling tool
        const toolIntentNarration = /(?:(?:let me|I(?:'ll| will| can| should| need to)) (?:search|read|look|check|find|query|analyze|investigate|examine|review|fetch|scan|browse|inspect|explore))/i.test(trimmed);
        // Pattern (c): Short ack/affirmation without action
        const shortAck = trimmed.length < 80
          && /^(?:sure|ok|okay|absolutely|of course|certainly|right|yes|got it|understood|will do|on it|searching|looking|checking|let me|ready|perfect|great)/i.test(trimmed);
        // Pattern (d): Empty or trivially short response — model returned nothing useful
        const emptyResponse = trimmed.length < 5;
        // Pattern (e): Contamination — model mimics internal message formatting
        // instead of actually calling tools (e.g. outputs "[Calling tool_name]" as text)
        const contamination = /^\[(?:Calling|Tool result|tool used)/i.test(trimmed);

        if (postToolStall || toolIntentNarration || shortAck || emptyResponse || contamination) {
          continuationNudges++;
          const toolNames = tools.slice(0, 5).map((t) => t.name).join(", ");
          console.log(
            `[agentic-loop] nudging: postTool=${postToolStall} toolIntent=${toolIntentNarration} ` +
            `shortAck=${shortAck} empty=${emptyResponse} contamination=${contamination}`,
          );
          messages = [
            ...messages,
            ...(trimmed.length > 0
              ? [{ role: "assistant" as const, content: result.content }]
              : []),
            {
              role: "user" as const,
              content: `[System: Do not narrate or ask for permission — call a tool now. Your available tools include: ${toolNames}. Pick the most relevant one and call it.]`,
            },
          ];
          continue;
        }
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
      const toolResult = await executeTool(
        tc.name,
        tc.arguments,
        userId,
        { routeContext, agentId, threadId },
      );

      executedTools.push({ name: tc.name, result: toolResult });
      iterationResults.push({ tc, toolResult });
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

  // Max iterations reached — return whatever we have
  return {
    content: lastResult?.content || "I've completed the available actions. Let me know if you need anything else.",
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
