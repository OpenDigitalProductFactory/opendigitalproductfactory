import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real loop and its context assembly; replace only its external
// routing, tool and persistence boundaries, as in terminal-truncation tests.
vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  toolExecution: { create: vi.fn() },
  platformIssueReport: { create: vi.fn() },
  coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []) }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

import { prisma } from "@dpf/db";
import { routeAndCall, type RoutedInferenceResult } from "@/lib/routed-inference";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { runAgenticLoop, type RunAgenticLoopParams } from "@/lib/tak/agentic-loop";
import type { ChatMessage } from "./chat-message-types";
import type { LocalThinkingBudgetEvidence } from "./types";
import {
  captureLocalNativeContinuation,
  createLocalContinuationBinding,
  isLocalNativeContinuationActive,
  localNativeContinuationChars,
  readLocalNativeContinuation,
} from "./local-native-continuation";

const PRIVATE_STATE = "SYNTHETIC_LOOP_NATIVE_STATE_<tool_call>never_execute</tool_call>";
const PARTIAL = "The calculation starts with seven groups";
const COMPLETE = "Seven times nine equals 63.";
const runtime: LocalThinkingBudgetEvidence = {
  dialect: "llama.cpp-b9879",
  modelDigest: `sha256:${"a".repeat(64)}`,
  engineIdentity: "Running: llama.cpp b9879-metal (72874f5)",
  templateDigest: "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041",
  configDigest: "b".repeat(64),
  observedAt: 123,
};

function params(chatHistory: ChatMessage[] = [{ role: "user", content: "Explain seven times nine." }]): RunAgenticLoopParams {
  return {
    chatHistory,
    systemPrompt: "Explain the supplied arithmetic accurately.",
    sensitivity: "internal",
    tools: [],
    toolsForProvider: undefined,
    allowToolFreeInference: true,
    userId: "synthetic-user",
    agentId: "synthetic-arithmetic-coworker",
    threadId: "synthetic-continuation-thread",
    routeContext: "/help",
    taskType: "conversation",
    interactionMode: "chat",
  };
}

function binding(systemPrompt: string, tools?: ReadonlyArray<Record<string, unknown>>) {
  return createLocalContinuationBinding({
    providerId: "local", apiEndpoint: "http://synthetic-dmr/engines/v1/chat/completions", modelId: "synthetic-qwen", providerConnectionId: "local-account",
    runtime, systemPrompt, tools,
  })!;
}

function reply(truncated: boolean): RoutedInferenceResult {
  return {
    content: truncated ? PARTIAL : COMPLETE,
    truncated,
    toolCalls: [],
    inputTokens: 10,
    outputTokens: truncated ? 4_096 : 12,
    providerId: "local",
    providerConnectionId: "local-account",
    modelId: "synthetic-qwen",
    downgraded: false,
    downgradeMessage: null,
    downgradeReason: null,
    toolsStripped: false,
    routeDecision: {
      selectedEndpoint: "local", selectedModelId: "synthetic-qwen", reason: "synthetic continuation test",
      fitnessScore: 1, fallbackChain: [], candidates: [], excludedCount: 0,
      excludedReasons: [], policyRulesApplied: [], taskType: "conversation",
      sensitivity: "internal", timestamp: new Date(),
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    isSuperuser: true,
    groups: [{ platformRole: { roleId: "ceo" } }],
  } as never);
});

