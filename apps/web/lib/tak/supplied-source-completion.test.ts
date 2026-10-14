import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn() }, user: { findUnique: vi.fn() },
  toolExecution: { create: vi.fn() }, platformIssueReport: { create: vi.fn() },
  coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []) }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { runAgenticLoop } from "./agentic-loop";
import { classifyEvidenceRequirement } from "./evidence-requirement";
import { isSuppliedSourceAnalysis } from "./intent-taxonomy";
import { applyLocalDegradationCaveat } from "./local-degradation-caveat";

const prefix = "Read-only local review quality check. Review only the synthetic function below against its stated contract. Do not call any tools or change any records. Report only actionable contract violations, no speculative style findings. Return one JSON object with exactly verdict (PASS or FAIL) and issues (array of objects with field and explanation). PASS requires an empty issues array. Contract: Input is a plain JSON-compatible object with string title, string body, and object documentScope. serialize then JSON.parse must preserve every input field and its value, including documentScope. No unsupported values, cycles, custom prototypes, or getters are in scope. Function:\n";
const clean = "function serialize(input) { return JSON.stringify(input); }";
const defective = "function serialize(input) { const { documentScope, ...rest } = input; return JSON.stringify(rest); }";
const controls = [
  { message: prefix + clean, answer: '{"verdict":"PASS","issues":[]}' },
  { message: prefix + defective, answer: '{"verdict":"FAIL","issues":[{"field":"documentScope","explanation":"Omitted from serialized output."}]}' },
];
const tools = [{ name: "get_backlog_item", description: "Read current backlog", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false }];
const params = (message: string) => ({
  chatHistory: [{ role: "user" as const, content: message }],
  systemPrompt: "Answer the supplied-source question.", sensitivity: "confidential" as const,
  tools, toolsForProvider: [{ type: "function", function: { name: "get_backlog_item", parameters: {} } }],
  userId: "user-1", agentId: "reviewer", threadId: "thread-1", routeContext: "/platform/ai/providers/local",
  taskType: "chat", interactionMode: "chat" as const,
});

describe("supplied-source completion regression (BI-C145F650)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: true, groups: [{ platformRole: { roleId: "ceo" } }] } as never);
  });

  it.each(controls)("classifies actual local control as supplied evidence: $answer", ({ message }) => {
    expect(classifyEvidenceRequirement({ routeContext: "/platform/ai/providers/local", domainTools: ["get_backlog_item"], message }).required).toBe(false);
  });

  it.each(controls)("returns the complete source verdict after one local dispatch: $answer", async ({ message, answer }) => {
    vi.mocked(routeAndCall).mockResolvedValue({ content: answer, providerId: "local", modelId: "qwen", truncated: false, toolCalls: [], inputTokens: 10, outputTokens: 10, downgraded: false, downgradeMessage: null, toolsStripped: false, routeDecision: {} } as never);
    const result = await runAgenticLoop(params(message));
    expect(result.content).toBe(answer);
    expect(routeAndCall).toHaveBeenCalledTimes(1);
    expect(result.executedTools).toEqual([]);
  });

  it("accepts a declared verdict enum beside a closed fenced source", () => {
    expect(isSuppliedSourceAnalysis(`Review this code snippet. Return JSON verdict PASS or FAIL.\n\`\`\`js\n${clean}\n\`\`\``)).toBe(true);
  });

  it.each([
    `${prefix}${clean} Now tell me current provider health for {provider}`,
    `${prefix}${clean}; current provider health please`,
    `${prefix}${clean}\nDid the latest build pass?`,
    "Review this synthetic function.\nfunction sample(input) { return input; } Current provider health for {provider}",
    "Review this synthetic function. Return current provider health as JSON verdict PASS or FAIL.\n" + clean,
    "Review this synthetic function. Return JSON verdict PASS or FAIL.\nfunction broken(input) { return input;",
    "Do not use tools. Return JSON verdict PASS or FAIL. Is the provider running now?",
  ])("retains live-evidence obligations: %s", (message) => {
    expect(classifyEvidenceRequirement({ routeContext: "/platform/ai", domainTools: ["get_backlog_item"], message }).required).toBe(true);
  });

  it("does not claim tools were unavailable for a supplied-source answer", () => {
    const options = { providerId: "local", executedToolCount: 0, suppliedSourceEvidence: true };
    expect(applyLocalDegradationCaveat(controls[0]!.answer, options)).toBe(controls[0]!.answer);
  });

  it("still caveats a blind operational answer without supplied evidence", () => {
    expect(applyLocalDegradationCaveat("The current provider is healthy.", { providerId: "local", executedToolCount: 0 })).toContain("couldn't check live data");
  });

  it("does not let supplied-source prose satisfy a required terminal writer", async () => {
    const answer = controls[0]!.answer;
    vi.mocked(routeAndCall).mockResolvedValue({ content: answer, providerId: "local", modelId: "qwen", truncated: false, toolCalls: [], inputTokens: 10, outputTokens: 10, downgraded: false, downgradeMessage: null, toolsStripped: false, routeDecision: {} } as never);
    const writer = "record_initiative_design_review";
    const result = await runAgenticLoop({ ...params(controls[0]!.message),
      tools: [{ ...tools[0]!, name: writer, sideEffect: true }],
      toolsForProvider: [{ type: "function", function: { name: writer, parameters: {} } }],
      terminalToolPolicy: { writerToolName: writer, readerToolNames: ["read_source_at_version"], minimumSuccessfulReaderCalls: 1, maximumReaderCalls: 3, terminalPhase: "writer-only", persistedEvidenceAvailable: true },
    });
    expect(result.failure?.kind).toBe("terminal-writer-missing");
    expect(result.content).not.toBe(answer);
    expect(result.executedTools).toEqual([]);
  });
});
