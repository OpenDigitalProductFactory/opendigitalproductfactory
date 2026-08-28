import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTerminalToolSurface,
  buildTerminalToolReminder,
  createInitiativeReviewTerminalToolPolicy,
  normalizeTerminalToolArguments,
  resolveTerminalTextExit,
  resolveTerminalToolCall,
  summarizeTerminalToolProgress,
  type TerminalToolPolicy,
  type TerminalToolRecord,
} from "./terminal-tool-policy";

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: { findUnique: vi.fn() },
    toolExecution: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    platformIssueReport: { create: vi.fn() },
    coworkerTurnMetric: { upsert: vi.fn() },
  },
}));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []) }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { runAgenticLoop } from "./agentic-loop";

const policy: TerminalToolPolicy = {
  writerToolName: "record_initiative_evidence",
  readerToolNames: ["read_source_at_version", "search_source_at_version"],
  minimumSuccessfulReaderCalls: 1,
  maximumReaderCalls: 6,
  immutableReaderArguments: {
    path: "docs/superpowers/specs/immutable-review.md",
    version: "9295d1ad4f750c1c2b8c4dc65b8d37330c79bbe8",
    expectedBlobId: "35dc4375910ec72ff2b186718a323e9c1d278b9a",
  },
};

const read = (success = true): TerminalToolRecord => ({
  name: "read_source_at_version",
  result: { success },
});

const search = (success = true): TerminalToolRecord => ({
  name: "search_source_at_version",
  result: { success },
});

const writer = (success = true): TerminalToolRecord => ({
  name: "record_initiative_evidence",
  result: { success },
});

