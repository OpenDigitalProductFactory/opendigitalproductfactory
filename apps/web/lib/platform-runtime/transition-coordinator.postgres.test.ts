import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaRuntimeTransitionReceipts } from "./transition-coordinator";
import { computeCapabilityStateVersion } from "../../../../scripts/lib/capability-state-hash.mjs";
import { createRuntimeCompensationEnvelope, signTransitionPayload, validateRuntimeServiceImagePlan, type RuntimeTransitionEnvelope } from "./transition-protocol";
import { admitRuntimeGuardedWork, lockRuntimeTransitionAdmission } from "./work-admission";
import { spawnWorkThread } from "../actions/agent-threads";
import { admitPrismaWorkroomBoundDurableTaskOperation } from "../inference/async-operation-workroom-runtime";
import { DURABLE_INFERENCE_TASK_CONTRACT_FAMILY } from "../mcp-task-durable-inference-contract";
import { countAttributedWork } from "./work-attribution";
import { createAutonomousWorkRun, type AutonomousWorkRunInput } from "../tak/autonomous-work-run";

const producerDb = vi.hoisted(() => ({ current: null as unknown as PrismaClient, lastIsolation: "" }));
// Forward only the real producer's database seam into this suite's namespace.
// Its transaction ordering, isolation default, admission and insert stay real.
vi.mock("@dpf/db", async () => ({ ...(await import("../../../../packages/db/generated/client/client")), prisma: { get taskRun() { return producerDb.current.taskRun; }, get workroom() { return producerDb.current.workroom; }, $transaction: (operation: (tx: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
  producerDb.lastIsolation = options.isolationLevel;
  return producerDb.current.$transaction(operation as never, options as never);
} } }));

// Isolate only external dispatch and authority resolution. Producer transaction
// code, prior reads/row locks, TaskRun inserts and saved bindings stay real.
vi.mock("../actions/agent-thread-dispatcher", () => ({ dispatchAgentThread: vi.fn(async () => {}) }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceLevel: vi.fn(async () => "normal"), QuiescingError: class extends Error {} }));
vi.mock("../inference/async-operation-authority", () => ({ resolveServerOwnedAsyncOperationAuthority: vi.fn(async () => ({ kind: "workroom", workroomId: "isolated-workroom" })) }));

// Only an explicitly supplied governed test target. All writes stay in this
// suite's unique namespace; installed records are never fixtures or cleanup.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `runtime_reconciliation_test_${randomUUID().replaceAll("-", "")}`;
const ids = ["runtime:build", "runtime:core", "runtime:local-speech"];
const catalogHash = "a".repeat(64), secret = "s".repeat(32);
const previousStates = { "runtime:build": "active", "runtime:core": "active", "runtime:local-speech": "operator-paused" };
const desiredStates = { ...previousStates, "runtime:build": "disabled" };

