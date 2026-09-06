import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTerminalToolSurface,
  buildTerminalToolReminder,
  createInitiativeReviewTerminalToolPolicy,
  enterTerminalWriterPhase,
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
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    path: "docs/superpowers/specs/immutable-review.md",
    version: "9295d1ad4f750c1c2b8c4dc65b8d37330c79bbe8",
    expectedBlobId: "35dc4375910ec72ff2b186718a323e9c1d278b9a",
  },
};

const completePage = {
  repositoryFullName: policy.immutableReaderArguments!.repositoryFullName,
  path: policy.immutableReaderArguments!.path,
  version: policy.immutableReaderArguments!.version,
  blobId: policy.immutableReaderArguments!.expectedBlobId,
  startLine: 1,
  endLine: 20,
  totalLines: 20,
  hasMore: false,
  nextCursor: null,
};

const partialPage = {
  ...completePage,
  totalLines: 40,
  hasMore: true,
  nextCursor: "page-2",
};

const read = (success = true, data: Record<string, unknown> | undefined = completePage, args: Record<string, unknown> = {}): TerminalToolRecord => ({
  name: "read_source_at_version",
  args,
  result: { success, ...(data ? { data } : {}) },
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
  it("bounds malformed correction and never retries success, approval, or authority failure", () => {
    const malformed = { name: policy.writerToolName, result: { success: false, error: "malformed-receipt" } };
    expect(resolveTerminalToolCall(policy, [read(), malformed, malformed, malformed], policy.writerToolName).kind).toBe("refuse");
    for (const result of [
      { success: true },
      { success: false, error: "approval_required", data: { envelopeId: "envelope" } },
      { success: false, error: "AUTHORIZATION_DENIED" },
    ]) {
      expect(resolveTerminalToolCall(policy, [read(), malformed, { name: policy.writerToolName, result }], policy.writerToolName).kind).toBe("refuse");
    }
  });
  it("BI-31159978 retains the writer for bounded correction of a malformed receipt", () => {
    const records: TerminalToolRecord[] = [read(), {
      name: policy.writerToolName,
      result: { success: false, error: "malformed-receipt" },
    }];
    expect(resolveTerminalToolCall(policy, records, policy.writerToolName)).toEqual({ kind: "allow" });
    expect(applyTerminalToolSurface(policy, records, [
      { type: "function", function: { name: policy.writerToolName } },
    ])).toHaveLength(1);
  });

  it("activates only when the bound reader and writer tools are both required", () => {
    expect(createInitiativeReviewTerminalToolPolicy(policy.writerToolName, [
      "read_source_at_version",
      policy.writerToolName,
    ], {
      repositoryFullName: policy.immutableReaderArguments!.repositoryFullName,
      path: policy.immutableReaderArguments!.path,
      commitSha: policy.immutableReaderArguments!.version,
      providerBlobId: policy.immutableReaderArguments!.expectedBlobId,
    })).toEqual({ ...policy, readerToolNames: ["read_source_at_version"] });
    expect(createInitiativeReviewTerminalToolPolicy(
      policy.writerToolName,
      [policy.writerToolName],
      {
        repositoryFullName: policy.immutableReaderArguments!.repositoryFullName,
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
    expect(normalizeTerminalToolArguments(policy, "read_source_at_version", { repositoryFullName: "other/repo" })).toMatchObject({
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
    expect(resolveTerminalToolCall(policy, [read(true, partialPage)], policy.writerToolName)).toMatchObject({
      kind: "refuse",
      result: { error: "terminal_writer_requires_complete_evidence" },
    });
    expect(resolveTerminalToolCall(policy, [read(true)], policy.writerToolName)).toEqual({ kind: "allow" });
  });

  it("counts searches as reader activity but never as complete artifact evidence", () => {
    expect(summarizeTerminalToolProgress(policy, [read(false), search(true)])).toEqual({
      readerAttempts: 2,
      successfulReaderCalls: 1,
      evidenceAvailable: false,
      partialEvidence: false,
      continuationCursor: null,
      paginationInvalid: false,
      writerAttempted: false,
      readerBudgetExhausted: false,
    });
  });

  it("requires an ordered first-to-final immutable page sequence", () => {
    const first = read(true, { ...completePage, endLine: 40, totalLines: 80, hasMore: true, nextCursor: "page-2" });
    const final = read(true, { ...completePage, startLine: 41, endLine: 80, totalLines: 80 }, { cursor: "page-2" });
    expect(summarizeTerminalToolProgress(policy, [first])).toMatchObject({
      evidenceAvailable: false,
      partialEvidence: true,
      continuationCursor: "page-2",
    });
    expect(summarizeTerminalToolProgress(policy, [first, final])).toMatchObject({
      evidenceAvailable: true,
      partialEvidence: false,
      continuationCursor: null,
      paginationInvalid: false,
    });
  });

  it("does not bridge cursor gaps, duplicate pages, or conflicting result identity", () => {
    const first = read(true, { ...completePage, endLine: 40, totalLines: 80, hasMore: true, nextCursor: "page-2" });
    const gap = read(true, { ...completePage, startLine: 41, endLine: 80, totalLines: 80 }, { cursor: "wrong" });
    const lineGap = read(true, { ...completePage, startLine: 42, endLine: 80, totalLines: 80 }, { cursor: "page-2" });
    const prematureFinal = read(true, { ...completePage, startLine: 41, endLine: 70, totalLines: 80 }, { cursor: "page-2" });
    const conflict = read(true, { ...completePage, path: "other.md" });
    expect(summarizeTerminalToolProgress(policy, [first, gap])).toMatchObject({
      evidenceAvailable: false,
      paginationInvalid: true,
    });
    expect(summarizeTerminalToolProgress(policy, [first, lineGap])).toMatchObject({
      evidenceAvailable: false,
      paginationInvalid: true,
    });
    expect(summarizeTerminalToolProgress(policy, [first, prematureFinal])).toMatchObject({
      evidenceAvailable: false,
      paginationInvalid: true,
    });
    expect(summarizeTerminalToolProgress(policy, [conflict])).toMatchObject({
      evidenceAvailable: false,
      paginationInvalid: true,
    });
  });

  it("closes incomplete traversal at six attempts without exposing the writer", () => {
    const partial = (index: number) => read(true, {
      ...completePage,
      startLine: index * 10 + 1,
      endLine: index * 10 + 10,
      totalLines: 70,
      hasMore: true,
      nextCursor: `page-${index + 2}`,
    }, index === 0 ? {} : { cursor: `page-${index + 1}` });
    const attempts = Array.from({ length: 6 }, (_, index) => partial(index));
    expect(resolveTerminalToolCall(policy, attempts, "read_source_at_version")).toMatchObject({
      kind: "refuse",
      result: { success: false, error: "terminal_reader_budget_exhausted" },
    });

    const providerTools = [
      { type: "function", function: { name: "read_source_at_version" } },
      { type: "function", function: { name: "search_source_at_version" } },
      { type: "function", function: { name: "record_initiative_evidence" } },
    ];
    expect(applyTerminalToolSurface(policy, attempts, providerTools)).toEqual([]);
    expect(resolveTerminalTextExit(policy, attempts, 0)).toMatchObject({
      kind: "input-required",
      message: expect.stringContaining("incomplete"),
    });
  });

  it("refuses excess readers within the same model tool-call batch", () => {
    const completed: TerminalToolRecord[] = [read()];
    expect(resolveTerminalToolCall(policy, completed, "search_source_at_version")).toMatchObject({
      kind: "refuse",
      result: { error: "terminal_evidence_complete" },
    });
  });

  it("refuses a second writer from the same provider tool-call batch", () => {
    expect(resolveTerminalToolCall(policy, [read(), writer(false)], policy.writerToolName)).toMatchObject({
      kind: "refuse",
      result: { error: "terminal_writer_already_attempted" },
    });
  });

  it("nudges once and then returns an explicit resumable wait when text arrives before the writer", () => {
    expect(resolveTerminalTextExit(policy, [read()], 0)).toMatchObject({
      kind: "nudge",
      allowedToolNames: ["record_initiative_evidence"],
    });
    expect(resolveTerminalTextExit(policy, [read()], 1)).toMatchObject({
      kind: "input-required",
      reason: "missing-terminal-writer",
      writerToolName: "record_initiative_evidence",
      message: expect.stringContaining("did not honor the required writer tool-call contract"),
    });
  });

  it("withholds the writer and names the continuation cursor while evidence is partial", () => {
    const partial = read(true, partialPage);
    const providerTools = [
      { type: "function", function: { name: "read_source_at_version" } },
      { type: "function", function: { name: "search_source_at_version" } },
      { type: "function", function: { name: policy.writerToolName } },
    ];
    expect(applyTerminalToolSurface(policy, [partial], providerTools).map((tool) => (
      tool.function as { name: string }
    ).name))
      .toEqual(["read_source_at_version"]);
    expect(resolveTerminalTextExit(policy, [partial], 0)).toMatchObject({
      kind: "nudge",
      allowedToolNames: ["read_source_at_version"],
      message: expect.stringContaining("page-2"),
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
    expect(buildTerminalToolReminder(policy, [read(false), search()])).toContain(
      "4 bounded evidence calls remain",
    );
    expect(buildTerminalToolReminder(policy, [read()])).toContain(`Call ${policy.writerToolName} now`);
  });

  it("does not treat a rejected governed writer as a completed receipt", () => {
    expect(resolveTerminalTextExit(policy, [read(), writer(false)], 0)).toMatchObject({
      kind: "input-required",
      reason: "missing-terminal-writer",
      message: expect.stringContaining("did not persist a valid receipt"),
    });
    expect(summarizeTerminalToolProgress(policy, [read(), writer(false)])).toMatchObject({
      writerAttempted: true,
    });
  });

  it("accepts only a successful writer or a persisted approval envelope as terminal", () => {
    const approval = {
      name: policy.writerToolName,
      result: {
        success: false,
        error: "approval_required",
        data: { envelopeId: "ENV-1" },
      },
    } satisfies TerminalToolRecord;
    expect(resolveTerminalTextExit(policy, [read(), writer(true)], 0)).toEqual({ kind: "complete" });
    expect(resolveTerminalTextExit(policy, [read(), approval], 0)).toEqual({ kind: "complete" });
  });

  it("enters a writer-only terminal phase from persisted immutable evidence", () => {
    const resumed = enterTerminalWriterPhase(policy);
    const providerTools = [
      { type: "function", function: { name: "read_source_at_version" } },
      { type: "function", function: { name: "search_source_at_version" } },
      { type: "function", function: { name: policy.writerToolName } },
    ];

    expect(summarizeTerminalToolProgress(resumed, [])).toMatchObject({
      evidenceAvailable: true,
      writerAttempted: false,
    });
    expect(applyTerminalToolSurface(resumed, [], providerTools)).toEqual([
      { type: "function", function: { name: policy.writerToolName } },
    ]);
    expect(applyTerminalToolSurface(resumed, [writer(false)], providerTools)).toEqual([]);
    expect(resolveTerminalToolCall(resumed, [], "read_source_at_version")).toMatchObject({
      kind: "refuse",
      result: { error: "terminal_writer_phase_reader_refused" },
    });
  });

  // Observed on BI-8E1FD1BD spec-approval, 2026-09-06. The reviewer had already
  // read the artifact successfully. It then hit this refusal six times and told
  // a human "BLOCKED - immutable evidence unavailable; all six evidence-reader
  // attempts failed" - the exact inverse of what the refusal says - and answered
  // with prose instead of its verdict, so the run ended with no receipt. The
  // refusal is a SUCCESS condition wearing an error's clothes, so its wording is
  // load-bearing: it must not contain anything a model can hear as "missing",
  // and it must say what happens if the writer is not called.
  it("phrases the writer-phase reader refusal so it cannot be read as missing evidence", () => {
    const resumed = enterTerminalWriterPhase(policy);
    const refusal = resolveTerminalToolCall(resumed, [], "read_source_at_version");
    expect(refusal.kind).toBe("refuse");
    const message = refusal.kind === "refuse" ? refusal.result.message : "";

    // States the true state before the instruction.
    expect(message).toMatch(/SUCCESS, NOT A FAILURE/);
    expect(message).toMatch(/persisted/);
    expect(message).toMatch(/[Nn]othing is missing/);
    // Names the consequence of answering with prose.
    expect(message).toMatch(new RegExp(policy.writerToolName));
    expect(message).toMatch(/NO receipt/);
    // Both verdicts are legitimate, so a reviewer does not read the nudge as
    // pressure to pass.
    expect(message).toMatch(/fail/i);
    // The words that caused the inversion must not appear.
    expect(message).not.toMatch(/\bunavailable\b/i);
    expect(message).not.toMatch(/\bblocked\b/i);
  });

  it("phrases the evidence-complete nudge the same way", () => {
    const resumed = enterTerminalWriterPhase(policy);
    const nudge = resolveTerminalTextExit(resumed, [], 0);
    expect(nudge.kind).toBe("nudge");
    const message = nudge.kind === "nudge" ? nudge.message : "";
    expect(message).toMatch(/succeeded|complete/);
    expect(message).toMatch(/[Nn]othing is missing/);
    expect(message).toMatch(/NO receipt/);
    expect(message).not.toMatch(/\bunavailable\b/i);
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
    vi.mocked(governedExecuteTool).mockImplementation(async ({ toolName }: { toolName: string }) => toolName === policy.writerToolName
      ? { success: false, message: "Receipt rejected." }
      : {
          success: true,
          message: "Immutable evidence page.",
          ...(toolName === "read_source_at_version" ? { data: completePage } : {}),
        });
  });

  it("traverses six contiguous pages before exposing exactly the writer", async () => {
    vi.mocked(governedExecuteTool).mockImplementation(async ({ toolName, rawParams }: { toolName: string; rawParams: Record<string, unknown> }) => {
      if (toolName === policy.writerToolName) return { success: false, message: "Receipt rejected." };
      const pageNumber = typeof rawParams.cursor === "string" ? Number(rawParams.cursor.replace("page-", "")) : 1;
      return {
        success: true,
        message: "Immutable evidence page.",
        data: {
          ...completePage,
          startLine: (pageNumber - 1) * 50 + 1,
          endLine: pageNumber * 50,
          totalLines: 300,
          hasMore: pageNumber < 6,
          nextCursor: pageNumber < 6 ? `page-${pageNumber + 1}` : null,
        },
      };
    });
    const readers = Array.from({ length: 6 }, (_, index) => ({
      id: `read-${index + 1}`,
      name: "read_source_at_version",
      arguments: index === 0 ? {} : { cursor: `page-${index + 1}` },
    }));
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(response("", [readers[0]!]) as never)
      .mockResolvedValueOnce(response("", [readers[1]!]) as never)
      .mockResolvedValueOnce(response("", [readers[2]!]) as never)
      .mockResolvedValueOnce(response("", [readers[3]!]) as never)
      .mockResolvedValueOnce(response("", [readers[4]!]) as never)
      .mockResolvedValueOnce(response("", [readers[5]!]) as never)
      .mockResolvedValueOnce(response("", [{ id: "writer", name: policy.writerToolName, arguments: {} }]) as never)
      .mockResolvedValueOnce(response("The governed writer rejected the assessment, so no receipt exists.") as never);
    const result = await runAgenticLoop(params);

    const secondTools = (vi.mocked(routeAndCall).mock.calls[1]![3] as { tools: typeof providerTools }).tools;
    const seventhTools = (vi.mocked(routeAndCall).mock.calls[6]![3] as { tools: typeof providerTools }).tools;
    expect(secondTools.map((tool) => tool.function.name)).toEqual(["read_source_at_version"]);
    expect(seventhTools.map((tool) => tool.function.name)).toEqual([policy.writerToolName]);
    expect(vi.mocked(governedExecuteTool).mock.calls.filter(([call]) => call.toolName === "read_source_at_version")).toHaveLength(6);
    expect(result.executedTools.at(-1)).toMatchObject({ name: policy.writerToolName, result: { success: false } });
    expect(result.failure).toMatchObject({ kind: "terminal-writer-missing" });
    expect(vi.mocked(routeAndCall)).toHaveBeenCalledTimes(8);
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

  it("executes only the first writer when a provider emits duplicates in one batch", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(response("", [
        { id: "writer-1", name: policy.writerToolName, arguments: { decision: "pass" } },
        { id: "writer-2", name: policy.writerToolName, arguments: { decision: "fail" } },
      ]) as never)
      .mockResolvedValueOnce(response("The sole governed writer attempt was rejected.") as never);

    const result = await runAgenticLoop({ ...params, terminalToolPolicy: enterTerminalWriterPhase(policy) });

    expect(vi.mocked(governedExecuteTool).mock.calls.filter(([call]) => call.toolName === policy.writerToolName))
      .toHaveLength(1);
    expect(result.executedTools.filter((tool) => tool.name === policy.writerToolName)).toHaveLength(1);
    expect(result.failure).toMatchObject({ kind: "terminal-writer-missing" });
  });

  it("returns a missing-writer failure after successful reads and two prose exits", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(response("", [{ id: "read", name: "read_source_at_version", arguments: {} }]) as never)
      .mockResolvedValueOnce(response("The evidence is sufficient for a judgment.") as never)
      .mockResolvedValueOnce(response("I have reviewed the evidence but will not call the writer.") as never);

    const result = await runAgenticLoop(params);

    expect(result.executedTools).toHaveLength(1);
    expect(result.failure).toEqual({
      kind: "terminal-writer-missing",
      message: expect.stringContaining("No receipt was created"),
    });
    expect(vi.mocked(routeAndCall)).toHaveBeenCalledTimes(3);
  });

  it("returns a missing-writer failure when the review budget expires after a successful read", async () => {
    const now = vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(300_001);
    vi.mocked(routeAndCall).mockResolvedValueOnce(
      response("", [{ id: "read", name: "read_source_at_version", arguments: {} }]) as never,
    );

    try {
      const result = await runAgenticLoop(params);

      expect(result.executedTools).toHaveLength(1);
      expect(result.failure).toEqual({
        kind: "terminal-writer-missing",
        message: expect.stringContaining("No receipt was created"),
      });
      expect(vi.mocked(routeAndCall)).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it("returns a missing-writer wait when routing fails after a successful read", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(response("", [{ id: "read", name: "read_source_at_version", arguments: {} }]) as never)
      .mockRejectedValueOnce(new Error("The only eligible local model is busy with another background job."));

    const result = await runAgenticLoop(params);

    expect(result.executedTools).toHaveLength(1);
    expect(result.executedTools[0]).toMatchObject({
      name: "read_source_at_version",
      result: { success: true },
    });
    expect(result.failure).toEqual({
      kind: "terminal-writer-missing",
      message: expect.stringContaining("No receipt was created"),
    });
  });

  it("starts a resumed terminal-writer turn with only the governed writer", async () => {
    const resumedPolicy = enterTerminalWriterPhase(policy);
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(response("I already have the persisted evidence.") as never)
      .mockResolvedValueOnce(response("", [{ id: "writer", name: policy.writerToolName, arguments: {} }]) as never)
      .mockResolvedValueOnce(response("The governed writer rejected the assessment, so no receipt exists.") as never);

    const result = await runAgenticLoop({ ...params, terminalToolPolicy: resumedPolicy });

    const firstTools = (vi.mocked(routeAndCall).mock.calls[0]![3] as { tools: typeof providerTools }).tools;
    const secondTools = (vi.mocked(routeAndCall).mock.calls[1]![3] as { tools: typeof providerTools }).tools;
    const firstToolChoice = (vi.mocked(routeAndCall).mock.calls[0]![3] as { toolChoice?: string }).toolChoice;
    const secondToolChoice = (vi.mocked(routeAndCall).mock.calls[1]![3] as { toolChoice?: string }).toolChoice;
    const firstTerminalWriter = (vi.mocked(routeAndCall).mock.calls[0]![3] as { terminalWriterToolName?: string }).terminalWriterToolName;
    const secondTerminalWriter = (vi.mocked(routeAndCall).mock.calls[1]![3] as { terminalWriterToolName?: string }).terminalWriterToolName;
    expect(firstTools.map((tool) => tool.function.name)).toEqual([policy.writerToolName]);
    expect(secondTools.map((tool) => tool.function.name)).toEqual([policy.writerToolName]);
    expect(firstToolChoice).toBe("required");
    expect(secondToolChoice).toBe("required");
    expect(firstTerminalWriter).toBe(policy.writerToolName);
    expect(secondTerminalWriter).toBe(policy.writerToolName);
    expect(result.executedTools).toEqual([
      expect.objectContaining({ name: policy.writerToolName }),
    ]);
  });

  it("preserves ordinary route-failure handling when no terminal policy applies", async () => {
    vi.mocked(routeAndCall).mockRejectedValueOnce(
      new Error("The only eligible local model is busy with another background job."),
    );

    const result = await runAgenticLoop({ ...params, terminalToolPolicy: undefined });

    expect(result.failure?.kind).not.toBe("terminal-writer-missing");
    expect(result.content).not.toContain("No receipt was created");
    expect((vi.mocked(routeAndCall).mock.calls[0]![3] as { toolChoice?: string }).toolChoice).toBeUndefined();
    expect((vi.mocked(routeAndCall).mock.calls[0]![3] as { terminalWriterToolName?: string }).terminalWriterToolName).toBeUndefined();
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
