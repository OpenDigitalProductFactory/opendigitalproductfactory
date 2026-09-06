import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findModelConfig: vi.fn(),
  findTaskRun: vi.fn(),
  updateTaskRun: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveAgent: vi.fn(),
  resolveTools: vi.fn(),
}));
vi.mock("./mcp-task-review-outcome", () => ({
  loadInitiativeReviewOutcome: vi.fn(async (_binding: unknown, receiptId: string) => ({
    receiptId, summary: `Receipt ${receiptId} persisted. Implementation readiness: input-required; plan coverage remains missing.`,
  })),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
    taskRun: {
      findUnique: (...args: unknown[]) => db.findTaskRun(...args),
      update: (...args: unknown[]) => db.updateTaskRun(...args),
    },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("./mcp/external-approval-location-lookup", () => ({
  withTaskRunApprovalLocation: vi.fn(async (value: unknown) => value),
}));

import { executeRemoteTaskAttempt, remoteTaskConversation } from "./mcp-task-execution";
import { projectRemoteTaskReplay } from "./mcp-task-replay-projection";

const writerToolName = "record_initiative_evidence";
const parsed = {
  agentId: "AGT-WS-PORTFOLIO",
  routeContext: "/platform/build",
  title: "Independent research review",
  objective: "Review the immutable artifact.",
  prompt: "Read the source and record the governed evidence.",
  idempotencyKey: "initiative-readiness:BI-FFBDDD96:research:current-head-1",
  riskClass: "bounded-write" as const,
  authorityScope: [
    "backlog-item:BI-FFBDDD96",
    "tool:read_source_at_version",
    `tool:${writerToolName}`,
  ],
  collaborationKind: "handoff" as const,
  initiativeReviewBinding: {
    writerToolName,
    itemId: "BI-FFBDDD96",
    gate: "research" as const,
    artifactRef: {
      kind: "repo-blob-at-commit" as const,
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "0db795572b944370fa132b8c4ab11c759cc63bb1",
      path: "docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md",
      providerBlobId: "951fe02f7aa19a6a0866d42620c83bb8d3d9d8cd",
    },
  },
};

describe("remote task terminal-writer postcondition", () => {
  it("refuses completion from writer success without a receipt ID", async () => {
    autonomous.execute.mockResolvedValue({ content: "Approved, start implementation.", executedTools: [{ name: writerToolName, result: { success: true } }] });
    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run", taskRunId: "TR-NO-RECEIPT", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
      userContext: { platformRole: "developer", isSuperuser: false }, parsed, idempotentReplay: false, capacityAttempt: 1,
    });
    expect(outcome).toMatchObject({ kind: "result", result: { status: "input-required" } });
    expect(JSON.stringify(outcome)).toContain("without a receipt ID");
    expect(JSON.stringify(outcome)).not.toContain("start implementation");
  });
  it("BI-31159978 does not invent approval after a successful writer with stale input-required state", async () => {
    db.findTaskRun.mockResolvedValue({ status: "input-required", progressPayload: {} });
    autonomous.execute.mockResolvedValue({
      content: "Blocked: no receipt exists; request human approval.",
      executedTools: [{ name: writerToolName, result: {
        success: true, entityId: "initiative-persisted-receipt",
        data: { receiptId: "initiative-persisted-receipt" },
      } }],
    });
    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run-internal", taskRunId: "TR-MCP-STATUS-REPRO", contextId: "thread-1" },
      threadId: "thread-1",
      token: { tokenId: "PAT-WRITER-DURATION", userId: "user-1", capability: "write", source: "pat" },
      userContext: { platformRole: "developer", isSuperuser: false },
      parsed, idempotentReplay: true, capacityAttempt: 1,
    });
    expect(outcome).toMatchObject({ kind: "result", result: { requiresApproval: false } });
    expect(JSON.stringify(outcome)).not.toContain("no receipt exists");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db.findModelConfig.mockResolvedValue(null);
    db.findTaskRun.mockResolvedValue({ status: "working" });
    db.updateTaskRun.mockResolvedValue({});
    autonomous.resolveAgent.mockResolvedValue({
      agentId: "AGT-WS-PORTFOLIO",
      displayName: "Portfolio Advisor",
      systemPrompt: "Review independently.",
      sensitivity: "internal",
    });
    autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
  });

  it("parks a duration exit after a failed read retry when the required writer is absent", async () => {
    autonomous.execute.mockResolvedValue({
      content: "The first read failed due to a malformed version string in my call. Retrying with clean, exactly-bound parameters.",
      executedTools: [
        { name: "read_source_at_version", result: { success: false } },
        { name: "read_source_at_version", result: { success: true } },
      ],
    });

    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run-internal", taskRunId: "TR-MCP-7991D9CAE467", contextId: "thread-1" },
      threadId: "thread-1",
      token: { tokenId: "PAT-WRITER-DURATION", userId: "user-1", capability: "write", source: "pat" },
      userContext: { platformRole: "developer", isSuperuser: false },
      parsed,
      idempotentReplay: false,
      capacityAttempt: 1,
    });

    expect(db.updateTaskRun).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-7991D9CAE467" },
      data: expect.objectContaining({
        status: "input-required",
        completedAt: null,
        progressPayload: expect.objectContaining({
          executedToolCount: 2,
          terminalWriterWait: expect.objectContaining({
            kind: "missing-terminal-writer",
            writerToolName,
            resumeMode: "same-taskrun",
            attempt: 1,
          }),
        }),
      }),
    });
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        status: "input-required",
        resumable: true,
        waitReason: "missing-terminal-writer",
        executedToolCount: 2,
      },
    });
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      apiTokenId: "PAT-WRITER-DURATION",
      tokenScope: "write",
    }));
  });

  it("parks an approval-required terminal writer even when the tool did not project TaskRun state", async () => {
    db.findTaskRun.mockResolvedValue({
      status: "input-required",
      progressPayload: {
        auditMarker: "preserve-me",
        terminalWriterWait: { kind: "missing-terminal-writer", observedAt: "2026-09-06T02:00:00.000Z" },
        terminalWriterDispatchFailure: { code: "required-terminal-writer-not-enforceable", observedAt: "2026-09-06T02:00:00.000Z" },
        terminalWriterEscalation: { kind: "manual-recovery-required" },
        terminalWriterContextFailure: { code: "terminal_writer_context_unavailable" },
        resourceWait: { kind: "provider-capacity" },
      },
    });
    autonomous.execute.mockResolvedValue({
      content: "The objective mapping is ready for exact approval.",
      executedTools: [{
        name: writerToolName,
        args: { operation: "objective-mapping" },
        result: {
          success: false,
          error: "approval_required",
          message: "Approval is required.",
          data: { envelopeId: "ENV-OBJECTIVE-MAPPING" },
        },
      }],
    });

    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run-internal", taskRunId: "TR-MCP-APPROVAL-PROJECTION", contextId: "thread-1" },
      threadId: "thread-1",
      token: { tokenId: "PAT-WRITER-APPROVAL", userId: "user-1", capability: "write", source: "pat" },
      userContext: { platformRole: "developer", isSuperuser: false },
      parsed,
      idempotentReplay: true,
      resumeKind: "terminal-writer",
      capacityAttempt: 1,
      terminalWriterAttempt: 2,
    });

    expect(db.updateTaskRun).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-APPROVAL-PROJECTION" },
      data: expect.objectContaining({
        status: "input-required",
        completedAt: null,
        progressPayload: expect.objectContaining({
          requiresApproval: true,
          approvalEnvelopeId: "ENV-OBJECTIVE-MAPPING",
        }),
      }),
    });
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-APPROVAL-PROJECTION",
        status: "input-required",
        idempotentReplay: true,
        resumedFromTerminalWriterWait: true,
        requiresApproval: true,
      },
    });
    expect(db.updateTaskRun).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed" }),
    }));
    const progressPayload = db.updateTaskRun.mock.calls.at(-1)?.[0]?.data?.progressPayload;
    expect(progressPayload).toMatchObject({
      auditMarker: "preserve-me",
      requiresApproval: true,
      approvalEnvelopeId: "ENV-OBJECTIVE-MAPPING",
    });
    expect(progressPayload).not.toHaveProperty("terminalWriterWait");
    expect(progressPayload).not.toHaveProperty("terminalWriterDispatchFailure");
    expect(progressPayload).not.toHaveProperty("terminalWriterEscalation");
    expect(progressPayload).not.toHaveProperty("terminalWriterContextFailure");
    expect(progressPayload).not.toHaveProperty("resourceWait");
    expect(projectRemoteTaskReplay({
      existing: {
        taskRunId: "TR-MCP-APPROVAL-PROJECTION",
        status: "input-required",
        progressPayload,
        a2aMetadata: {},
      },
      requestMatches: true,
    })).toMatchObject({
      result: { requiresApproval: true },
    });
  });

  it("does not complete when the governed writer ran but produced neither receipt nor approval", async () => {
    autonomous.execute.mockResolvedValue({
      content: "The governed writer rejected the assessment.",
      executedTools: [{
        name: writerToolName,
        args: { decision: "pass" },
        result: {
          success: false,
          error: "CANONICAL_DESIGN_REQUIRED",
          message: "No canonical receipt was created.",
        },
      }],
    });

    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run-internal", taskRunId: "TR-MCP-WRITER-REJECTED", contextId: "thread-1" },
      threadId: "thread-1",
      token: { tokenId: "PAT-WRITER-REJECTED", userId: "user-1", capability: "write", source: "pat" },
      userContext: { platformRole: "developer", isSuperuser: false },
      parsed,
      idempotentReplay: true,
      resumeKind: "terminal-writer",
      capacityAttempt: 1,
      terminalWriterAttempt: 2,
    });

    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        status: "input-required",
        idempotentReplay: true,
        resumable: true,
        waitReason: "missing-terminal-writer",
      },
    });
    expect(db.updateTaskRun).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed" }),
    }));
  });

  it.each([
    ["record_initiative_evidence", 2, true, "required-terminal-writer-not-enforceable"],
    ["record_initiative_design_review", 2, true, "required-terminal-writer-not-enforceable"],
    ["record_initiative_evidence", 3, false, "terminal-writer-retry-exhausted"],
  ])("parks %s before inference when no routed adapter can force the writer (attempt %i)", async (
    requiredWriter,
    writerAttempt,
    resumable,
    waitReason,
  ) => {
    autonomous.execute.mockResolvedValue({
      content: "No eligible adapter can enforce the required terminal writer.",
      executedTools: [],
      failure: {
        kind: "required-terminal-writer-not-enforceable",
        message: "required-terminal-writer-not-enforceable: no eligible adapter can force the sole writer",
      },
    });
    const bound = {
      ...parsed,
      authorityScope: parsed.authorityScope
        .filter((scope) => !scope.startsWith("tool:record_initiative_"))
        .concat(`tool:${requiredWriter}`),
      initiativeReviewBinding: {
        ...parsed.initiativeReviewBinding,
        writerToolName: requiredWriter,
      },
    };

    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run-internal", taskRunId: "TR-MCP-7ECDD7A53D18", contextId: "thread-1" },
      threadId: "thread-1",
      token: { tokenId: "PAT-WRITER-BOUND", userId: "user-1", capability: "write", source: "pat" },
      userContext: { platformRole: "developer", isSuperuser: false },
      parsed: bound,
      idempotentReplay: true,
      resumeKind: "terminal-writer",
      capacityAttempt: 1,
      terminalWriterAttempt: writerAttempt,
    });

    expect(db.updateTaskRun).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-7ECDD7A53D18" },
      data: expect.objectContaining({
        status: "input-required",
        completedAt: null,
        progressPayload: expect.objectContaining({
          executedToolCount: 0,
          terminalWriterWait: expect.objectContaining({
            kind: "missing-terminal-writer",
            writerToolName: requiredWriter,
            resumeMode: "same-taskrun",
            attempt: writerAttempt,
          }),
          terminalWriterDispatchFailure: expect.objectContaining({
            code: "required-terminal-writer-not-enforceable",
            writerToolName: requiredWriter,
          }),
          ...(resumable ? {} : {
            terminalWriterEscalation: expect.objectContaining({
              code: "terminal_writer_retry_exhausted",
              writerToolName: requiredWriter,
              attempt: writerAttempt,
            }),
          }),
        }),
      }),
    });
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-7ECDD7A53D18",
        status: "input-required",
        idempotentReplay: true,
        resumedFromTerminalWriterWait: true,
        requiresApproval: false,
        resumable,
        waitReason,
        structuredContent: resumable
          ? { error: "required-terminal-writer-not-enforceable" }
          : expect.objectContaining({ error: "terminal_writer_retry_exhausted" }),
        executedToolCount: 0,
        isError: true,
      },
    });
  });
});

