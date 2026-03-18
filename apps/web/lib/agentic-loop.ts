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

    // No tool calls — agent is done, return the text response
    if (!result.toolCalls || result.toolCalls.length === 0) {
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

    // Process tool calls
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

      // Immediate tools — execute and continue the loop
      const toolResult = await executeTool(
        tc.name,
        tc.arguments,
        userId,
        { routeContext, agentId, threadId },
      );

      executedTools.push({ name: tc.name, result: toolResult });

      // Add the tool call and result to the message history for the next iteration
      messages = [
        ...messages,
        {
          role: "assistant" as const,
          content: result.content || `[Calling ${tc.name}]`,
        },
        {
          role: "user" as const,
          content: `[Tool result for ${tc.name}: ${toolResult.success ? toolResult.message : `Error: ${toolResult.error}`}${toolResult.data ? `\nData: ${JSON.stringify(toolResult.data).slice(0, 3000)}` : ""}]`,
        },
      ];
    }
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