describe("terminal tool policy", () => {
  it("activates only when the bound reader and writer tools are both required", () => {
    expect(createInitiativeReviewTerminalToolPolicy(policy.writerToolName, [
      "read_source_at_version",
      policy.writerToolName,
    ], {
      path: policy.immutableReaderArguments!.path,
      commitSha: policy.immutableReaderArguments!.version,
      providerBlobId: policy.immutableReaderArguments!.expectedBlobId,
    })).toEqual({ ...policy, readerToolNames: ["read_source_at_version"] });
    expect(createInitiativeReviewTerminalToolPolicy(
      policy.writerToolName,
      [policy.writerToolName],
      {
        path: policy.immutableReaderArguments!.path,
        commitSha: policy.immutableReaderArguments!.version,
        providerBlobId: policy.immutableReaderArguments!.expectedBlobId,
      },
    )).toBeNull();
  });

  it("binds empty provider reader arguments to the server-issued immutable identity", () => {
    expect(normalizeTerminalToolArguments(policy, "read_source_at_version", {})).toEqual({
      kind: "allow",
      arguments: policy.immutableReaderArguments,
    });
  });

  it("preserves only validated bounded pagination controls", () => {
    expect(normalizeTerminalToolArguments(policy, "read_source_at_version", {
      cursor: "page-2",
      startLine: 201,
      maxLines: 200,
      maxChars: 3200,
      ignored: "provider noise",
    })).toEqual({
      kind: "allow",
      arguments: {
        ...policy.immutableReaderArguments,
        cursor: "page-2",
        startLine: 201,
        maxLines: 200,
        maxChars: 3200,
      },
    });
    expect(normalizeTerminalToolArguments(policy, "read_source_at_version", { maxLines: 201 })).toMatchObject({
      kind: "refuse",
      result: { error: "terminal_reader_pagination_invalid" },
    });
  });

  it("fails closed on conflicting immutable identity or a missing server binding", () => {
    expect(normalizeTerminalToolArguments(policy, "read_source_at_version", { path: "other.md" })).toMatchObject({
      kind: "refuse",
      result: { error: "terminal_reader_identity_conflict" },
    });
    expect(normalizeTerminalToolArguments(
      { ...policy, immutableReaderArguments: undefined },
      "read_source_at_version",
      {},
    )).toMatchObject({
      kind: "refuse",
      result: { error: "terminal_reader_binding_missing" },
    });
  });

  it("does not alter non-review tool arguments", () => {
    const args = { query: "unchanged", nested: { value: 1 } };
    expect(normalizeTerminalToolArguments(policy, "unrelated_tool", args)).toEqual({
      kind: "allow",
      arguments: args,
    });
  });
  it("blocks the writer until one reader succeeds", () => {
    expect(resolveTerminalToolCall(policy, [], policy.writerToolName)).toMatchObject({
      kind: "refuse",
      result: { success: false, error: "terminal_writer_requires_evidence" },
    });
    expect(resolveTerminalToolCall(policy, [read(false)], policy.writerToolName)).toMatchObject({
      kind: "refuse",
      result: { success: false, error: "terminal_writer_requires_evidence" },
    });
    expect(resolveTerminalToolCall(policy, [read(true)], policy.writerToolName)).toEqual({ kind: "allow" });
  });

  it("counts every reader attempt but only successful readers as evidence", () => {
    expect(summarizeTerminalToolProgress(policy, [read(false), search(true)])).toEqual({
      readerAttempts: 2,
      successfulReaderCalls: 1,
      evidenceAvailable: true,
      writerAttempted: false,
      readerBudgetExhausted: false,
    });
  });

  it("closes readers at six attempts and exposes only the writer", () => {
    const attempts = [read(), search(), read(), search(), read(), search()];
    expect(resolveTerminalToolCall(policy, attempts, "read_source_at_version")).toMatchObject({
      kind: "refuse",
      result: { success: false, error: "terminal_reader_budget_exhausted" },
    });

    const providerTools = [
      { type: "function", function: { name: "read_source_at_version" } },
      { type: "function", function: { name: "search_source_at_version" } },
      { type: "function", function: { name: "record_initiative_evidence" } },
    ];
    expect(applyTerminalToolSurface(policy, attempts, providerTools)).toEqual([
      { type: "function", function: { name: "record_initiative_evidence" } },
    ]);
  });

  it("refuses excess readers within the same model tool-call batch", () => {
    const completed: TerminalToolRecord[] = [read(), search(), read(), search(), read()];
    expect(resolveTerminalToolCall(policy, completed, "search_source_at_version")).toEqual({ kind: "allow" });
    completed.push(search());
    expect(resolveTerminalToolCall(policy, completed, "read_source_at_version")).toMatchObject({
      kind: "refuse",
      result: { error: "terminal_reader_budget_exhausted" },
    });
  });

  it("nudges once and then fails closed when text arrives before the writer", () => {
    expect(resolveTerminalTextExit(policy, [read()], 0)).toMatchObject({
      kind: "nudge",
      allowedToolNames: ["record_initiative_evidence"],
    });
    expect(resolveTerminalTextExit(policy, [read()], 1)).toMatchObject({
      kind: "fail-closed",
      message: expect.stringContaining("without recording a governed assessment"),
    });
  });

  it("asks for evidence first when a text-only response precedes every read", () => {
    expect(resolveTerminalTextExit(policy, [], 0)).toMatchObject({
      kind: "nudge",
      allowedToolNames: ["read_source_at_version", "search_source_at_version"],
      message: expect.stringContaining("immutable evidence"),
    });
  });

  it("renders a compaction-safe reminder with the remaining reader budget", () => {
    expect(buildTerminalToolReminder(policy, [read(), search()])).toContain(
      "4 bounded evidence calls remain",
    );
    expect(buildTerminalToolReminder(policy, [read(), search(), read(), search(), read(), search()]))
      .toContain(`Call ${policy.writerToolName} now`);
  });

  it("treats any governed writer attempt as terminal without declaring it valid", () => {
    expect(resolveTerminalTextExit(policy, [read(), writer(false)], 0)).toEqual({ kind: "complete" });
    expect(summarizeTerminalToolProgress(policy, [read(), writer(false)])).toMatchObject({
      writerAttempted: true,
    });
  });
});

