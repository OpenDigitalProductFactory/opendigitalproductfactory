import { afterEach, describe, expect, it, vi } from "vitest";
import { db, autonomous, params, userContext, persistedReaderExecution, submit, persistedMetadata } from "./test-support/terminal-writer-fixture";
import { readerBootstrapTask } from "./test-support/terminal-reader-bootstrap";

afterEach(async () => {
  const { _setGovernanceForTests } = await import("./mcp-governed-execute");
  _setGovernanceForTests({});
  vi.restoreAllMocks();
});

describe("reserved hydration through real governance", () => {
  it.each(["none", "content-free", "cas-loss", "malformed-fence", "held", "unknown", "request", "reviewer", "authority", "reservation", "dispatch"])("preserves the reserved generation through real hydration: %s", async (historyKind) => {
    const metadata = await persistedMetadata("PAT-REAL-HYDRATION");
    vi.clearAllMocks();
    const existing = readerBootstrapTask(metadata, new Date("2026-08-31T03:00:00.000Z"));
    db.persisted = {};
    if (historyKind === "malformed-fence") Object.assign(existing.progressPayload, { dispatch: { claimedAt: 42 } });
    if (historyKind === "cas-loss") db.updateMany.mockResolvedValue({ count: 0 });
    db.findFirst.mockResolvedValue(existing);
    db.findUnique.mockResolvedValue({ ...existing, userId: "user-1", currentAgentId: params.agentId });
    const history = historyKind === "none" ? [] : [persistedReaderExecution];
    db.findToolExecutions.mockImplementation(async () => [...history]);
    const actual = await vi.importActual<typeof import("./tak/autonomous-work-run")>("./tak/autonomous-work-run");
    autonomous.workToolMock.mockImplementation(actual.executeAutonomousWorkTool);
    const { _setGovernanceForTests } = await import("./mcp-governed-execute");
    const authority = await import("./govern/authority/coworker-tool-authority-gate");
    vi.spyOn(authority, "enforceCoworkerToolAuthority").mockResolvedValue({
      outcome: "allow", approvedEnvelopeId: null, reservedAt: null, authorityDecisionId: "fixture",
    });
    const backend = vi.fn(async () => {
      if (historyKind === "held") db.persisted.status = "input-required";
      if (historyKind === "unknown") Object.assign(db.persisted.progressPayload as object, { executionUncertainty: { settlement: "unknown" } });
      if (historyKind === "request") db.persisted.a2aMetadata = { ...metadata, requestDigest: "8".repeat(64) };
      if (historyKind === "reviewer") db.persisted.currentAgentId = "other-reviewer";
      if (historyKind === "authority") Object.assign(db.persisted.progressPayload as object, { reviewExecutionAuthority: { schemaVersion: 1, tokenId: "other" } });
      if (historyKind === "reservation") Object.assign(db.persisted.progressPayload as object, { resumeReservedAt: "later" });
      if (historyKind === "dispatch") Object.assign(db.persisted.progressPayload as object, { dispatch: { claimedAt: "later" } });
      return { success: true, message: "Read immutable source.", data: {
      repositoryFullName: params.initiativeReviewBinding.artifactRef.repositoryFullName,
      path: params.initiativeReviewBinding.artifactRef.path,
      version: params.initiativeReviewBinding.artifactRef.commitSha,
      blobId: params.initiativeReviewBinding.artifactRef.providerBlobId,
      content: "# Immutable design", startLine: 1, endLine: 1, totalLines: 1, hasMore: false, nextCursor: null,
    } }; });
    _setGovernanceForTests({ executeTool: backend,
      resolveAgentGrants: async () => ["*"], isAllowedByGrants: () => true,
      toolExecutionCreate: async data => {
        if (data.success === true && data.result) history.push({ ...persistedReaderExecution, id: "hydration-audit", result: data.result });
        return { id: "hydration-audit" };
      },
      toolExecutionUpdate: async (_id, data) => {
        if (data.success === true && data.result) history.push({ ...persistedReaderExecution, id: "hydration-audit", result: data.result });
        return {};
      },
    });
    autonomous.execute.mockResolvedValue({ content: "Writer handoff reached.", executedTools: [] });
    const outcome = await submit("PAT-REAL-HYDRATION");
    if (historyKind === "cas-loss" || historyKind === "malformed-fence") {
      expect(backend).not.toHaveBeenCalled();
      expect(autonomous.execute).not.toHaveBeenCalled();
      expect(autonomous.create).not.toHaveBeenCalled();
      if (historyKind === "malformed-fence") expect(db.updateMany).not.toHaveBeenCalled();
      return;
    }
    if (!["none", "content-free"].includes(historyKind)) {
      expect(backend).toHaveBeenCalledOnce();
      expect(autonomous.execute).not.toHaveBeenCalled();
      // Only the initial reservation may write; settlement must yield to displacement.
      expect(db.updateMany).toHaveBeenCalledOnce();
      expect(autonomous.create).not.toHaveBeenCalled();
      return;
    }
    expect(backend, JSON.stringify({ outcome, reader: await autonomous.workToolMock.mock.results[0]?.value })).toHaveBeenCalled();
    expect(autonomous.execute).toHaveBeenCalled();
    expect(autonomous.create).not.toHaveBeenCalled();
    const readerFence = autonomous.workToolMock.mock.calls[0]?.[0].taskExecutionFence;
    expect(readerFence).toMatchObject({ requestDigest: metadata.requestDigest, reservation: expect.any(String) });
    expect(autonomous.execute.mock.calls[0]?.[0].taskExecutionFence).toEqual(readerFence);
  });
});