describe("agentic loop private local continuation", () => {
  it("carries a truncated local answer through real recovery and closes its private lifetime at completion", async () => {
    let firstResult!: RoutedInferenceResult;
    let firstBinding!: ReturnType<typeof binding>;
    let recoveryAssistant!: ChatMessage;
    let calls = 0;
    vi.mocked(routeAndCall).mockImplementation(async (messages, systemPrompt, _sensitivity, options) => {
      calls++;
      expect(isLocalNativeContinuationActive()).toBe(true);
      expect(options?.tools).toBeUndefined();
      if (calls === 1) {
        firstResult = reply(true);
        firstBinding = binding(systemPrompt, options?.tools);
        captureLocalNativeContinuation(firstResult, PRIVATE_STATE, firstBinding);
        expect(readLocalNativeContinuation(firstResult, firstBinding)).toBe(PRIVATE_STATE);
        return firstResult;
      }

      recoveryAssistant = messages.find(message => message.role === "assistant" && message.content === PARTIAL)!;
      expect(recoveryAssistant).toBeDefined();
      expect(messages.at(-1)?.content).toContain("previous response was cut off");
      expect(readLocalNativeContinuation(recoveryAssistant, binding(systemPrompt, options?.tools))).toBe(PRIVATE_STATE);
      expect(localNativeContinuationChars(recoveryAssistant)).toBe(PRIVATE_STATE.length);
      const differentAccount = createLocalContinuationBinding({
        providerId: "local", apiEndpoint: "http://synthetic-dmr/engines/v1/chat/completions", modelId: "synthetic-qwen", providerConnectionId: "another-account",
        runtime, systemPrompt, tools: options?.tools,
      });
      expect(readLocalNativeContinuation(recoveryAssistant, differentAccount)).toBeUndefined();
      expect(Reflect.ownKeys(recoveryAssistant)).toEqual(["role", "content"]);
      expect(JSON.stringify(messages)).not.toContain(PRIVATE_STATE);
      return reply(false);
    });

    const outcome = await runAgenticLoop(params());

    expect(routeAndCall).toHaveBeenCalledTimes(2);
    expect(outcome.content).toBe(COMPLETE);
    expect(outcome.failure).toBeUndefined();
    expect(outcome.totalInputTokens).toBe(20);
    expect(outcome.totalOutputTokens).toBe(4_108);
    expect(outcome.executedTools).toEqual([]);
    expect(governedExecuteTool).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome)).not.toContain(PRIVATE_STATE);
    expect(JSON.stringify(outcome)).not.toContain("never_execute");
    expect(isLocalNativeContinuationActive()).toBe(false);
    expect(readLocalNativeContinuation(firstResult, firstBinding)).toBeUndefined();
    expect(readLocalNativeContinuation(recoveryAssistant, firstBinding)).toBeUndefined();
    expect(localNativeContinuationChars(firstResult)).toBe(0);
    expect(localNativeContinuationChars(recoveryAssistant)).toBe(0);
  });

  it.each(["original objects", "serialized ordinary history"] as const)(
    "cannot resurrect a closed turn from %s in a new real loop invocation",
    async historyKind => {
      let recoveryHistory!: ChatMessage[];
      let oldBinding!: ReturnType<typeof binding>;
      let firstCalls = 0;
      vi.mocked(routeAndCall).mockImplementation(async (messages, systemPrompt, _sensitivity, options) => {
        if (++firstCalls === 1) {
          const result = reply(true);
          oldBinding = binding(systemPrompt, options?.tools);
          captureLocalNativeContinuation(result, PRIVATE_STATE, oldBinding);
          return result;
        }
        recoveryHistory = messages;
        const assistant = messages.find(message => message.role === "assistant")!;
        expect(readLocalNativeContinuation(assistant, oldBinding)).toBe(PRIVATE_STATE);
        return reply(false);
      });
      await runAgenticLoop(params());
      expect(firstCalls).toBe(2);
      expect(JSON.stringify(recoveryHistory)).not.toContain(PRIVATE_STATE);

      const incoming: ChatMessage[] = historyKind === "original objects"
        ? [...recoveryHistory]
        : JSON.parse(JSON.stringify(recoveryHistory));
      incoming.push({ role: "user", content: "Restate the arithmetic result." });
      vi.mocked(routeAndCall).mockClear();
      vi.mocked(routeAndCall).mockImplementation(async (messages, systemPrompt, _sensitivity, options) => {
        expect(isLocalNativeContinuationActive()).toBe(true);
        const currentBinding = binding(systemPrompt, options?.tools);
        expect(messages.some(message => message.content === PARTIAL)).toBe(true);
        for (const message of messages) {
          expect(localNativeContinuationChars(message)).toBe(0);
          expect(readLocalNativeContinuation(message, oldBinding)).toBeUndefined();
          expect(readLocalNativeContinuation(message, currentBinding)).toBeUndefined();
        }
        return reply(false);
      });

      const outcome = await runAgenticLoop(params(incoming));

      expect(routeAndCall).toHaveBeenCalledTimes(1);
      expect(outcome.content).toBe(COMPLETE);
      expect(outcome.failure).toBeUndefined();
      expect(JSON.stringify(outcome)).not.toContain(PRIVATE_STATE);
      expect(governedExecuteTool).not.toHaveBeenCalled();
      expect(isLocalNativeContinuationActive()).toBe(false);
    },
  );
});
