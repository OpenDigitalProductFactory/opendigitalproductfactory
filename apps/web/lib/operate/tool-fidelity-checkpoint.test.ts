import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { createFidelityCheckpoint, claimFidelityObservation, completeFidelityObservation } from "./tool-fidelity-checkpoint";

const db = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), update: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { endpointTestRun: { create: db.create, findUnique: db.read, updateMany: db.update } } }));
let row: { id: string; runId: string; triggeredBy: string; taskType: string; status: string; results: Record<string, unknown> } | null;
const clone = <T>(value: T): T => structuredClone(value);
const input = () => ({ userId: "user", ownerHash: "a".repeat(64), bindingHash: "b".repeat(64),
  identity: { sourceSha: "c".repeat(40) }, endpointId: "local", modelId: "local-model", now: 1_000, stepBudgetMs: 720_000,
  schedule: Array.from({ length: 45 }, (_, index) => ({ surfaceSize: [8, 15, 24, 32, 48][Math.floor(index / 9)]!,
    caseIndex: index % 9, taskClass: "backlog-status", status: "unrun" as const,
    selectionPassed: false, executionPassed: false, reason: "pending" })) });
const request = (runId: string, index = 0, now = 2_000) => ({ runId, userId: "user", ownerHash: "a".repeat(64),
  bindingHash: "b".repeat(64), observationIndex: index, now, stepBudgetMs: 720_000 });
const observation = () => ({ ...input().schedule[0]!, status: "passed" as const, selectionPassed: true,
  executionPassed: true, reason: "verified_governed_read", toolExecutionId: "actual-row-id" });

beforeEach(() => {
  row = null;
  vi.clearAllMocks();
  db.create.mockImplementation(async ({ data }) => {
    if (row) throw { code: "P2002" };
    row = { id: "db-row", ...clone(data) };
    return clone(row);
  });
  db.read.mockImplementation(async () => clone(row));
  db.update.mockImplementation(async ({ where, data }) => {
    if (!row || row.id !== where.id || row.status !== where.status
      || canonicalJson(row.results) !== canonicalJson(where.results.equals)) return { count: 0 };
    Object.assign(row, clone(data));
    return { count: 1 };
  });
});

describe("server-owned fidelity checkpoints", () => {
  it("deduplicates concurrent starts for the same authority and cohort without client nonce control", async () => {
    const [first, second] = await Promise.all([createFidelityCheckpoint(input()), createFidelityCheckpoint(input())]);
    expect(first.runId).toBe(second.runId);
    expect(row!.results.checkpoint).toMatchObject({ revision: 0, state: "ready", nextIndex: 0 });
  });

  it("wins exactly one durable claim before two concurrent callers could infer", async () => {
    const run = await createFidelityCheckpoint(input());
    const claims = await Promise.all([claimFidelityObservation(request(run.runId)), claimFidelityObservation(request(run.runId))]);
    expect(claims.filter(result => result.kind === "claimed")).toHaveLength(1);
    expect(claims.filter(result => result.kind !== "claimed")).toHaveLength(1);
    expect(db.update.mock.calls.every(([call]) => call.where.results.equals !== undefined)).toBe(true);
  });

  it("returns a completed observation after a lost response without claiming its successor", async () => {
    const run = await createFidelityCheckpoint(input());
    const claim = await claimFidelityObservation(request(run.runId));
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") throw new Error("claim was not won");
    expect(await completeFidelityObservation(claim, observation(), 3_000)).toBe(true);
    const writes = db.update.mock.calls.length;
    const replay = await claimFidelityObservation(request(run.runId, 0, 4_000));
    expect(replay.kind).toBe("readback");
    expect(db.update).toHaveBeenCalledTimes(writes);
    expect(row!.results.checkpoint).toMatchObject({ state: "ready", nextIndex: 1 });
  });

  it("never steals an expired started case, and fences its late successful worker", async () => {
    const run = await createFidelityCheckpoint(input());
    const claim = await claimFidelityObservation(request(run.runId));
    if (claim.kind !== "claimed") throw new Error("claim was not won");
    const expired = await claimFidelityObservation(request(run.runId, 0, 722_001));
    expect(expired.kind).toBe("held");
    expect(await completeFidelityObservation(claim, observation(), 722_002)).toBe(false);
    expect(row!.results.checkpoint).toMatchObject({ state: "held", reason: "execution_unsettled" });
    expect((row!.results.observations as Array<{ executionPassed: boolean }>)[0]!.executionPassed).toBe(false);
  });

  it("reauthorizes completed readback and rejects authority drift without disclosing the checkpoint", async () => {
    const run = await createFidelityCheckpoint(input());
    const claim = await claimFidelityObservation(request(run.runId));
    if (claim.kind !== "claimed") throw new Error("claim was not won");
    await completeFidelityObservation(claim, observation(), 3_000);
    await expect(claimFidelityObservation({ ...request(run.runId), ownerHash: "d".repeat(64) }))
      .rejects.toThrow("fidelity_authority_unverified");
    await expect(claimFidelityObservation({ ...request(run.runId), userId: "other-user" }))
      .rejects.toThrow("fidelity_authority_unverified");
  });

  it("retains late results as incomplete instead of qualifying or advancing a held run", async () => {
    const run = await createFidelityCheckpoint(input());
    const claim = await claimFidelityObservation(request(run.runId));
    if (claim.kind !== "claimed") throw new Error("claim was not won");
    expect(await completeFidelityObservation(claim, observation(), 722_001)).toBe(true);
    expect(row!.status).toBe("incomplete");
    expect(row!.results.checkpoint).toMatchObject({ state: "held" });
    expect((row!.results.observations as Array<{ status: string; executionPassed: boolean }>)[0])
      .toMatchObject({ status: "incomplete", executionPassed: false });
  });
  it("never renews an accepted claim from a caller's larger budget or a duplicate start", async () => {
    const run = await createFidelityCheckpoint(input());
    const claim = await claimFidelityObservation({ ...request(run.runId), stepBudgetMs: 2_000_000 });
    if (claim.kind !== "claimed") throw new Error("claim was not won");
    expect(claim.expiresAt).toBe(722_000);
    const duplicate = await createFidelityCheckpoint({ ...input(), now: 40_000, stepBudgetMs: 2_000_000 });
    expect(duplicate.stored.checkpoint.expiresAt).toBe(run.stored.checkpoint.expiresAt);
    expect(duplicate.stored.checkpoint.claimExpiresAt).toBe(722_000);
  });
  it("preserves complete cohort verdicts in the durable diagnostic history", async () => {
    const run = await createFidelityCheckpoint(input());
    for (let index = 0; index < 45; index++) {
      const claim = await claimFidelityObservation(request(run.runId, index, 2_000 + index));
      if (claim.kind !== "claimed") throw new Error("claim was not won");
      await completeFidelityObservation(claim, { ...observation(), ...input().schedule[index]!,
        status: "passed", selectionPassed: true, executionPassed: true }, 3_000 + index);
    }
    expect(row!.status).toBe("completed");
    expect(row!.results).toMatchObject({ qualified: true, capChanged: false, classSpecificQualification: false,
      runtimeAcceptance: "unverified", checkpoint: { state: "completed", nextIndex: 45 } });
    expect(row!.results.cohorts).toHaveLength(5);
  });
});
