import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaRuntimeTransitionReceipts } from "./transition-coordinator";
import { computeCapabilityStateVersion } from "../../../../scripts/lib/capability-state-hash.mjs";
import { createRuntimeCompensationEnvelope, signTransitionPayload, type RuntimeTransitionEnvelope } from "./transition-protocol";

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
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=5000`, max: 4 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    for (const table of ["PlatformCapability", "RuntimeCapabilityTransition", "RuntimeCapabilityTransitionEvent"]) {
      await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    receipts = createPrismaRuntimeTransitionReceipts(db as never);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE "RuntimeCapabilityTransitionEvent", "RuntimeCapabilityTransition", "PlatformCapability"');
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