// BI-8B8731EE. A governed reviewer route that never reached a model is NOT a
// writer-contract failure. The platform already knows how to report that —
// `preInferenceResourceWait` projects a resumable `provider-capacity` wait — but
// the terminal-writer branch ran first and `terminalWriterMissing` is true for
// ANY governed route that executed no tools, which is exactly what a capacity
// deferral looks like. So every deferral on a reviewer route was reported as a
// missing receipt writer.
//
// Measured on the live install 2026-09-01: the terminal write landed on ~34% of
// external-MCP reviewer dispatches (35 completed / 49 input-required / 18
// failed). The portal log named the real cause on every stranded one:
// "routeAndCall threw: Local provider dispatch deferred:
// local-ci-queued-capacity-reservation" — governed local CI holding the host,
// which clears on its own in about 195s.
describe("a resource wait is not a missing terminal writer (BI-8B8731EE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.findModelConfig.mockResolvedValue(null);
    db.findTaskRun.mockResolvedValue({ status: "working" });
    db.updateTaskRun.mockResolvedValue({});
    autonomous.resolveAgent.mockResolvedValue({
      agentId: "AGT-WS-PORTFOLIO",
      displayName: "Portfolio Advisor",
      systemPrompt: "Review independently.",
      sensitivity: "internal",
    });
    autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
  });

  const attempt = () => executeRemoteTaskAttempt({
    run: { id: "run-internal", taskRunId: "TR-MCP-CAPACITY-DEFERRAL", contextId: "thread-1" },
    threadId: "thread-1",
    token: { tokenId: "PAT-WRITER-CAPACITY", userId: "user-1", capability: "write", source: "pat" },
    userContext: { platformRole: "developer", isSuperuser: false },
    parsed,
    idempotentReplay: false,
    capacityAttempt: 1,
  });

  it.each(["capacity", "busy"] as const)(
    "reports a %s deferral as a resumable provider-capacity wait, not a missing writer",
    async (failureKind) => {
      autonomous.execute.mockResolvedValue({
        content: "Local inference capacity is held by governed local CI.",
        executedTools: [],
        failure: { kind: failureKind, message: "Local inference capacity is held by governed local CI." },
      });

      const outcome = await attempt();

      expect(outcome).toMatchObject({
        kind: "result",
        result: {
          status: "submitted",
          resumable: true,
          waitReason: "provider-capacity",
          executedToolCount: 0,
        },
      });
      // The old behaviour: the caller was told the writer could not be
      // dispatched, and went auditing grants and tool surfaces instead of
      // waiting out a reservation.
      expect(outcome).not.toMatchObject({ result: { waitReason: "missing-terminal-writer" } });

      const payload = db.updateTaskRun.mock.calls.at(-1)?.[0]?.data?.progressPayload;
      expect(payload).toEqual(expect.objectContaining({
        resourceWait: expect.objectContaining({ kind: "provider-capacity", failureKind }),
      }));
      expect(payload).not.toHaveProperty("terminalWriterWait");
    },
  );

  it("still parks a genuine writer no-show, where the model ran and did not write", async () => {
    // The optimisation this fix must not undo: a reviewer that reached a model,
    // read the artifact and then answered in prose is a real writer-contract
    // failure and must stay `missing-terminal-writer`.
    autonomous.execute.mockResolvedValue({
      content: "In my assessment the design is sound.",
      executedTools: [{ name: "read_source_at_version", result: { success: true } }],
    });

    const outcome = await attempt();

    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        status: "input-required",
        resumable: true,
        waitReason: "missing-terminal-writer",
        content: [{
          type: "text",
          text: expect.stringContaining("did not invoke required writer"),
        }],
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("In my assessment the design is sound.");
  });

  it("does not divert a capacity failure that arrived AFTER real tool work", async () => {
    // preInferenceResourceWait is deliberately pre-inference: once the reviewer
    // has executed tools, a late capacity error is not a clean "nothing
    // happened yet" wait and must not masquerade as one.
    autonomous.execute.mockResolvedValue({
      content: "Capacity was lost partway through.",
      executedTools: [{ name: "read_source_at_version", result: { success: true } }],
      failure: { kind: "capacity", message: "Capacity was lost partway through." },
    });

    const outcome = await attempt();

    expect(outcome).toMatchObject({ result: { waitReason: "missing-terminal-writer" } });
  });
});

describe("remoteTaskConversation", () => {
  it("merges hydrated terminal-writer context into the sole system prompt", () => {
    expect(remoteTaskConversation({
      systemPrompt: "Review independently.",
      prompt: "Record the exact governed receipt.",
      resumeKind: "terminal-writer",
      terminalWriterContext: "Immutable artifact evidence",
    })).toEqual({
      systemPrompt: "Review independently.\n\nImmutable artifact evidence",
      chatHistory: [
        { role: "user", content: "Record the exact governed receipt." },
      ],
    });
  });

  it("keeps an ordinary task system prompt and user history unchanged", () => {
    expect(remoteTaskConversation({
      systemPrompt: "Review independently.",
      prompt: "Inspect the artifact.",
    })).toEqual({
      systemPrompt: "Review independently.",
      chatHistory: [
        { role: "user", content: "Inspect the artifact." },
      ],
    });
  });
});
