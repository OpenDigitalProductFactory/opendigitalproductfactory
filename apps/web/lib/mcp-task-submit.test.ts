import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findModelConfig: vi.fn(),
  findEnvelope: vi.fn(),
  findToolExecution: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  upsertThread: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({
  create: vi.fn(),
  execute: vi.fn(),
  executeTool: vi.fn(),
  resolveAgent: vi.fn(),
  resolveTools: vi.fn(),
}));
const records = vi.hoisted(() => ({ create: vi.fn() }));
const queue = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findFirst: (...args: unknown[]) => db.findFirst(...args),
      findUnique: (...args: unknown[]) => db.findUnique(...args),
      update: (...args: unknown[]) => db.update(...args),
      updateMany: (...args: unknown[]) => db.updateMany(...args),
    },
    coworkerActionEnvelope: { findFirst: (...args: unknown[]) => db.findEnvelope(...args) },
    toolExecution: { findFirst: (...args: unknown[]) => db.findToolExecution(...args) },
    agentThread: { upsert: (...args: unknown[]) => db.upsertThread(...args) },
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: (...args: unknown[]) => autonomous.create(...args),
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  executeAutonomousWorkTool: (...args: unknown[]) => autonomous.executeTool(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({
  createTaskMessage: (...args: unknown[]) => records.create(...args),
}));
vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: (...args: unknown[]) => queue.send(...args) },
}));
import { submitRemoteCoworkerTask } from "./mcp-task-submit";
const userContext = { platformRole: "developer", isSuperuser: false };
const immutableParams = {
  agentId: "AGT-WS-REVIEW",
  routeContext: "/platform/build",
  title: "Independent design review",
  objective: "Review BI-B131F357 at immutable commit 544830a.",
  prompt: "Review BI-B131F357 at immutable commit 544830a.",
  idempotencyKey: "initiative-review:BI-B131F357:544830a",
  riskClass: "high-risk",
  authorityScope: ["initiative_design_review"],
  collaborationKind: "summon",
};
function submit(tokenId: string, params: Record<string, unknown> = immutableParams) {
  return submitRemoteCoworkerTask({
    token: { tokenId, userId: "user-1", capability: "write", source: "pat" },
    userContext,
    params,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("DPF_EXTERNAL_MCP_TASK_ASYNC", "0");
  db.findFirst.mockResolvedValue(null);
  db.findUnique.mockResolvedValue({ status: "working" });
  db.findEnvelope.mockResolvedValue(null);
  db.findToolExecution.mockResolvedValue(null);
  db.findModelConfig.mockResolvedValue({
    minimumTier: "strong",
    budgetClass: "quality_first",
    pinnedProviderId: "local",
    pinnedModelId: "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
  });
  db.upsertThread.mockResolvedValue({ id: "thread-external" });
  db.update.mockResolvedValue({});
  db.updateMany.mockResolvedValue({ count: 1 });
  queue.send.mockResolvedValue({ ids: ["event-1"] });
  autonomous.create.mockImplementation(async (input: Record<string, unknown>) => ({
    id: "task-internal",
    taskRunId: input["taskRunId"],
    contextId: "thread-external",
  }));
  autonomous.resolveAgent.mockResolvedValue({
    agentId: "build-specialist",
    displayName: "Build Lead",
    systemPrompt: "Review the immutable artifact.",
    sensitivity: "internal",
  });
  autonomous.resolveTools.mockResolvedValue({
    tools: [],
    toolsForProvider: [],
    deferredTools: [],
  });
  autonomous.execute.mockResolvedValue({ content: "Done.", executedTools: [] });
  autonomous.executeTool.mockResolvedValue({ success: true, message: "Receipt recorded.", entityId: "REC-1" });
});

describe("submitRemoteCoworkerTask idempotency", () => {
  it("returns the durable task handle before a background execution settles", async () => {
    vi.stubEnv("DPF_EXTERNAL_MCP_TASK_ASYNC", "1");
    autonomous.execute.mockImplementation(() => new Promise(() => {}));

    const outcome = await submit("PAT-ASYNC", {
      ...immutableParams,
      riskClass: "bounded-write",
    });

    expect(outcome).toMatchObject({
      kind: "result",
      result: { status: "submitted", idempotentReplay: false },
    });
    expect(autonomous.execute).not.toHaveBeenCalled();
  });

  it("preserves input-required when a governed tool pauses the active TaskRun", async () => {
    db.findUnique.mockResolvedValue({ status: "input-required" });

    const outcome = await submit("PAT-A", {
      ...immutableParams,
      riskClass: "bounded-write",
    });

    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        status: "input-required",
        requiresApproval: true,
        idempotentReplay: false,
      },
    });
    expect(db.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed" }),
    }));
  });

  it("keeps a review input-required when successful reads end without its required writer", async () => {
    autonomous.execute.mockResolvedValue({
      content: "The independent review stopped without recording a governed assessment. No receipt was created.",
      executedTools: Array.from({ length: 5 }, (_, index) => ({
        name: "read_source_at_version",
        args: { startLine: index * 30 + 1 },
        result: { success: true },
      })),
      failure: {
        kind: "terminal-writer-missing",
        message: "The independent review stopped without recording a governed assessment. No receipt was created.",
      },
    });

    const outcome = await submit("PAT-WRITER-WAIT", {
      ...immutableParams,
      riskClass: "bounded-write",
      authorityScope: [
        "backlog-item:BI-F0715C9C",
        "tool:read_source_at_version",
        "tool:record_initiative_evidence",
      ],
      initiativeReviewBinding: {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-F0715C9C",
        gate: "research",
        artifactRef: {
          kind: "repo-blob-at-commit",
          repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
          commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
          path: "docs/superpowers/specs/design.md",
          providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
        },
      },
    });

    expect(db.update).toHaveBeenCalledWith({
      where: { taskRunId: expect.stringMatching(/^TR-MCP-/) },
      data: {
        status: "input-required",
        completedAt: null,
        progressPayload: {
          summary: expect.stringContaining("No receipt was created"),
          riskClass: "bounded-write",
          executedToolCount: 5,
          terminalWriterWait: {
            schemaVersion: 1,
            kind: "missing-terminal-writer",
            writerToolName: "record_initiative_evidence",
            resumeMode: "same-taskrun",
            dispatchContract: "required-tool-call",
            attempt: 1,
            observedAt: expect.any(String),
          },
        },
      },
    });
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        status: "input-required",
        requiresApproval: false,
        resumable: true,
        waitReason: "missing-terminal-writer",
        executedToolCount: 5,
        isError: false,
      },
    });
  });

  it.each(["none", "legacy", "explicit"])("consumes an approved exact-call envelope with %s retry exhaustion", async (exhaustion) => {
    const retryProgress = exhaustion === "none" ? {} : {
      terminalWriterWait: {
        schemaVersion: 1, kind: "missing-terminal-writer",
        writerToolName: "record_initiative_evidence", resumeMode: "same-taskrun",
        attempt: 3, observedAt: "2026-08-24T06:00:00.000Z",
      },
      ...(exhaustion === "explicit" ? { terminalWriterEscalation: {
        schemaVersion: 1, code: "terminal_writer_retry_exhausted",
        writerToolName: "record_initiative_evidence", attempt: 3,
        action: "select-different-reviewer-provider", observedAt: "2026-08-24T06:00:00.000Z",
      } } : {}),
    };
    const params = {
      agentId: "AGT-WS-BUILD",
      routeContext: "/build/work/WC-7FF8A505",
      objective: "Record the immutable research review.",
      prompt: "Read the source and record the governed evidence.",
      idempotencyKey: "research-review-approved-resume",
      riskClass: "bounded-write",
      authorityScope: [
        "backlog-item:BI-F0715C9C",
        "tool:read_source_at_version",
        "tool:record_initiative_evidence",
      ],
    };
    db.findFirst.mockResolvedValue({
      taskRunId: "TR-MCP-APPROVED",
      status: "input-required",
      updatedAt: new Date("2026-08-24T07:00:00.000Z"),
      progressPayload: {
        ...retryProgress,
        requiresApproval: true,
        approvalRecovery: {
          schemaVersion: 1,
          kind: "expired-approved-envelope",
          sourceEnvelopeId: "ENV-EXPIRED",
          replacementEnvelopeId: "ENV-APPROVED",
          inferenceRerun: false,
        },
      },
      a2aMetadata: {
        idempotencyKey: params.idempotencyKey,
        apiTokenId: "PAT-A",
        requestDigest: createHash("sha256").update(JSON.stringify({
          agentId: params.agentId,
          routeContext: params.routeContext,
          title: params.objective,
          objective: params.objective,
          prompt: params.prompt,
          riskClass: params.riskClass,
          authorityScope: [...params.authorityScope].sort(),
          collaborationKind: null,
        })).digest("hex"),
      },
    });
    db.findEnvelope.mockResolvedValue({
      id: "ENV-APPROVED",
      threadId: "thread-external",
      manifestActionId: "record_initiative_evidence",
    });
    db.findToolExecution.mockResolvedValue({
      parameters: {
        backlogItemId: "BI-F0715C9C",
        decision: "pass",
        artifactPath: "docs/superpowers/specs/design.md",
        artifactGitSha: "abc123",
        artifactBlobSha: "def456",
        artifactRepository: "OpenDigitalProductFactory/opendigitalproductfactory",
        note: "Independent research evidence is complete.",
        findings: [],
        _takAlignment: { verdict: "aligned" },
      },
      result: { data: { envelopeId: "ENV-APPROVED" } },
    });

    const outcome = await submit("PAT-A", params);

    expect(autonomous.executeTool).toHaveBeenCalledWith({
      toolName: "record_initiative_evidence",
      args: {
        backlogItemId: "BI-F0715C9C",
        decision: "pass",
        artifactPath: "docs/superpowers/specs/design.md",
        artifactGitSha: "abc123",
        artifactBlobSha: "def456",
        artifactRepository: "OpenDigitalProductFactory/opendigitalproductfactory",
        note: "Independent research evidence is complete.",
        findings: [],
      },
      userId: "user-1",
      userContext,
      routeContext: "/build/work/WC-7FF8A505",
      agentId: "AGT-WS-BUILD",
      threadId: "thread-external",
      taskRunId: "TR-MCP-APPROVED",
      apiTokenId: "PAT-A",
      tokenScope: "write",
      externalAccessEnabled: true,
    });
    expect(db.updateMany).toHaveBeenCalledWith({
      where: {
        taskRunId: "TR-MCP-APPROVED",
        status: "input-required",
        updatedAt: new Date("2026-08-24T07:00:00.000Z"),
      },
      data: {
        progressPayload: {
          ...retryProgress,
          approvalRecovery: {
            schemaVersion: 1,
            kind: "expired-approved-envelope",
            sourceEnvelopeId: "ENV-EXPIRED",
            replacementEnvelopeId: "ENV-APPROVED",
            inferenceRerun: false,
          },
          requiresApproval: true,
          approvalResumeReserved: true,
        },
      },
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-APPROVED" },
      data: { status: "working", lastHeartbeatAt: expect.any(Date) },
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-APPROVED" },
      data: {
        status: "completed",
        completedAt: expect.any(Date),
        progressPayload: expect.objectContaining({
          approvalRecovery: expect.objectContaining({
            kind: "expired-approved-envelope",
            sourceEnvelopeId: "ENV-EXPIRED",
            replacementEnvelopeId: "ENV-APPROVED",
            inferenceRerun: false,
          }),
          resumedFromApproval: true,
        }),
      },
    });
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-APPROVED",
        status: "completed",
        resumedFromApproval: true,
        executedToolCount: 1,
      },
    });
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(autonomous.execute).not.toHaveBeenCalled();
    const completed = db.update.mock.calls.find(([args]) => args.data.status === "completed")?.[0];
    expect(completed.data.progressPayload.requiresApproval).toBe(false);
    expect(completed.data.progressPayload.terminalWriterWait).toBeUndefined();
    expect(completed.data.progressPayload.terminalWriterEscalation).toBeUndefined();
  });

  it("binds a deterministic TaskRun and immutable digest to token + requestKey", async () => {
    const outcome = await submit("PAT-A");

    expect(outcome).toMatchObject({ kind: "result", result: { idempotentReplay: false } });
    const createInput = autonomous.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createInput["taskRunId"]).toMatch(/^TR-MCP-[A-Za-z0-9_-]+-[A-F0-9]{12}$/);
    const insecureUnkeyedId = `TR-MCP-${createHash("sha256")
      .update(`PAT-A\0${immutableParams.idempotencyKey}`)
      .digest("hex")
      .slice(0, 12)
      .toUpperCase()}`;
    expect(createInput["taskRunId"]).not.toBe(insecureUnkeyedId);
    expect(createInput).toMatchObject({
      agentId: "AGT-WS-REVIEW",
      sourceRef: { kind: "mcp-token", id: "PAT-A" },
      metadata: {
        idempotencyKey: "initiative-review:BI-B131F357:544830a",
        collaborationKind: "summon",
        apiTokenId: "PAT-A",
        requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(db.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "user-1",
        AND: expect.arrayContaining([
          { a2aMetadata: { path: ["apiTokenId"], equals: "PAT-A" } },
        ]),
      }),
    }));
  });

  it("replays only the same immutable request", async () => {
    await submit("PAT-A");
    const metadata = (autonomous.create.mock.calls[0]?.[0] as { metadata: Record<string, unknown> }).metadata;
    vi.clearAllMocks();
    db.findFirst.mockResolvedValue({
      taskRunId: "TR-MCP-EXISTING",
      status: "completed",
      progressPayload: { summary: "approved" },
      a2aMetadata: metadata,
    });

    const outcome = await submit("PAT-A");

    expect(outcome).toMatchObject({
      kind: "result",
      result: { taskRunId: "TR-MCP-EXISTING", idempotentReplay: true },
    });
    expect(autonomous.create).not.toHaveBeenCalled();
  });

  it("rejects reuse of a request key with a changed immutable packet", async () => {
    db.findFirst.mockResolvedValue({
      taskRunId: "TR-MCP-EXISTING",
      status: "completed",
      progressPayload: null,
      a2aMetadata: { ...immutableParams, apiTokenId: "PAT-A", requestDigest: "0".repeat(64) },
    });

    const outcome = await submit("PAT-A");

    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        isError: true,
        structuredContent: { error: "idempotency_conflict", taskRunId: "TR-MCP-EXISTING" },
      },
    });
    expect(autonomous.create).not.toHaveBeenCalled();
  });

  it("does not share task identity across tokens with the same request key", async () => {
    await submit("PAT-A");
    await submit("PAT-B");

    const firstId = (autonomous.create.mock.calls[0]?.[0] as Record<string, unknown>)["taskRunId"];
    const secondId = (autonomous.create.mock.calls[1]?.[0] as Record<string, unknown>)["taskRunId"];
    expect(firstId).not.toBe(secondId);
  });

  it("converts a concurrent deterministic-id collision into a replay", async () => {
    autonomous.create.mockRejectedValueOnce({ code: "P2002" });
    db.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        taskRunId: "TR-MCP-CONCURRENT",
        status: "working",
        progressPayload: null,
        a2aMetadata: { idempotencyKey: immutableParams.idempotencyKey, apiTokenId: "PAT-A" },
      });

    const outcome = await submit("PAT-A");

    expect(outcome).toMatchObject({
      kind: "result",
      result: { taskRunId: "TR-MCP-CONCURRENT", idempotentReplay: true },
    });
    expect(db.findFirst).toHaveBeenCalledTimes(2);
  });
  it("keeps canonical coworker grants and pins exact authority-scope tools", async () => {
    await submit("PAT-C", {
      agentId: "AGT-WS-BUILD",
      routeContext: "/build/work/WC-7FF8A505",
      objective: "Record the immutable research review.",
      prompt: "Read the source and record the governed evidence.",
      idempotencyKey: "research-review-1",
      riskClass: "bounded-write",
      authorityScope: [
        "backlog-item:BI-F0715C9C",
        "tool:read_source_at_version",
        "tool:record_initiative_evidence",
      ],
    });

    expect(autonomous.resolveTools).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "AGT-WS-BUILD",
      requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
    }));
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "AGT-WS-BUILD",
      effortWarrant: expect.objectContaining({
        level: "high",
        reasoningDepth: "high",
        maxDurationMs: 600000,
        maxIterations: 200,
      }),
      modelRequirements: {
        defaultMinimumTier: "strong",
        defaultBudgetClass: "quality_first",
        preferredProviderId: "local",
        preferredModelId: "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
        residencyPolicy: "local_only",
      },
    }));
    expect(db.findModelConfig).toHaveBeenCalledWith({
      where: { agentId: "build-specialist" },
      select: {
        minimumTier: true,
        budgetClass: true,
        pinnedProviderId: true,
        pinnedModelId: true,
      },
    });
  });

  it("server-binds immutable initiative identity and exposes only the exact reviewer tools", async () => {
    autonomous.resolveTools.mockResolvedValue({
      tools: [
        { name: "load_tools", inputSchema: { type: "object", properties: {} } },
        { name: "read_source_at_version", inputSchema: { type: "object", properties: {} } },
        { name: "search_source_at_version", inputSchema: { type: "object", properties: {} } },
        {
          name: "record_initiative_evidence",
          inputSchema: {
            type: "object",
            properties: {
              itemId: { type: "string" },
              gate: { type: "string" },
              decision: { type: "string" },
              artifactRef: { type: "object" },
              reason: { type: "string" },
              findings: { type: "array" },
              resolvedFindingRefs: { type: "array" },
            },
            required: ["itemId", "reason"],
          },
        },
        { name: "search_tool_marketplace", inputSchema: { type: "object", properties: {} } },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "load_tools", parameters: { type: "object", properties: {} } } },
        { type: "function", function: { name: "read_source_at_version", parameters: { type: "object", properties: {} } } },
        { type: "function", function: { name: "search_source_at_version", parameters: { type: "object", properties: {} } } },
        {
          type: "function",
          function: {
            name: "record_initiative_evidence",
            parameters: {
              type: "object",
              properties: {
                itemId: { type: "string" },
                gate: { type: "string" },
                decision: { type: "string" },
                artifactRef: { type: "object" },
                reason: { type: "string" },
                findings: { type: "array" },
                resolvedFindingRefs: { type: "array" },
              },
              required: ["itemId", "reason"],
            },
          },
        },
        { type: "function", function: { name: "search_tool_marketplace", parameters: { type: "object", properties: {} } } },
      ],
      deferredTools: [{ name: "list_backlog_items", inputSchema: { type: "object", properties: {} } }],
    });

    const initiativeReviewBinding = {
      writerToolName: "record_initiative_evidence",
      itemId: "BI-F0715C9C",
      gate: "research",
      artifactRef: {
        kind: "repo-blob-at-commit",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
        path: "docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md",
        providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
      },
    };
    await submit("PAT-E", {
      agentId: "AGT-WS-BUILD",
      routeContext: "/build/work/WC-7FF8A505",
      objective: "Record the immutable research review.",
      prompt: "Search the exact immutable source, then record the governed judgment.",
      idempotencyKey: "research-review-bound-identity",
      riskClass: "bounded-write",
      authorityScope: [
        "backlog-item:BI-F0715C9C",
        "tool:read_source_at_version",
        "tool:search_source_at_version",
        "tool:record_initiative_evidence",
      ],
      initiativeReviewBinding,
    });

    const execution = autonomous.execute.mock.calls[0]?.[0] as {
      tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown>; required: string[] } }>;
      toolsForProvider: Array<{ function?: { name?: string; parameters?: { properties?: Record<string, unknown>; required?: string[] } } }>;
      deferredTools?: unknown[];
      terminalToolPolicy?: Record<string, unknown>;
    };
    expect(execution.tools.map((tool) => tool.name)).toEqual([
      "read_source_at_version",
      "search_source_at_version",
      "record_initiative_evidence",
    ]);
    expect(execution.deferredTools).toEqual([]);
    const reader = execution.tools.find((tool) => tool.name === "read_source_at_version")!;
    expect(reader.inputSchema).toEqual({
      type: "object",
      properties: {
        repositoryFullName: { type: "string", enum: [initiativeReviewBinding.artifactRef.repositoryFullName] },
        path: { type: "string", enum: [initiativeReviewBinding.artifactRef.path] },
        version: { type: "string", enum: [initiativeReviewBinding.artifactRef.commitSha] },
        startLine: expect.objectContaining({ type: "number", minimum: 1 }),
        cursor: expect.objectContaining({ type: "string" }),
        maxLines: expect.objectContaining({ type: "number", maximum: 200 }),
        maxChars: expect.objectContaining({ type: "number", maximum: 3200 }),
        expectedBlobId: { type: "string", enum: [initiativeReviewBinding.artifactRef.providerBlobId] },
      },
      required: ["repositoryFullName", "path", "version", "expectedBlobId"],
      additionalProperties: false,
    });
    const providerReader = execution.toolsForProvider.find((tool) => tool.function?.name === "read_source_at_version")!;
    expect(providerReader.function?.parameters).toEqual(reader.inputSchema);
    const searchReader = execution.tools.find((tool) => tool.name === "search_source_at_version")!;
    expect(searchReader.inputSchema).toEqual({
      type: "object",
      properties: {
        query: expect.any(Object),
        version: { type: "string", enum: [initiativeReviewBinding.artifactRef.commitSha] },
        glob: { type: "string", enum: [initiativeReviewBinding.artifactRef.path] },
        offset: expect.objectContaining({ type: "number", minimum: 0 }),
        maxResults: expect.objectContaining({ type: "number", maximum: 50 }),
        expectedBlobId: { type: "string", enum: [initiativeReviewBinding.artifactRef.providerBlobId] },
      },
      required: ["query", "version", "glob", "expectedBlobId"],
      additionalProperties: false,
    });
    expect(execution.terminalToolPolicy).toEqual({
      writerToolName: "record_initiative_evidence",
      readerToolNames: ["read_source_at_version", "search_source_at_version"],
      minimumSuccessfulReaderCalls: 1,
      maximumReaderCalls: 6,
      immutableReaderArguments: {
        repositoryFullName: initiativeReviewBinding.artifactRef.repositoryFullName,
        path: initiativeReviewBinding.artifactRef.path,
        version: initiativeReviewBinding.artifactRef.commitSha,
        expectedBlobId: initiativeReviewBinding.artifactRef.providerBlobId,
      },
    });
    const writer = execution.tools.find((tool) => tool.name === "record_initiative_evidence")!;
    expect(writer.inputSchema.properties).toEqual(expect.objectContaining({
      decision: expect.any(Object),
    }));
    expect(writer.inputSchema.properties).not.toHaveProperty("itemId");
    expect(writer.inputSchema.properties).not.toHaveProperty("gate");
    expect(writer.inputSchema.properties).not.toHaveProperty("artifactRef");
    expect(writer.inputSchema.properties).not.toHaveProperty("findings");
    expect(writer.inputSchema.properties).not.toHaveProperty("resolvedFindingRefs");
    expect(writer.inputSchema.properties).not.toHaveProperty("reason");
    expect(writer.inputSchema.required).toEqual(["decision"]);
    const providerWriter = execution.toolsForProvider.find((tool) => tool.function?.name === "record_initiative_evidence")!;
    expect(providerWriter.function?.parameters?.properties).toEqual(writer.inputSchema.properties);
    expect(providerWriter.function?.parameters?.required).toEqual(writer.inputSchema.required);
    const dryWriterArguments = JSON.stringify({
      decision: "pass",
    });
    expect(dryWriterArguments.length).toBeLessThan(138);
    expect(JSON.parse(dryWriterArguments)).toEqual({
      decision: "pass",
    });
    expect(autonomous.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ initiativeReviewBinding }),
    }));
  });

  it("rejects an immutable binding whose BI is not in the exact authority scope", async () => {
    const outcome = await submit("PAT-BINDING-MISMATCH", {
      agentId: "AGT-WS-BUILD",
      routeContext: "/build/work/WC-7FF8A505",
      objective: "Record the immutable research review.",
      prompt: "Read the source and record the governed evidence.",
      idempotencyKey: "research-review-binding-mismatch",
      riskClass: "bounded-write",
      authorityScope: [
        "backlog-item:BI-OTHER",
        "tool:read_source_at_version",
        "tool:record_initiative_evidence",
      ],
      initiativeReviewBinding: {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-F0715C9C",
        gate: "research",
        artifactRef: {
          kind: "repo-blob-at-commit",
          repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
          commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
          path: "docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md",
          providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
        },
      },
    });

    expect(outcome).toMatchObject({
      kind: "invalid_params",
      message: expect.stringContaining("item must match the backlog authority scope"),
    });
    expect(autonomous.resolveAgent).not.toHaveBeenCalled();
  });

  it("pins the immutable reader beside the spec-approval writer and server-binds the baseline precondition", async () => {
    const reader = {
      name: "read_source_at_version",
      inputSchema: { type: "object", properties: {} },
    };
    const writer = {
      name: "record_initiative_design_review",
      inputSchema: {
        type: "object",
        properties: {
          decision: { type: "string" }, reason: { type: "string" }, findings: { type: "array" },
          resolvedFindingRefs: { type: "array" }, profile: { type: "string" }, artifactRole: { type: "string" },
          expectedCurrentBaselineId: { type: ["string", "null"] }, supersessionDispositions: { type: "array" },
        },
        required: ["decision", "reason", "findings", "resolvedFindingRefs", "profile", "artifactRole"],
      },
    };
    autonomous.resolveTools.mockResolvedValue({
      tools: [reader, writer],
      toolsForProvider: [
        { type: "function", function: { name: reader.name, parameters: reader.inputSchema } },
        { type: "function", function: { name: writer.name, parameters: writer.inputSchema } },
      ],
      deferredTools: [],
    });
    const initiativeReviewBinding = {
      writerToolName: writer.name,
      itemId: "BI-F0715C9C",
      gate: "spec-approval",
      expectedCurrentBaselineId: null,
      artifactRef: {
        kind: "repo-blob-at-commit",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
        path: "docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md",
        providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
      },
    };

    await submit("PAT-SPEC", {
      agentId: "AGT-WS-REVIEW",
      routeContext: "/build/work/WC-7FF8A505",
      objective: "Record exact spec approval.",
      prompt: "Review the exact design, then record the judgment.",
      idempotencyKey: "spec-review-bound-baseline",
      riskClass: "bounded-write",
      authorityScope: [
        "backlog-item:BI-F0715C9C",
        `tool:${reader.name}`,
        `tool:${writer.name}`,
      ],
      initiativeReviewBinding,
    });

    const execution = autonomous.execute.mock.calls[0]?.[0] as {
      tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }>;
      toolsForProvider: Array<{ function?: { name?: string; parameters?: { properties?: Record<string, unknown> } } }>;
      terminalToolPolicy?: Record<string, unknown>;
    };
    expect(execution.tools.map((tool) => tool.name)).toEqual([
      "read_source_at_version",
      "record_initiative_design_review",
    ]);
    expect(execution.toolsForProvider.map((tool) => tool.function?.name)).toEqual([
      "read_source_at_version",
      "record_initiative_design_review",
    ]);
    expect(execution.terminalToolPolicy).toEqual({
      writerToolName: "record_initiative_design_review",
      readerToolNames: ["read_source_at_version"],
      minimumSuccessfulReaderCalls: 1,
      maximumReaderCalls: 6,
      immutableReaderArguments: {
        repositoryFullName: initiativeReviewBinding.artifactRef.repositoryFullName,
        path: initiativeReviewBinding.artifactRef.path,
        version: initiativeReviewBinding.artifactRef.commitSha,
        expectedBlobId: initiativeReviewBinding.artifactRef.providerBlobId,
      },
    });
    const boundWriter = execution.tools.find((tool) => tool.name === writer.name)!;
    const providerWriter = execution.toolsForProvider.find((tool) => tool.function?.name === writer.name)!;
    expect(boundWriter.inputSchema.properties).not.toHaveProperty("expectedCurrentBaselineId");
    expect(providerWriter.function?.parameters?.properties).not.toHaveProperty("expectedCurrentBaselineId");
    expect(autonomous.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ initiativeReviewBinding }),
    }));
  });

  it("does not expand ordinary external work to the research-review budget", async () => {
    await submit("PAT-D", {
      agentId: "AGT-WS-BUILD",
      routeContext: "/build/work/WC-7FF8A505",
      objective: "Report current status.",
      prompt: "Report current status.",
      idempotencyKey: "ordinary-status-1",
      riskClass: "read",
      authorityScope: ["tool:list_backlog_items"],
    });

    expect(autonomous.execute.mock.calls[0]?.[0]).not.toHaveProperty("effortWarrant");
    expect(db.findUnique).not.toHaveBeenCalled();
  });
});
