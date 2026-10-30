import type { PrismaClient } from "@dpf/db";
import { describe, expect, it, vi } from "vitest";
import { scheduleWorkroomAgentTask } from "./workroom-drive-scheduling";
import type { WorkroomDriveEffects } from "./workroom-drive";
import { createQualificationExperimentAdmission, qualificationBindingDigest,
  type QualificationExperimentBinding } from "@/lib/backlog/initiative-readiness/qualification-research-admission";

describe("dispatch identity across sequential stages", () => {
  function harness() {
    const now = new Date("2025-09-01T00:00:00Z");
    let workspaceState: unknown = {};
    const tasks = new Map<string, Record<string, unknown>>();
    const tx = {
      workroom: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => ({ workspaceState, objective: "Review evidence", capsuleId: "WC-TEST",
          backlogItemId: "BI-TEST", repositoryFullName: "owner/repo", baseSha: "a".repeat(40),
          headSha: "b".repeat(40), leaseHolderPrincipalId: "principal" })),
        update: vi.fn(async ({ data }) => { workspaceState = data.workspaceState; }),
      },
      scheduledAgentTask: {
        findUnique: vi.fn(async ({ where }) => tasks.get(where.taskId) ?? null),
        upsert: vi.fn(async ({ where, create, update }) => {
          const task = tasks.has(where.taskId) ? { ...tasks.get(where.taskId), ...update } : create;
          tasks.set(where.taskId, task); return task;
        }),
      },
      workroomActivity: { create: vi.fn(async () => ({})) },
    };
    const db = { $transaction: async (run: (client: typeof tx) => Promise<boolean>) => run(tx) } as unknown as Pick<PrismaClient, "$transaction">;
    const input: Parameters<WorkroomDriveEffects["upsertAgentTask"]>[0] = {
      taskId: "workroom-WC-TEST-shape", agentId: "agent", ownerUserId: "owner",
      title: "First stage", prompt: "Review", now,
      stage: { shapeKey: "shape", shapeVersion: "1.0.0", stageKey: "first", tools: [] },
      dispatchScope: { runKey: "shape@1:2025-09-01", cycleKey: "shape@1:2025-09-01", iteration: 0 },
      lease: { roomId: "room", holderPrincipalId: "principal", expiresAt: new Date(now.getTime() + 60_000) },
    };
    return { tx, input, tasks, setWorkspaceState: (value: unknown) => { workspaceState = value; },
      readWorkspaceState: () => workspaceState,
      enqueue: (change: Partial<typeof input> = {}) => scheduleWorkroomAgentTask(db, { ...input, ...change }, () => now) };
  }

  it("queues the next legitimate stage on the same scheduled task", async () => {
    const h = harness();
    await h.enqueue();
    await expect(h.enqueue({ stage: { ...h.input.stage, stageKey: "second" }, agentId: "next-agent" })).resolves.toBe(true);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(2);
  });

  it.each(["run", "cycle", "iteration"])("allows a new %s without mistaking it for replay", async (kind) => {
    const h = harness();
    await h.enqueue();
    const scope = { ...h.input.dispatchScope! };
    if (kind === "run") { scope.runKey = "shape@1:2026-09-02"; scope.cycleKey = scope.runKey; }
    if (kind === "cycle") scope.cycleKey = "shape@1:2026-09-02";
    if (kind === "iteration") scope.iteration += 1;
    await h.enqueue({ dispatchScope: scope });
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(2);
  });

  it("preserves an earlier branch's receipt and inactive task after another branch was enqueued", async () => {
    const h = harness();
    await h.enqueue();
    const first = h.tasks.get(h.input.taskId)!;
    first.isActive = false;
    const receipt = structuredClone(first.taskConfig);
    await h.enqueue({ taskId: "second-branch", stage: { ...h.input.stage, stageKey: "second" } });
    await h.enqueue();
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(2);
    expect(h.tx.workroomActivity.create).toHaveBeenCalledTimes(2);
    expect(h.tasks.get(h.input.taskId)).toMatchObject({ isActive: false, taskConfig: receipt });
  });

  it.each(["agent", "owner", "stage"])("refuses changed persisted %s on replay", async (kind) => {
    const h = harness();
    await h.enqueue();
    const task = h.tasks.get(h.input.taskId)!;
    if (kind === "agent") task.agentId = "foreign";
    if (kind === "owner") task.ownerUserId = "foreign";
    if (kind === "stage") task.taskConfig = { workroomStage: { ...h.input.stage, stageKey: "foreign" } };
    await expect(h.enqueue()).rejects.toThrow(/identity reconciliation/);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
  });

  it("retains lease fencing even when a receipt matches", async () => {
    const h = harness();
    await h.enqueue();
    h.tx.workroom.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(h.enqueue()).resolves.toBe(false);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
  });

  it("does not treat changed tool authority or missing cycle identity as a new dispatch", async () => {
    const h = harness();
    await h.enqueue();
    await expect(h.enqueue({ stage: { ...h.input.stage, tools: ["new-tool"] } })).rejects.toThrow(/identity reconciliation/);
    await expect(h.enqueue({ dispatchScope: undefined })).rejects.toThrow(/identity reconciliation/);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
  });

  it("dispatches source-only preparation with the exact signed tool and path binding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-09-01T00:05:00.000Z"));
    vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "qualification-scheduler-secret");
    const h = harness();
    const binding: QualificationExperimentBinding = {
      schemaVersion: 1, phase: "prepare", itemId: "BI-TEST", workroomId: "WC-TEST",
      repositoryFullName: "owner/repo", baseSha: "a".repeat(40), headSha: "b".repeat(40),
      protocol: { path: "docs/protocol.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
      installationId: "install-dev", accountablePrincipalRef: "principal", protocolReviewReceiptId: "review-protocol-1",
      shapeKey: "shape", shapeVersion: "1.0.0", stageKey: "first", policyVersion: 1,
      executorMode: "sandbox-build", requiredPlatform: "linux",
      targetProductionBlobIds: ["d".repeat(40)], permittedTools: ["write_sandbox_file", "record_workroom_evidence"],
      allowedPaths: ["apps/web/lib/example.test.ts"], issuedAt: "2025-09-01T00:00:00.000Z",
      expiresAt: "2025-09-01T00:30:00.000Z", maxStarts: 1, maxDurationMs: 600_000,
    };
    const token = createQualificationExperimentAdmission(binding);
    h.setWorkspaceState({ qualificationExperimentAdmission: { schemaVersion: 1, status: "issued", token,
      bindingDigest: qualificationBindingDigest(binding), startCount: 0, issuedAt: binding.issuedAt } });
    await expect(h.enqueue({ stage: { ...h.input.stage, tools: binding.permittedTools } })).resolves.toBe(true);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("does not dispatch native verification into the Linux Build Studio sandbox", async () => {
    vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "qualification-scheduler-secret");
    const h = harness();
    const binding: QualificationExperimentBinding = {
      schemaVersion: 1, phase: "verify", itemId: "BI-TEST", workroomId: "WC-TEST",
      repositoryFullName: "owner/repo", baseSha: "a".repeat(40), headSha: "b".repeat(40),
      protocol: { path: "docs/protocol.md", commitSha: "a".repeat(40), providerBlobId: "c".repeat(40) },
      installationId: "install-dev", accountablePrincipalRef: "principal", protocolReviewReceiptId: "review-protocol-1",
      shapeKey: "shape", shapeVersion: "1.0.0", stageKey: "first", policyVersion: 1,
      targetProductionPaths: ["scripts/lib/local-ci-gate-state.mjs"],
      targetProductionBlobIds: ["d".repeat(40)], executorMode: "native-edge", requiredPlatform: "win32",
      permittedTools: ["record_workroom_evidence"],
      allowedPaths: ["scripts/lib/local-ci-gate-state.test.mjs"], issuedAt: "2025-09-01T00:00:00.000Z",
      expiresAt: "2025-09-01T00:30:00.000Z", maxStarts: 1, maxDurationMs: 600_000,
      candidate: { headSha: "b".repeat(40), diffDigest: `sha256:${"e".repeat(64)}`,
        testBlobIds: ["f".repeat(40)], productionBytesUnchanged: true, reviewReceiptId: "review-candidate-1" },
    };
    const token = createQualificationExperimentAdmission(binding);
    h.setWorkspaceState({ qualificationExperimentAdmission: { schemaVersion: 1, status: "issued", token,
      bindingDigest: qualificationBindingDigest(binding), startCount: 0, issuedAt: binding.issuedAt } });

    await expect(h.enqueue({ stage: { ...h.input.stage, tools: binding.permittedTools } })).resolves.toBe(false);
    expect(h.tx.scheduledAgentTask.upsert).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
