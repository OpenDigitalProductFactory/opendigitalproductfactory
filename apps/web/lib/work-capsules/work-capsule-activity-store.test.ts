import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));
import { publishRecordedWorkCapsuleActivity } from "./activity-events";
import { recordWorkCapsuleActivity, recordWorkCapsuleEvidence } from "./work-capsule-activity-store";
import { createQualificationExperimentAdmission, qualificationBindingDigest,
  type QualificationExperimentBinding } from "@/lib/backlog/initiative-readiness/qualification-research-admission";

describe("transactional Workroom activity", () => {
  it("keeps the locked parent identity when caller input changes during the await", async () => {
    const create = vi.fn().mockResolvedValue({ id: "activity-1", workCapsuleId: "row-1" });
    const findUnique = vi.fn().mockResolvedValue({ id: "row-1", capsuleId: "WC-ONE" });
    const input: Parameters<typeof recordWorkCapsuleEvidence>[0] = {
      db: { $queryRaw: vi.fn(async () => { input.capsuleId = "WC-TWO"; }),
        workroom: { findUnique }, workroomActivity: { create } } as never,
      capsuleId: "WC-ONE", evidence: { kind: "pr-gate", stageKey: "implement", outcome: "completed", summary: "Observed" },
      actor: { userId: "user-1", agentId: null, principalId: null }, deferPublication: true,
    };
    await recordWorkCapsuleEvidence(input);
    expect(findUnique).toHaveBeenCalledWith({ where: { capsuleId: "WC-ONE" } });
  });
  it("locks the parent before reading source and publishes only after its transaction commits", async () => {
    const order: string[] = [];
    const tx = { $queryRaw: vi.fn(async () => { order.push("lock"); }),
      workroom: { findUnique: vi.fn(async () => { order.push("source"); return { id: "room-1" }; }) },
      workroomActivity: { create: vi.fn(async () => { order.push("write"); return { id: "activity-1", workCapsuleId: "room-1" }; }) } };
    const db = { ...tx, $transaction: async (write: (tx: unknown) => Promise<unknown>) => {
      const result = await write(tx);
      expect(publishRecordedWorkCapsuleActivity).not.toHaveBeenCalled();
      order.push("commit"); return result;
    } };
    vi.mocked(publishRecordedWorkCapsuleActivity).mockClear();
    await recordWorkCapsuleEvidence({ db: db as never, capsuleId: "WC-ONE",
      evidence: { kind: "pr-gate", stageKey: "implement", outcome: "completed", summary: "Observed only" },
      actor: { userId: "user-1", agentId: null, principalId: null } });
    expect(order).toEqual(["lock", "source", "write", "commit"]);
    expect(publishRecordedWorkCapsuleActivity).toHaveBeenCalledWith("room-1", "activity-1");
    vi.mocked(publishRecordedWorkCapsuleActivity).mockClear();
  });
  it("stamps stage evidence from the server room rather than caller supplied context", async () => {
    const create = vi.fn().mockResolvedValue({ id: "activity-2" });
    await recordWorkCapsuleEvidence({
      db: { workroom: { findUnique: vi.fn().mockResolvedValue({ id: "room-1", capsuleId: "WC-ONE",
        repositoryFullName: "org/repo", headSha: "a".repeat(40),
        scopeClaims: [{ workShape: "delivery-medium@1.0.0" }] }) }, workroomActivity: { create } } as never,
      capsuleId: "WC-ONE", actor: { userId: "user-1", agentId: null, principalId: null },
      evidence: { kind: "pr-gate", stageKey: "implement", outcome: "completed", summary: "Recorded gate",
        sourceBinding: { headSha: "forged" } } as never,
      deferPublication: true,
    });
    expect(create.mock.calls[0][0].data.payload.sourceBinding).toEqual({ version: 1,
      capsuleId: "WC-ONE", repositoryFullName: "org/repo", headSha: "a".repeat(40),
      definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate" });
  });
  it("persists without announcing a transaction that has not committed", async () => {
    const create = vi.fn().mockResolvedValue({ id: "activity-1" });
    const activity = await recordWorkCapsuleActivity({ workroomActivity: { create } } as never, {
      workCapsuleId: "room-1", kind: "evidence-recorded", summary: "Receipt recorded",
      actor: { userId: "user-1", agentId: null, principalId: null },
    }, { deferPublication: true });
    expect(activity.id).toBe("activity-1");
    expect(publishRecordedWorkCapsuleActivity).not.toHaveBeenCalled();
  });
  it("settles the exact started qualification state atomically and refuses a duplicate", async () => {
    vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "activity-store-test-secret");
    const now = Date.now();
    const issuedAt = new Date(now - 60_000).toISOString();
    const startedAt = new Date(now - 30_000).toISOString();
    const expiresAt = new Date(now + 3_600_000).toISOString();
    const binding: QualificationExperimentBinding = {
      schemaVersion: 1, phase: "prepare", itemId: "BI-QUAL", workroomId: "WC-ONE",
      repositoryFullName: "owner/repo", baseSha: "a".repeat(40), headSha: "b".repeat(40),
      protocol: { path: "docs/protocol.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
      installationId: "install-dev", accountablePrincipalRef: "principal-1", protocolReviewReceiptId: "review-1",
      shapeKey: "delivery-small-fix", shapeVersion: "1.0.0", stageKey: "reproduce", policyVersion: 1,
      executorMode: "sandbox-build", requiredPlatform: "linux", targetProductionBlobIds: ["d".repeat(40)],
      permittedTools: ["write_sandbox_file", "record_workroom_evidence"], allowedPaths: ["scripts/example.test.mjs"],
      issuedAt, expiresAt,
      maxStarts: 1, maxDurationMs: 600_000,
    };
    const digest = qualificationBindingDigest(binding);
    const started = { schemaVersion: 1, status: "started", token: createQualificationExperimentAdmission(binding), bindingDigest: digest,
      startCount: 1, issuedAt, startedAt, taskId: "task-1" };
    const create = vi.fn().mockResolvedValue({ id: "evidence-1", workCapsuleId: "room-1" });
    const update = vi.fn().mockResolvedValue({});
    const findUnique = vi.fn().mockResolvedValue({ id: "room-1", capsuleId: "WC-ONE",
      workspaceState: { qualificationExperimentAdmission: started } });
    const db = { workroom: { findUnique, update }, workroomActivity: { create } } as never;
    const evidence = { kind: "test" as const, stageKey: "reproduce", outcome: "completed" as const,
      summary: "Bound result", result: { qualificationBindingDigest: digest, qualificationOutcome: "candidate",
        candidate: { headSha: "e".repeat(40), diffDigest: `sha256:${"f".repeat(64)}`,
          testBlobIds: ["1".repeat(40)], productionBytesUnchanged: true,
          targetProductionBlobIds: binding.targetProductionBlobIds } } };
    await recordWorkCapsuleEvidence({ db, capsuleId: "WC-ONE", evidence,
      actor: { userId: "user-1", agentId: "agent-1", principalId: "principal-1" },
      taskRunId: "TR-QUAL", deferPublication: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { workspaceState: {
      qualificationExperimentAdmission: expect.objectContaining({ status: "settled", evidenceId: "evidence-1",
        taskRunId: "TR-QUAL" }),
    } } }));
    findUnique.mockResolvedValueOnce({ id: "room-1", capsuleId: "WC-ONE", workspaceState: {
      qualificationExperimentAdmission: { ...started, status: "settled", evidenceId: "evidence-1" },
    } });
    await expect(recordWorkCapsuleEvidence({ db, capsuleId: "WC-ONE", evidence,
      actor: { userId: "user-1", agentId: "agent-1", principalId: "principal-1" },
      taskRunId: "TR-QUAL", deferPublication: true }))
      .rejects.toThrow(/stale, duplicated/i);
    vi.unstubAllEnvs();
  });
  it("settles host qualification only after its cited typed execution activity exists", async () => {
    vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "activity-store-test-secret");
    const now = Date.now();
    const issuedAt = new Date(now - 60_000).toISOString();
    const startedAt = new Date(now - 30_000).toISOString();
    const completedAt = new Date(now - 10_000).toISOString();
    const binding: QualificationExperimentBinding = {
      schemaVersion: 1, phase: "verify", itemId: "BI-QUAL", workroomId: "WC-ONE",
      repositoryFullName: "owner/repo", baseSha: "a".repeat(40), headSha: "e".repeat(40),
      protocol: { path: "docs/protocol.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
      installationId: "install-dev", accountablePrincipalRef: "principal-1", protocolReviewReceiptId: "review-1",
      shapeKey: "delivery-small-fix", shapeVersion: "1.0.0", stageKey: "reproduce", policyVersion: 1,
      executorMode: "workroom-host", requiredPlatform: "win32", targetProductionBlobIds: ["d".repeat(40)],
      permittedTools: ["record_execution_evidence", "record_workroom_evidence"],
      allowedPaths: ["scripts/example.test.mjs"], issuedAt,
      expiresAt: new Date(now + 3_600_000).toISOString(), maxStarts: 1, maxDurationMs: 600_000,
      candidate: { headSha: "e".repeat(40), diffDigest: `sha256:${"f".repeat(64)}`,
        testBlobIds: ["1".repeat(40)], productionBytesUnchanged: true, reviewReceiptId: "review-2" },
    };
    const digest = qualificationBindingDigest(binding);
    const started = { schemaVersion: 1, status: "started", token: createQualificationExperimentAdmission(binding),
      bindingDigest: digest, startCount: 1, issuedAt, startedAt, taskId: "workroom-host:WC-ONE" };
    const execution = { workroomId: binding.workroomId, qualificationBindingDigest: digest,
      executorMode: "workroom-host", platform: "win32", headSha: binding.headSha,
      testBlobIds: binding.candidate!.testBlobIds, command: "pnpm exec vitest run scripts/example.test.mjs",
      outputDigest: `sha256:${"2".repeat(64)}`, startedAt, completedAt, exitCode: 0, skipped: false };
    const create = vi.fn().mockResolvedValue({ id: "evidence-host", workCapsuleId: "room-1" });
    const update = vi.fn().mockResolvedValue({});
    const findUnique = vi.fn().mockResolvedValue({ id: "room-1", capsuleId: "WC-ONE",
      workspaceState: { qualificationExperimentAdmission: started } });
    const findMany = vi.fn().mockResolvedValue([{ id: "activity-host", backlogItem: { itemId: binding.itemId },
      payload: { evidenceKind: "test_pass", qualification: execution }, recordedAt: new Date(completedAt) }]);
    const db = { workroom: { findUnique, update }, workroomActivity: { create },
      backlogItemActivity: { findMany } } as never;
    const evidence = { kind: "test" as const, stageKey: "reproduce", outcome: "completed" as const,
      summary: "Windows qualification passed", result: { qualificationBindingDigest: digest,
        qualificationOutcome: "positive", executorMode: "workroom-host", requiredPlatform: "win32",
        headSha: binding.headSha, testBlobIds: binding.candidate!.testBlobIds,
        command: execution.command, outputDigest: execution.outputDigest,
        executionEvidenceActivityIds: ["activity-host"], startedAt, completedAt } };

    await recordWorkCapsuleEvidence({ db, capsuleId: "WC-ONE", evidence,
      actor: { userId: "user-1", agentId: "agent-1", principalId: "principal-1" },
      deferPublication: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { workspaceState: {
      qualificationExperimentAdmission: expect.not.objectContaining({ taskRunId: expect.anything() }),
    } } }));
    findMany.mockResolvedValueOnce([]);
    await expect(recordWorkCapsuleEvidence({ db, capsuleId: "WC-ONE", evidence,
      actor: { userId: "user-1", agentId: "agent-1", principalId: "principal-1" },
      deferPublication: true })).rejects.toThrow(/activities do not match/i);
    vi.unstubAllEnvs();
  });
});
