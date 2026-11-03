import type { PrismaClient } from "@dpf/db";
import { describe, expect, it, vi } from "vitest";
import { scheduleWorkroomAgentTask } from "./workroom-drive-scheduling";
import type { WorkroomDriveEffects, WorkroomDriveRoom } from "./workroom-drive";
import type { DispatchSource } from "@/lib/work-management/workroom-drive-checkpoint";
import { buildNativeContinuationDispatch } from "./workroom-drive-graph";
import { readWorkroomContinuation } from "@/lib/work-capsules/workroom-continuation-read.server";
import { SPLIT_2 } from "@/lib/work-management/__fixtures__/graph-shapes/parallel";
import { SEQUENTIAL_TWIN } from "@/lib/work-management/__fixtures__/graph-shape-fixtures";
import { startDriveMarking } from "@dpf/validators/workroom/marking";
import { readWorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";
import type { DrivePlan } from "@/lib/work-management/drive-resolution";
import { createQualificationExperimentAdmission, qualificationBindingDigest,
  type QualificationExperimentBinding } from "@/lib/backlog/initiative-readiness/qualification-research-admission";

// Source composition only: real producer/scheduler/reader, in-memory persistence
// and a fixed admitted reader. This does not qualify PostgreSQL or MCP ingress.
const composition = vi.hoisted(() => ({ db: null as unknown, access: vi.fn(), shape: vi.fn() }));
vi.mock("@dpf/db", async original => ({ ...await original<typeof import("@dpf/db")>(), get prisma() { return composition.db; } }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({
  resolveAgentWorkroomAccess: composition.access, resolveHumanWorkroomAccess: composition.access,
}));
vi.mock("@/lib/work-management/workroom-shape-claim", async original => ({
  ...await original<typeof import("@/lib/work-management/workroom-shape-claim")>(), resolveWorkShapeClaim: composition.shape,
}));

describe("dispatch identity across sequential stages", () => {
  function harness() {
    const now = new Date("2025-09-01T00:00:00Z");
    let workspaceState: unknown = {};
    let source: DispatchSource = { repositoryFullName: "owner/repo", headSha: "b".repeat(40) };
    const tasks = new Map<string, Record<string, unknown>>();
    const tx = {
      workroom: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => ({ workspaceState, objective: "Review evidence", capsuleId: "WC-TEST",
          backlogItemId: "BI-TEST", ...source, baseSha: "a".repeat(40), leaseHolderPrincipalId: "principal" })),
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
      readSource: () => ({ ...source }), setSource: (value: DispatchSource) => { source = value; },
      readWorkspaceState: () => workspaceState,
      enqueue: (change: Partial<typeof input> = {}) => scheduleWorkroomAgentTask(db, { ...input, ...change }, () => now) };
  }

  function continuationComposition(shape = SEQUENTIAL_TWIN) {
    const h = harness();
    const budgetUsage = [{ kind: "usd", used: 0.25 }];
    const readRoom = h.tx.workroom.findUnique.getMockImplementation()!;
    h.tx.workroom.findUnique.mockImplementation(async () => ({ ...await readRoom(), id: "room", status: "working",
      leaseExpiresAt: h.input.lease.expiresAt, scopeClaims: [{ workShape: `${shape.key}@${shape.version}` }] }));
    const db = { ...h.tx, $executeRaw: vi.fn(),
      $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(db),
      backlogItem: { findFirst: vi.fn(async () => ({ itemId: "BI-TEST" })) },
      workroomActivity: { ...h.tx.workroomActivity, findMany: vi.fn(async () => []) },
    };
    composition.db = db;
    composition.access.mockResolvedValue({ decision: { level: "content" }, agentPrincipalId: "reader-principal" });
    composition.shape.mockReturnValue(shape);
    const native = (stageKey: string, taskId: string, iteration: number) => {
      const room: WorkroomDriveRoom = { id: "room", capsuleId: "WC-TEST", status: "working", objective: "Review evidence", workItemKey: "BI-TEST",
        ...h.readSource(), scopeClaims: [], workspaceState: h.readWorkspaceState(), leaseExpiresAt: h.input.lease.expiresAt,
        leaseHolderPrincipalId: "principal", ownerUserId: "owner", participants: [], currentStageKey: stageKey,
        receipts: [], budgetUsage, stopConditionHits: [], reviewDue: false, substrateReachable: true, substrateEmpty: false };
      const plan: DrivePlan = { action: "dispatch_agent", reason: "agent_stage", roomId: room.capsuleId,
        shapeKey: shape.key, shapeVersion: shape.version, definition: readWorkShapeDefinitionContract(shape), stageKey,
        accountablePrincipalRef: "agent:agent", agentId: "agent", attentionPrincipalRef: null, taskId,
        conformance: null, cycle: null, deviations: [], ledger: [] };
      const result = buildNativeContinuationDispatch({ room, plan, stageKey, taskId, agentId: "agent", expiresAt: h.input.lease.expiresAt,
        dispatchScope: { ...h.input.dispatchScope!, iteration } });
      if (!result.success) throw new Error(result.message);
      return { taskId, ...result.fields };
    };
    const read = (taskId: string) => readWorkroomContinuation({ capsuleId: "WC-TEST", continuationMode: "bounded", continuationTaskId: taskId },
      "owner", { agentId: "reader-agent", tokenScope: "read", tokenGrantScopes: ["work_capsule_read"] });
    return { ...h, native, read, budgetUsage };
  }

  it("round-trips native obligations through the stored checkpoint without transcript, completion inference or stale-source reuse", async () => {
    const h = continuationComposition();
    vi.useFakeTimers(); vi.setSystemTime(h.input.now);
    try {
      h.setWorkspaceState({ privateTranscript: "PRIVATE_TRANSCRIPT", workroomDrive: { stageKey: "b", taskId: "branch-b",
        runKey: h.input.dispatchScope!.runKey, lastCycleKey: h.input.dispatchScope!.cycleKey, budgetUsage: h.budgetUsage, stopConditionHits: [] } });
      const native = h.native("b", "branch-b", 0);
      expect(await h.enqueue(native)).toBe(true);
      Object.assign(h.tasks.get("branch-b")!, { lastStatus: "ok", privateTrace: "PRIVATE_TRACE" });
      const result = await h.read("branch-b");
      const facts = JSON.parse(native.prompt.split("\n").find(line => line.startsWith("{"))!);
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("continuation", facts);
      expect(facts.doneWhen).toBe("b done");
      expect(facts.outcome).toBe("unknown");
      expect(facts.replay).toBe("not-authorized-by-brief");
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_TRANSCRIPT|PRIVATE_TRACE/);
      expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
      h.setSource({ ...h.readSource(), headSha: "c".repeat(40) });
      expect(await h.read("branch-b")).toMatchObject({ success: false, error: "continuation_binding_stale" });
      expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("rehydrates each produced parallel branch from its own persisted checkpoint after the sibling becomes room-latest", async () => {
    const h = continuationComposition(SPLIT_2);
    vi.useFakeTimers(); vi.setSystemTime(h.input.now);
    try {
      h.setWorkspaceState({ workroomDrive: { stageKey: "b", lastCycleKey: h.input.dispatchScope!.cycleKey,
        marking: { ...startDriveMarking(readWorkShapeDefinitionContract(SPLIT_2), h.input.dispatchScope!.runKey, h.input.now),
          tokens: [{ node: "stage:b", taskId: "branch-b", enteredAt: h.input.now.toISOString() },
            { node: "stage:c", taskId: "branch-c", enteredAt: h.input.now.toISOString() }], iterations: { b: 1, c: 2 } },
        budgetUsage: h.budgetUsage, stopConditionHits: [] } });
      const first = h.native("b", "branch-b", 1), sibling = h.native("c", "branch-c", 2);
      expect(await h.enqueue(first)).toBe(true);
      expect(await h.enqueue(sibling)).toBe(true);
      expect(h.readWorkspaceState()).toMatchObject({ workroomDispatchCheckpoint: { confirmedEffect: { taskId: "branch-c" } } });
      for (const native of [first, sibling]) {
        const facts = JSON.parse(native.prompt.split("\n").find(line => line.startsWith("{"))!);
        const result = await h.read(native.taskId);
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("continuation", facts);
      }
      expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("persists the source checked under the room lock in the task and enqueue receipt", async () => {
    const h = harness();
    const source = h.readSource();
    await expect(h.enqueue({ source })).resolves.toBe(true);
    expect(h.tasks.get(h.input.taskId)).toMatchObject({ taskConfig: { workroomDispatchCheckpoint: { source } } });
    expect(h.readWorkspaceState()).toMatchObject({ workroomDispatchCheckpoint: { source } });
    expect(h.tx.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ source }) }) }));
  });

  it.each(["repositoryFullName", "headSha"] as const)("refuses a brief whose %s no longer matches the locked room", async (field) => {
    const h = harness();
    const source = h.readSource();
    h.setSource({ ...source, [field]: field === "headSha" ? "c".repeat(40) : "other/repository" });
    await expect(h.enqueue({ source })).resolves.toBe(false);
    expect(h.tx.scheduledAgentTask.upsert).not.toHaveBeenCalled();
    expect(h.tx.workroom.update).not.toHaveBeenCalled();
    expect(h.tx.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("reuses an exact source-bound dispatch without enqueueing or rewriting its receipt", async () => {
    const h = harness();
    const source = h.readSource();
    await h.enqueue({ source });
    const receipt = structuredClone(h.readWorkspaceState());
    await expect(h.enqueue({ source })).resolves.toBe(true);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
    expect(h.tx.workroomActivity.create).toHaveBeenCalledTimes(1);
    expect(h.readWorkspaceState()).toEqual(receipt);
  });

  it.each(["repositoryFullName", "headSha"] as const)("requires reconciliation when the same dispatch now names a different %s", async (field) => {
    const h = harness();
    const source = h.readSource();
    await h.enqueue({ source });
    const receipt = structuredClone(h.readWorkspaceState());
    const task = structuredClone(h.tasks.get(h.input.taskId));
    const changed = { ...source, [field]: field === "headSha" ? "c".repeat(40) : "other/repository" };
    h.setSource(changed);
    await expect(h.enqueue({ source: changed })).resolves.toBe(false);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
    expect(h.tx.workroomActivity.create).toHaveBeenCalledTimes(1);
    expect(h.readWorkspaceState()).toEqual(receipt);
    expect(h.tasks.get(h.input.taskId)).toEqual(task);
  });

  it("does not relabel a legacy receipt with current source to authorize continuation", async () => {
    const h = harness();
    await h.enqueue();
    const receipt = structuredClone(h.readWorkspaceState());
    await expect(h.enqueue({ source: h.readSource() })).resolves.toBe(false);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
    expect(h.tx.workroomActivity.create).toHaveBeenCalledTimes(1);
    expect(h.readWorkspaceState()).toEqual(receipt);
  });

  it("does not discard known source provenance when a replay omits it", async () => {
    const h = harness();
    await h.enqueue({ source: h.readSource() });
    await expect(h.enqueue()).resolves.toBe(false);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
  });

  it("captures a newly checked source for a genuinely new cycle", async () => {
    const h = harness();
    await h.enqueue({ source: h.readSource() });
    const source = { ...h.readSource(), headSha: "c".repeat(40) };
    h.setSource(source);
    await expect(h.enqueue({ source, dispatchScope: { ...h.input.dispatchScope!, cycleKey: "next-cycle" } })).resolves.toBe(true);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(2);
    expect(h.readWorkspaceState()).toMatchObject({ workroomDispatchCheckpoint: { revision: 2, source } });
  });

  it("supports non-repository work without inventing source identity", async () => {
    const h = harness();
    const source = { repositoryFullName: null, headSha: null };
    h.setSource(source);
    await expect(h.enqueue({ source })).resolves.toBe(true);
    await expect(h.enqueue({ source })).resolves.toBe(true);
    expect(h.tx.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
    expect(h.readWorkspaceState()).toMatchObject({ workroomDispatchCheckpoint: { source } });
  });

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
