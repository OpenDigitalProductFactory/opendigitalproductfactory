import { describe, expect, it, vi } from "vitest";
import { settleObsoleteLeaseReleaseEnvelopes, type ObsoleteReleaseDb, type ObsoleteReleaseEnvelope, type ObsoleteReleaseTarget } from "./obsolete-lease-envelope";
import { OBSOLETE_NOW as now, obsoleteEnvelope, obsoleteTarget } from "./obsolete-lease-envelope.test-fixtures";

function fixture(rows = [obsoleteEnvelope()], initial: ObsoleteReleaseTarget | null = obsoleteTarget()) {
  let lease = initial;
  let onLock = () => {};
  const findMany = vi.fn(async ({ where, take }: any) => rows.filter(row =>
    row.manifestActionId === where.manifestActionId && row.taskRunId === null && row.resolvedAt === null
    && where.status.in.includes(row.status) && (!where.id || row.id > where.id.gt))
    .sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(row => structuredClone(row)));
  const updateMany = vi.fn(async ({ where, data }: any) => {
    const row = rows.find(r => r.id === where.id);
    if (!row || row.status !== where.status || row.resolvedAt !== null
      || JSON.stringify(row.argsJson) !== JSON.stringify(where.argsJson.equals)) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  const findUnique = vi.fn(async () => lease && structuredClone(lease));
  const executeRaw = vi.fn(async () => { onLock(); return 1; });
  const raw = { coworkerActionEnvelope: { findMany, updateMany }, nonProductionEnvironmentLease: { findUnique },
    $executeRaw: executeRaw, $transaction: async <T,>(run: (tx: unknown) => Promise<T>) => run(raw) };
  return { db: raw as unknown as ObsoleteReleaseDb, rows, findMany, updateMany, findUnique, executeRaw,
    setLease(value: ObsoleteReleaseTarget | null) { lease = value; }, atLock(run: () => void) { onLock = run; } };
}

describe("obsolete reservation approval settlement", () => {
  it.each(["proposed", "approved"])("settles %s without changing original audit or calling a handler", async status => {
    const row = { ...obsoleteEnvelope(), status };
    const before = structuredClone(row);
    const f = fixture([row]);
    expect(await settleObsoleteLeaseReleaseEnvelopes(f.db, now)).toMatchObject({ scanned: 1, cancelled: 1,
      skipped: 0, inconclusive: 0, hasMore: false, nextCursor: null,
      reason: "target-reservation-ended-before-admission", settled: [{ envelopeId: row.id, leaseId: "NPEL-unused" }] });
    expect(row).toEqual({ ...before, status: "cancelled", resolvedAt: now });
    expect(f.updateMany.mock.calls[0][0].data).toEqual({ status: "cancelled", resolvedAt: now });
    expect((await settleObsoleteLeaseReleaseEnvelopes(f.db, now)).cancelled).toBe(0);
  });
  it("also settles a provably unused expired reservation", async () => {
    const f = fixture([obsoleteEnvelope()], { ...obsoleteTarget(), status: "expired" });
    expect((await settleObsoleteLeaseReleaseEnvelopes(f.db, now)).cancelled).toBe(1);
  });

  it.each([
    ["active", { status: "active" }], ["queued", { status: "queued" }], ["released after use", { status: "released" }],
    ["admitted", { admittedAt: now }], ["slot", { slotKey: "slot-0" }], ["active key", { activeKey: "pool:slot-0" }],
    ["PID", { ownerPid: 7 }], ["process identity", { ownerProcessIdentity: "unknown-process" }],
    ["cleanup", { cleanupCommand: "cleanup" }], ["resource", { resourceClass: "inference" }],
    ["memory", { expectedMemoryBytes: 0n }], ["legacy manifest", { slotManifestVersion: null }],
    ["unknown terminal time", { releasedAt: null }], ["future terminal time", { releasedAt: new Date(now.getTime() + 1) }],
    ["foreign session", { ownerSessionId: "other-session" }], ["wrong target", { leaseId: "NPEL-other" }],
    ["unknown environment", { environmentKey: "unknown" }],
  ] as Array<[string, Partial<ObsoleteReleaseTarget>]>) ("leaves a %s target unchanged", async (_name, change) => {
    const row = obsoleteEnvelope(), before = structuredClone(row);
    const f = fixture([row], { ...obsoleteTarget(), ...change });
    expect((await settleObsoleteLeaseReleaseEnvelopes(f.db, now)).cancelled).toBe(0);
    expect(row).toEqual(before); expect(f.updateMany).not.toHaveBeenCalled();
  });
  it("leaves a missing target unchanged", async () => {
    const f = fixture([obsoleteEnvelope()], null);
    expect((await settleObsoleteLeaseReleaseEnvelopes(f.db, now)).skipped).toBe(1);
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  const invalid: Array<[string, (row: ObsoleteReleaseEnvelope) => void]> = [
    ["reserved", r => { r.resolvedAt = now; }], ["task-bound", r => { r.taskRunId = "TR-private"; }],
    ["other tool", r => { r.manifestActionId = "request_self_upgrade"; }],
    ["settled", r => { r.status = "executed"; }], ["unbound", r => { r.argsJson = {}; }],
    ["changed binding", r => { r.approvalBindingFingerprint = "different"; }],
    ["missing park", r => { r.toolExecutions = []; }],
    ["changed parameters", r => { r.toolExecutions[0].parameters = { leaseId: "different" }; }],
    ["successful execution", r => { r.toolExecutions[0].success = true; }],
    ["failed execution", r => { r.toolExecutions[0].result = { success: false, error: "handler_failed" }; }],
    ["unknown execution", r => { r.toolExecutions.push({ ...r.toolExecutions[0], result: { error: "approval_execution_unknown" } }); }],
    ["wrong result envelope", r => { r.toolExecutions[0].result = { success: false, error: "approval_required", data: { envelopeId: "other" } }; }],
    ["wrong stored envelope", r => { r.toolExecutions[0].envelopeId = "other"; }],
    ["wrong human", r => { r.toolExecutions[0].userId = "other"; }],
    ["wrong assistant", r => { r.toolExecutions[0].agentId = "other"; }],
    ["task execution", r => { r.toolExecutions[0].taskRunId = "TR-private"; }],
    ["too many executions", r => { r.toolExecutions = Array.from({ length: 26 }, () => r.toolExecutions[0]); }],
  ];
  it.each(invalid)("does not settle a request with %s", async (_name, change) => {
    const row = obsoleteEnvelope(); change(row);
    const before = structuredClone(row), f = fixture([row]);
    expect((await settleObsoleteLeaseReleaseEnvelopes(f.db, now)).cancelled).toBe(0);
    expect(row).toEqual(before); expect(f.updateMany).not.toHaveBeenCalled();
  });
  it("accepts repeated identical parked direct calls without platform resume metadata", async () => {
    const row = obsoleteEnvelope(); row.toolExecutions.push(structuredClone(row.toolExecutions[0]));
    expect((await settleObsoleteLeaseReleaseEnvelopes(fixture([row]).db, now)).cancelled).toBe(1);
  });
  it("re-reads under the shared environment lock and loses to revival", async () => {
    const f = fixture(); f.atLock(() => f.setLease({ ...obsoleteTarget(), status: "queued", releasedAt: null }));
    expect((await settleObsoleteLeaseReleaseEnvelopes(f.db, now)).cancelled).toBe(0);
    expect(f.findUnique).toHaveBeenCalledTimes(2); expect(f.executeRaw).toHaveBeenCalledOnce();
    expect(f.updateMany).not.toHaveBeenCalled();
  });
  it.each(["human approval", "human decline", "execution reservation"])("loses to a racing %s", async race => {
    const row = { ...obsoleteEnvelope(), status: race === "execution reservation" ? "approved" : "proposed" };
    const f = fixture([row]);
    f.atLock(() => { if (race === "execution reservation") row.resolvedAt = now;
      else row.status = race === "human approval" ? "approved" : "declined"; });
    expect((await settleObsoleteLeaseReleaseEnvelopes(f.db, now)).cancelled).toBe(0);
    expect(row.status).toBe(race === "human decline" ? "declined" : "approved");
  });
  it("reports an unavailable lock as inconclusive and does not touch the envelope", async () => {
    const f = fixture(); f.executeRaw.mockRejectedValue(new Error("transaction unavailable"));
    expect(await settleObsoleteLeaseReleaseEnvelopes(f.db, now)).toMatchObject({ cancelled: 0, inconclusive: 1 });
    expect(f.rows[0].status).toBe("proposed"); expect(f.updateMany).not.toHaveBeenCalled();
  });
  it("moves beyond 200 unchanged negative requests, then wraps after the final page", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => obsoleteEnvelope(`approval-${String(i).padStart(3, "0")}`));
    for (const row of rows.slice(0, 200)) row.argsJson = {};
    const f = fixture(rows);
    const first = await settleObsoleteLeaseReleaseEnvelopes(f.db, now);
    expect(first).toMatchObject({ scanned: 200, cancelled: 0, skipped: 200, hasMore: true, nextCursor: "approval-199" });
    const second = await settleObsoleteLeaseReleaseEnvelopes(f.db, now, first.nextCursor);
    expect(second).toMatchObject({ scanned: 1, cancelled: 1, hasMore: false, nextCursor: null });
    expect(rows[200].status).toBe("cancelled");
    expect(f.findMany.mock.calls[0][0].take).toBe(201);
    expect((await settleObsoleteLeaseReleaseEnvelopes(f.db, now, second.nextCursor)).cancelled).toBe(0);
  });
});