describe.skipIf(!url)("runtime reconciliation transactions on PostgreSQL", () => {
  let admin: Pool, pool: Pool, db: PrismaClient;
  let receipts: ReturnType<typeof createPrismaRuntimeTransitionReceipts>;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=5000 -c application_name=${schema}`, max: 2 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    for (const table of ["PlatformCapability", "RuntimeCapabilityTransition", "RuntimeCapabilityTransitionEvent", "TaskRun", "BacklogItem", "AgentThread", "AgentMessage", "WorkCapsule"]) {
      await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    receipts = createPrismaRuntimeTransitionReceipts(db as never);
    producerDb.current = db;
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE "RuntimeCapabilityTransitionEvent", "RuntimeCapabilityTransition", "PlatformCapability", "TaskRun", "BacklogItem", "AgentThread", "AgentMessage", "WorkCapsule"');
    for (const [capabilityId, state] of Object.entries(previousStates)) {
      await db.platformCapability.create({ data: { capabilityId, name: capabilityId, description: "isolated test", state, manifest: {} } });
    }
  });
  afterAll(async () => {
    await db?.$disconnect(); await pool?.end();
    if (admin && /^runtime_reconciliation_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  function request(transitionId = "RCT-persistence") {
    const now = Date.now();
    const hostHash = computeCapabilityStateVersion(catalogHash, ["runtime:core"], ids);
    const envelope: RuntimeTransitionEnvelope = {
      version: 2, kind: "runtime-capability-transition", mode: "reconciliation", transitionId,
      issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), catalogHash,
      previousStateHash: hostHash, desiredStateHash: hostHash, previousKeys: ["runtime:core"], desiredKeys: ["runtime:core"], previousProfiles: [], desiredProfiles: [], previousServices: ["portal"], desiredServices: ["portal"],
      protocolIdentity: { sourceSha: "a".repeat(40), promoterDigest: `sha256:${"b".repeat(64)}`, actuatorSha256: "c".repeat(64), signerSha256: "d".repeat(64) },
      reconciliation: { observedHost: { schemaVersion: 2, installerVersion: "fixture", platform: "linux", arch: "amd64", capabilityCatalogHash: catalogHash, capabilityStateVersion: hostHash, enabledRuntimeCapabilities: ["runtime:core"] }, observedDatabaseStates: previousStates, desiredHostEnabledKeys: ["runtime:core"], desiredDatabaseStates: desiredStates, touchedKeys: ["runtime:build"] },
    };
    return { ...envelope, requestedById: "fixture-owner", previousStates, desiredStates, envelope, envelopeSignature: signTransitionPayload(envelope, secret) };
  }
  function receipt(envelope: RuntimeTransitionEnvelope) {
    const value = { ...envelope, status: "applied" as const, completedAt: envelope.issuedAt, beforeHash: envelope.previousStateHash, afterHash: envelope.desiredStateHash, observedServices: ["portal"] };
    return { ...value, signature: signTransitionPayload(value, secret) };
  }
  const states = async () => Object.fromEntries((await db.platformCapability.findMany()).map(row => [row.capabilityId, row.state]));
  const produce = (options: Pick<AutonomousWorkRunInput, "transactionIsolationLevel" | "admissionGuard"> = {}) => createAutonomousWorkRun({
    trigger: "interactive", taskRunId: "TR-isolated-production-producer", userId: "fixture-owner", agentId: "fixture-coworker",
    routeContext: "/finance", title: "isolated producer", objective: "fixture only", prompt: "isolated input; no model dispatch", ...options,
  }).then(() => {});
  const observeWait = async () => (await admin.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND ((wait_event = 'advisory' AND query LIKE '%runtime-capability-transition%') OR (wait_event = 'relation' AND query LIKE '%RuntimeCapabilityTransition%'))) AS waiting", [schema])).rows[0].waiting as boolean;

  async function imageRequest() {
    await db.platformCapability.create({ data: { capabilityId: "runtime:browser-automation", name: "isolated browser", description: "isolated test", state: "active", manifest: { runtime: { workGuards: ["task-run:proactive"] } } } });
    const base = request("RCT-producer-image");
    const keys = ["runtime:browser-automation", "runtime:core"];
    const bothStates = { ...previousStates, "runtime:browser-automation": "active" };
    const sourceSha = "a".repeat(40);
    const envelope: RuntimeTransitionEnvelope = { ...base.envelope, version: 3, kind: "runtime-capability-transition", mode: "reconciliation",
      previousKeys: keys, desiredKeys: keys, previousServices: ["browser-use", "portal"], desiredServices: ["browser-use", "portal"],
      protocolIdentity: { ...base.envelope.protocolIdentity!, imageQualifierSha256: "e".repeat(64) },
      imagePlan: { schemaVersion: 1, sourceSha, platform: "linux/amd64", operation: "prepare", services: [{ service: "browser-use", source: { kind: "source", sourceSha } }] },
      reconciliation: { observedHost: { schemaVersion: 2, installerVersion: "isolated-producer-test", platform: "linux", arch: "amd64", capabilityCatalogHash: catalogHash, capabilityStateVersion: base.previousStateHash, enabledRuntimeCapabilities: keys }, observedDatabaseStates: bothStates, desiredHostEnabledKeys: keys, desiredDatabaseStates: bothStates, touchedKeys: [] },
    };
    validateRuntimeServiceImagePlan(envelope);
    return { ...base, ...envelope, previousStates: bothStates, desiredStates: bothStates, envelope, envelopeSignature: signTransitionPayload(envelope, secret) };
  }

  it("fences a real producer insert after image admission and through uncertain recovery, then releases it on settlement", async () => {
    const input = await imageRequest();
    await receipts.createPending(input);
    await expect(produce()).rejects.toThrow("runtime_capability_work_draining:runtime:browser-automation");
    expect(await db.taskRun.count()).toBe(0);
    await db.runtimeCapabilityTransition.update({ where: { transitionId: input.transitionId }, data: { status: "rollback_failed", failure: { recoveryRequired: true } } });
    await expect(produce()).rejects.toThrow("runtime_capability_work_draining:runtime:browser-automation");
    expect(await db.taskRun.count()).toBe(0);
    await db.runtimeCapabilityTransition.update({ where: { transitionId: input.transitionId }, data: { status: "rolled_back", failure: { recoveryRequired: false } } });
    await produce();
    expect(await db.taskRun.count()).toBe(1);
    expect(await states()).toEqual(input.previousStates);
  });

  it("lets a producer admitted first commit before the transition drain recheck", async () => {
    const input = await imageRequest();
    let releaseProducer!: () => void, reportAdmission!: () => void;
    const hold = new Promise<void>(resolve => { releaseProducer = resolve; });
    const admitted = new Promise<void>(resolve => { reportAdmission = resolve; });
    const producer = produce({ admissionGuard: async () => { reportAdmission(); await hold; } });
    try {
      await Promise.race([admitted, producer.then(() => { throw new Error("producer finished before the admission checkpoint"); })]);
      const transition = receipts.createPending({ ...input, recheckAttributedWork: async store =>
        (await countAttributedWork(["task-run:coworker"], store!)).blockingCounts });
      releaseProducer();
      await producer;
      expect(await transition).toMatchObject({ created: false, kind: "drain_required", blockingCounts: { "task-run:coworker": 1 } });
      expect(await db.runtimeCapabilityTransition.count()).toBe(0);
      expect(await db.taskRun.count()).toBe(1);
    } finally {
      releaseProducer();
      await producer;
    }
  });

  it.each(["ReadCommitted", "Serializable"] as const)("does not insert a %s producer behind an uncommitted transition", async isolationLevel => {
    const input = await imageRequest();
    let releaseTransition!: () => void, reportTransitionReady!: () => void;
    const hold = new Promise<void>(resolve => { releaseTransition = resolve; });
    const ready = new Promise<void>(resolve => { reportTransitionReady = resolve; });
    // Execute the real receipt owner against a real transaction, holding only
    // its commit so the producer's first admission statement must contend.
    const heldReceipts = createPrismaRuntimeTransitionReceipts({ $transaction: (callback: (tx: unknown) => Promise<unknown>, options: unknown) =>
      db.$transaction(async tx => {
        const result = await callback(tx);
        reportTransitionReady();
        await hold;
        return result;
      }, options as never) } as never);
    const transition = heldReceipts.createPending(input);
    let producer: Promise<void> | undefined, outcome: PromiseSettledResult<void> | undefined;
    try {
      await Promise.race([ready, transition.then(() => { throw new Error("transition finished before the commit checkpoint"); })]);
      // Omit the override for Serializable: exercise the production default.
      producer = produce(isolationLevel === "ReadCommitted" ? { transactionIsolationLevel: "ReadCommitted" } : {})
        .then(() => { outcome = { status: "fulfilled", value: undefined }; }, reason => { outcome = { status: "rejected", reason }; });
      // Observe actual server lock contention, or an immediate safe refusal;
      // elapsed time alone is not evidence that the producer reached the lock.
      await vi.waitFor(async () => {
        expect(await observeWait() || outcome?.status === "rejected").toBe(true);
      });
      expect(producerDb.lastIsolation).toBe(isolationLevel);
      releaseTransition();
      expect(await transition).toMatchObject({ created: true });
      await producer;
      expect(outcome?.status).toBe("rejected");
      if (outcome?.status === "rejected") expect(outcome.reason?.code === "P2034"
        || /runtime_capability_work_draining|runtime_transition_admission_busy|serializ|40001/i.test(String(outcome.reason))).toBe(true);
      expect(await db.taskRun.count()).toBe(0);
    } finally {
      releaseTransition();
      await Promise.allSettled([transition, ...(producer ? [producer] : [])]);
    }
  });

  it("counts on the transaction connection while both pool connections are occupied", async () => {
    const input = await imageRequest();
    let releaseCount!: () => void, reportCount!: () => void;
    const hold = new Promise<void>(resolve => { releaseCount = resolve; });
    const counting = new Promise<void>(resolve => { reportCount = resolve; });
    const transition = receipts.createPending({ ...input, recheckAttributedWork: async store => {
      reportCount(); await hold;
      return (await countAttributedWork(["task-run:coworker"], store!)).blockingCounts;
    } });
    let producer: Promise<unknown> | undefined;
    try {
      await Promise.race([counting, transition.then(() => { throw new Error("transition did not reach its counter"); })]);
      producer = produce().then(() => "inserted", reason => String(reason));
      await vi.waitFor(async () => expect(await observeWait()).toBe(true));
      releaseCount();
      expect(await transition).toMatchObject({ created: true });
      expect(await producer).toContain("runtime_capability_work_draining");
      expect(await db.taskRun.count()).toBe(0);
    } finally {
      releaseCount();
      await Promise.allSettled([transition, ...(producer ? [producer] : [])]);
    }
  });

  it("settles a transition after an unrelated admission without inverted-lock deadlock", async () => {
    const input = request(); await receipts.createPending(input); await receipts.markHostApplied(input.transitionId);
    let releaseAdmission!: () => void, reportAdmission!: () => void;
    const hold = new Promise<void>(resolve => { releaseAdmission = resolve; });
    const admitted = new Promise<void>(resolve => { reportAdmission = resolve; });
    const producer = db.$transaction(async tx => {
      await admitRuntimeGuardedWork(tx as never, "task-run:unrelated");
      reportAdmission(); await hold;
    });
    let settlement: Promise<unknown> | undefined;
    try {
      await Promise.race([admitted, producer.then(() => { throw new Error("admission did not reach its checkpoint"); })]);
      settlement = receipts.commitSuccess!(input.transitionId, receipt(input.envelope), desiredStates);
      await vi.waitFor(async () => expect(await observeWait()).toBe(true));
      releaseAdmission();
      await Promise.all([producer, settlement]);
      expect(await states()).toEqual(desiredStates);
      expect((await db.runtimeCapabilityTransition.findUniqueOrThrow({ where: { transitionId: input.transitionId } })).status).toBe("succeeded");
    } finally {
      releaseAdmission();
      await Promise.allSettled([producer, ...(settlement ? [settlement] : [])]);
    }
  });

  it.each(["ReadCommitted", "Serializable", "RepeatableRead"] as const)("handles earlier writes without weakening %s", async isolationLevel => {
    const itemId = "BI-AD017001";
    // LIKE preserves public enum defaults, while Prisma's create binds enum
    // inputs to its adapter schema. Seed only this isolated row without making
    // a second, incompatible enum type; the transactional write stays real.
    await db.$executeRaw`INSERT INTO "BacklogItem" ("id", "itemId", "title", "status", "type", "source", "workType", "updatedAt") VALUES (${randomUUID()}, ${itemId}, 'isolated admission fixture', 'triaging', 'product', 'automated-detection', 'bug', CURRENT_TIMESTAMP)`;
    const action = db.$transaction(async tx => {
      await tx.backlogItem.update({ where: { itemId }, data: { status: "open", triageOutcome: "build" }, select: { status: true } });
      await admitRuntimeGuardedWork(tx as never, "task-run:coworker");
    }, { isolationLevel });
    if (isolationLevel === "ReadCommitted") await action;
    else await expect(action).rejects.toThrow(/DEFERRABLE.*before any query/);
    expect((await db.backlogItem.findUniqueOrThrow({ where: { itemId }, select: { status: true } })).status).toBe(isolationLevel === "ReadCommitted" ? "open" : "triaging");
  });

  it.each(["Serializable", "RepeatableRead"] as const)("preserves %s settings and supports later reentry after an early fence", async isolationLevel => {
    for (const deferrable of [false, true]) {
      await db.$transaction(async tx => {
        if (deferrable) await tx.$executeRaw`SET TRANSACTION DEFERRABLE`;
        const before = await tx.$queryRaw`SHOW transaction_deferrable`;
        await lockRuntimeTransitionAdmission(tx as never);
        await tx.taskRun.count();
        await admitRuntimeGuardedWork(tx as never, "build-studio-active");
        expect(await tx.$queryRaw`SHOW transaction_deferrable`).toEqual(before);
        expect(await tx.$queryRaw`SHOW transaction_isolation`).toEqual([{ transaction_isolation: isolationLevel === "Serializable" ? "serializable" : "repeatable read" }]);
      }, { isolationLevel });
    }
  });

  it("does not reuse a rolled-back transaction fence on the next transaction", async () => {
    let previous: unknown;
    await expect(db.$transaction(async tx => {
      previous = tx;
      await lockRuntimeTransitionAdmission(tx as never);
      throw new Error("isolated deliberate rollback");
    }, { isolationLevel: "Serializable" })).rejects.toThrow("isolated deliberate rollback");
    await db.$transaction(async tx => {
      expect(tx).not.toBe(previous);
      await lockRuntimeTransitionAdmission(tx as never);
      await admitRuntimeGuardedWork(tx as never, "task-run:coworker");
    }, { isolationLevel: "Serializable" });
    await expect(db.$transaction(async tx => {
      await tx.taskRun.count();
      await lockRuntimeTransitionAdmission(tx as never);
    }, { isolationLevel: "Serializable" })).rejects.toThrow(/DEFERRABLE.*before any query/);
  });

  async function realCaller(kind: "spawn" | "durable") {
    if (kind === "spawn") {
      await db.agentThread.create({ data: { id: "isolated-parent", userId: "fixture-owner", contextKey: "isolated" } });
      return () => spawnWorkThread("isolated-parent", "isolated objective", "fixture-owner").then(() => {});
    }
    await db.workroom.create({ data: { id: "isolated-workroom", capsuleId: "WC-ISOLATED", title: "isolated", objective: "isolated", source: "manual" } });
    return () => admitPrismaWorkroomBoundDurableTaskOperation({
      providerId: "fixture", modelId: "fixture", contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
      screenedRequestDigest: "s".repeat(64), expiresAt: new Date(Date.now() + 60_000),
      screenedRequestContext: { attribution: { agentId: "fixture-coworker", routeContext: "/finance" }, executionPlan: { recipeId: "background.mcp-durable-inference-one-shot.v1" } },
      request: { kind: "workroom", workroomId: "WC-ISOLATED", requestKey: "isolated-request", requestDigest: "d".repeat(64) },
      actor: { userId: "fixture-owner", agentId: "fixture-coworker", principalId: "fixture-owner", isSuperuser: false },
    }, { admitTaskRunOperation: async () => ({ operationId: "isolated-operation", replayed: false }), enqueue: async () => {} }).then(() => {});
  }

  it.each(["spawn", "durable"] as const)("runs the actual %s caller and saved bindings on a fresh Serializable transaction", async kind => {
    const produceActual = await realCaller(kind);
    await produceActual();
    expect(producerDb.lastIsolation).toBe("Serializable");
    expect(await db.taskRun.count()).toBe(1);
    if (kind === "spawn") {
      expect((await db.agentThread.findUniqueOrThrow({ where: { id: "isolated-parent" } })).childCount).toBe(1);
      expect(await db.agentMessage.count()).toBe(1);
    } else {
      expect((await db.workroom.findUniqueOrThrow({ where: { id: "isolated-workroom" } })).taskRunId).not.toBeNull();
      await produceActual();
      expect(await db.taskRun.count()).toBe(1);
    }
  });

  it.each(["spawn", "durable"] as const)("fences the actual earlier-read %s caller behind an uncommitted transition", async kind => {
    const produceActual = await realCaller(kind), input = await imageRequest();
    let release!: () => void, signal!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { signal = resolve; });
    const held = createPrismaRuntimeTransitionReceipts({ $transaction: (callback: (tx: unknown) => Promise<unknown>, options: unknown) => db.$transaction(async tx => { const result = await callback(tx); signal(); await hold; return result; }, options as never) } as never);
    const transition = held.createPending(input);
    let producer: Promise<void> | undefined, outcome: PromiseSettledResult<void> | undefined;
    try {
      await Promise.race([ready, transition.then(() => { throw new Error("transition missed checkpoint"); })]);
      producer = produceActual().then(() => { outcome = { status: "fulfilled", value: undefined }; }, reason => { outcome = { status: "rejected", reason }; });
      await vi.waitFor(async () => expect(await observeWait() || outcome?.status === "rejected").toBe(true));
      release(); await transition; await producer;
      expect(outcome?.status).toBe("rejected");
      if (outcome?.status === "rejected") expect(String(outcome.reason)).toMatch(/runtime_capability_work_draining|serializ|40001/i);
      expect(await db.taskRun.count()).toBe(0);
      expect(await db.agentMessage.count()).toBe(0);
      if (kind === "spawn") expect((await db.agentThread.findUniqueOrThrow({ where: { id: "isolated-parent" } })).childCount).toBe(0);
      else expect((await db.workroom.findUniqueOrThrow({ where: { id: "isolated-workroom" } })).taskRunId).toBeNull();
    } finally { release(); await Promise.allSettled([transition, ...(producer ? [producer] : [])]); }
  });

  it("admits at most one concurrent writer under real serializable transactions", async () => {
    const results = await Promise.allSettled([receipts.createPending(request("RCT-writer-a")), receipts.createPending(request("RCT-writer-b"))]);
    expect(results.filter(result => result.status === "fulfilled" && result.value.created)).toHaveLength(1);
    expect(await db.runtimeCapabilityTransition.count()).toBe(1);
    expect(await states()).toEqual(previousStates);
  });
  it("commits only managed settings while retaining an unknown untouched operator state", async () => {
    const input = request(); await receipts.createPending(input); await receipts.markHostApplied(input.transitionId);
    await receipts.commitSuccess!(input.transitionId, receipt(input.envelope), desiredStates);
    expect(await states()).toEqual(desiredStates);
    expect((await db.runtimeCapabilityTransition.findUniqueOrThrow({ where: { transitionId: input.transitionId } })).status).toBe("succeeded");
  });
  it("refuses an intervening writer without partial capability or outcome writes", async () => {
    const input = request(); await receipts.createPending(input); await receipts.markHostApplied(input.transitionId);
    await db.platformCapability.update({ where: { capabilityId: "runtime:build" }, data: { state: "operator-paused" } });
    await expect(receipts.commitSuccess!(input.transitionId, receipt(input.envelope), desiredStates)).rejects.toThrow("runtime_transition_database_stale");
    expect(await states()).toEqual({ ...previousStates, "runtime:build": "operator-paused" });
    expect((await db.runtimeCapabilityTransition.findUniqueOrThrow({ where: { transitionId: input.transitionId } })).status).toBe("host_applied");
    expect(await db.runtimeCapabilityTransitionEvent.count({ where: { outcome: "succeeded" } })).toBe(0);
  });
  it("retains the immutable compensation packet when its outcome requires recovery", async () => {
    const input = request(); await receipts.createPending(input); await receipts.markHostApplied(input.transitionId);
    const reverse = createRuntimeCompensationEnvelope(input.envelope, Date.now());
    const compensation = { envelope: reverse, envelopeSignature: signTransitionPayload(reverse, secret) };
    await receipts.markCompensating!(input.transitionId, "commit-unavailable", compensation);
    await receipts.markRollbackFailed!(input.transitionId, "receipt-unavailable");
    const row = await db.runtimeCapabilityTransition.findUniqueOrThrow({ where: { transitionId: input.transitionId } });
    expect(row.failure).toEqual({ code: "receipt-unavailable", recoveryRequired: true, compensation });
    expect(await states()).toEqual(previousStates);
  });
  it("rejects a same-id replay with a different immutable promoter", async () => {
    const input = request(); await receipts.createPending(input);
    const changed = request(); changed.envelope.protocolIdentity!.promoterDigest = `sha256:${"f".repeat(64)}`;
    changed.envelopeSignature = signTransitionPayload(changed.envelope, secret);
    await expect(receipts.createPending(changed)).rejects.toThrow("transition_id_conflict");
    expect(await db.runtimeCapabilityTransition.count()).toBe(1);
  });
  it("fences a later database writer before live compensation without losing its packet", async () => {
    const input = request(); await receipts.createPending(input); await receipts.markHostApplied(input.transitionId);
    const reverse = createRuntimeCompensationEnvelope(input.envelope, Date.now());
    const compensation = { envelope: reverse, envelopeSignature: signTransitionPayload(reverse, secret) };
    await receipts.markCompensating!(input.transitionId, "required_health_failed", compensation);
    await receipts.assertCompensationOwnership!(input.transitionId);
    await db.platformCapability.update({ where: { capabilityId: "runtime:build" }, data: { state: "operator-paused" } });
    await expect(receipts.assertCompensationOwnership!(input.transitionId)).rejects.toThrow("runtime_transition_database_stale");
    await receipts.markRollbackFailed!(input.transitionId, "runtime_transition_database_stale");
    const row = await db.runtimeCapabilityTransition.findUniqueOrThrow({ where: { transitionId: input.transitionId } });
    expect(row.failure).toEqual({ code: "runtime_transition_database_stale", recoveryRequired: true, compensation });
    expect(await states()).toEqual({ ...previousStates, "runtime:build": "operator-paused" });
  });
});
