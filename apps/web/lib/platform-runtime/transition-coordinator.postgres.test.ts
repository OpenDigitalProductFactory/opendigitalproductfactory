import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaRuntimeTransitionReceipts } from "./transition-coordinator";
import { computeCapabilityStateVersion } from "../../../../scripts/lib/capability-state-hash.mjs";
import { createRuntimeCompensationEnvelope, signTransitionPayload, validateRuntimeServiceImagePlan, type RuntimeTransitionEnvelope } from "./transition-protocol";
import { admitRuntimeGuardedWork } from "./work-admission";
import { countAttributedWork, createPrismaWorkAttributionStore } from "./work-attribution";

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
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=5000 -c application_name=${schema}`, max: 4 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    for (const table of ["PlatformCapability", "RuntimeCapabilityTransition", "RuntimeCapabilityTransitionEvent", "TaskRun"]) {
      await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    receipts = createPrismaRuntimeTransitionReceipts(db as never);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE "RuntimeCapabilityTransitionEvent", "RuntimeCapabilityTransition", "PlatformCapability", "TaskRun"');
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

  async function imageRequest() {
    await db.platformCapability.create({ data: { capabilityId: "runtime:browser-automation", name: "isolated browser", description: "isolated test", state: "active", manifest: {} } });
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
    const produce = () => db.$transaction(async tx => {
      await admitRuntimeGuardedWork(tx as never, "task-run:coworker");
      await tx.taskRun.create({ data: { taskRunId: "TR-isolated-producer", userId: "fixture-owner", title: "isolated producer", objective: "fixture only", source: "coworker" } });
    });
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
    const producer = db.$transaction(async tx => {
      await admitRuntimeGuardedWork(tx as never, "task-run:coworker");
      reportAdmission();
      await hold;
      await tx.taskRun.create({ data: { taskRunId: "TR-isolated-concurrent-producer", userId: "fixture-owner", title: "isolated concurrent producer", objective: "fixture only", source: "coworker" } });
    });
    try {
      await Promise.race([admitted, producer.then(() => { throw new Error("producer finished before the admission checkpoint"); })]);
      const transition = receipts.createPending({ ...input, recheckAttributedWork: async () =>
        (await countAttributedWork(["task-run:coworker"], createPrismaWorkAttributionStore(db as never))).blockingCounts });
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
      producer = db.$transaction(async tx => {
        // No preceding SQL: this is the ordinary TaskRun producer's ordering.
        await admitRuntimeGuardedWork(tx as never, "task-run:coworker");
        await tx.taskRun.create({ data: { taskRunId: "TR-isolated-waiting-producer", userId: "fixture-owner", title: "isolated waiting producer", objective: "fixture only", source: "coworker" } });
      }, { isolationLevel }).then(() => { outcome = { status: "fulfilled", value: undefined }; }, reason => { outcome = { status: "rejected", reason }; });
      // Observe actual server lock contention, or an immediate safe refusal;
      // elapsed time alone is not evidence that the producer reached the lock.
      await vi.waitFor(async () => {
        const observed = await admin.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event = 'advisory' AND query LIKE '%runtime-capability-transition%') AS waiting", [schema]);
        expect(observed.rows[0].waiting || outcome?.status === "rejected").toBe(true);
      });
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