describe("agent loop terminal writer integration", () => {
  const response = (content: string, toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []) => ({
    content, toolCalls, inputTokens: 10, outputTokens: 5,
    providerId: "local", modelId: "local-test", downgraded: false,
    downgradeMessage: null, toolsStripped: false, routeDecision: {},
  });
  const names = ["read_source_at_version", "search_source_at_version", policy.writerToolName];
  const toolDefs = names.map((name) => ({
    name, description: name, inputSchema: {}, requiredCapability: null,
    executionMode: "immediate" as const, sideEffect: name === policy.writerToolName,
  }));
  const providerTools = names.map((name) => ({ type: "function", function: { name, parameters: {} } }));
  const params = {
    chatHistory: [{ role: "user" as const, content: "Review the bound design." }],
    systemPrompt: "Review independently and record the assessment.",
    sensitivity: "internal" as const, tools: toolDefs, toolsForProvider: providerTools,
    userId: "user-1", routeContext: "/review", agentId: "initiative-design-reviewer",
    threadId: "thread-1", terminalToolPolicy: policy,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isSuperuser: true,
      groups: [{ platformRole: { roleId: "ceo" } }],
    } as never);
    vi.mocked(governedExecuteTool).mockImplementation(async ({ toolName }: { toolName: string }) => ({
      success: toolName !== policy.writerToolName,
      message: toolName === policy.writerToolName ? "Receipt rejected." : "Immutable evidence page.",
    }));
  });

  it("removes readers after their budget and treats the writer attempt as terminal", async () => {
    const readers = Array.from({ length: 7 }, (_, index) => ({
      id: `read-${index}`,
      name: index % 2 ? "search_source_at_version" : "read_source_at_version",
      arguments: { cursor: String(index) },
    }));
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(response("", readers) as never)
      .mockResolvedValueOnce(response("I have enough evidence to assess this change.") as never)
      .mockResolvedValueOnce(response("", [{ id: "writer", name: policy.writerToolName, arguments: {} }]) as never)
      .mockResolvedValueOnce(response("The governed writer rejected the assessment, so no receipt exists.") as never);
    const result = await runAgenticLoop(params);

    const secondTools = (vi.mocked(routeAndCall).mock.calls[1]![3] as { tools: typeof providerTools }).tools;
    expect(secondTools.map((tool) => tool.function.name)).toEqual([policy.writerToolName]);
    expect(vi.mocked(governedExecuteTool).mock.calls.filter(([call]) => call.toolName !== policy.writerToolName)).toHaveLength(6);
    expect(result.executedTools.at(-1)).toMatchObject({ name: policy.writerToolName, result: { success: false } });
    expect(vi.mocked(routeAndCall)).toHaveBeenCalledTimes(4);
  });

  it("re-exposes the writer immediately after a reader-only recovery succeeds", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(response("I should inspect the immutable evidence first.") as never)
      .mockResolvedValueOnce(response("", [{ id: "read", name: "read_source_at_version", arguments: {} }]) as never)
      .mockResolvedValueOnce(response("", [{ id: "writer", name: policy.writerToolName, arguments: {} }]) as never)
      .mockResolvedValueOnce(response("The governed writer rejected the assessment, so no receipt exists.") as never);

    await runAgenticLoop(params);

    const secondTools = (vi.mocked(routeAndCall).mock.calls[1]![3] as { tools: typeof providerTools }).tools;
    const thirdTools = (vi.mocked(routeAndCall).mock.calls[2]![3] as { tools: typeof providerTools }).tools;
    expect(secondTools.map((tool) => tool.function.name)).toEqual(policy.readerToolNames);
    expect(thirdTools.map((tool) => tool.function.name)).toContain(policy.writerToolName);
  });

  it("executes, records, and carries forward server-bound arguments when the provider sends an empty object", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(response("", [{ id: "read", name: "read_source_at_version", arguments: {} }]) as never)
      .mockResolvedValueOnce(response("", [{ id: "writer", name: policy.writerToolName, arguments: {} }]) as never)
      .mockResolvedValueOnce(response("The governed writer rejected the assessment, so no receipt exists.") as never);

    const result = await runAgenticLoop(params);

    expect(vi.mocked(governedExecuteTool).mock.calls[0]?.[0]).toMatchObject({
      toolName: "read_source_at_version",
      rawParams: policy.immutableReaderArguments,
    });
    expect(result.executedTools[0]).toMatchObject({
      name: "read_source_at_version",
      args: policy.immutableReaderArguments,
    });
    const secondCallMessages = vi.mocked(routeAndCall).mock.calls[1]![0] as Array<{
      role: string;
      toolCalls?: Array<{ id: string; arguments: Record<string, unknown> }>;
    }>;
    expect(secondCallMessages.find((message) => message.role === "assistant")?.toolCalls?.[0]).toMatchObject({
      id: "read",
      arguments: policy.immutableReaderArguments,
    });
  });
});
