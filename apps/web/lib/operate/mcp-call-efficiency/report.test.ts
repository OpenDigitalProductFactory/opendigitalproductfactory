import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  query: vi.fn(), count: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
  notificationFind: vi.fn(), notificationCreate: vi.fn(), dispatch: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  $transaction: db.transaction,
  platformNotification: { findMany: db.notificationFind, create: db.notificationCreate },
} }));
vi.mock("./aiops-handoff", () => ({ dispatchMcpEfficiencyAiOps: db.dispatch }));
import { compareEfficiencyIds } from "./analysis";
import { runCallEfficiencyReport } from "./report";

function ledgerRows(count: number) {
  const end = Date.now() - 1_000;
  return Array.from({ length: count }, (_, index) => ({
    id: "event-" + String(index).padStart(6, "0"),
    toolName: index === count - 1 ? "newest_failure" : "get_workroom",
    threadId: "execution-1", agentId: "agent-1", success: index !== count - 1,
    executionMode: "external-jsonrpc", durationMs: 1,
    createdAt: new Date(end - count + Math.floor(index / 3)),
    hasApiToken: true, ownerSessionId: null as string | null, errorCode: null as string | null,
  }));
}
function installRows(rows: ReturnType<typeof ledgerRows>) {
  db.count.mockImplementation(async ({ where }) => rows.filter((row) =>
    row.createdAt >= where.createdAt.gte && row.createdAt < where.createdAt.lt).length);
  db.query.mockImplementation(async (sql: TemplateStringsArray, ...values: unknown[]) => {
    if (sql.join("").includes("clock_timestamp")) return [{ snapshotEstablishedAt: new Date() }];
    const [start, end, after, afterId, take] = values.slice(-5) as [Date, Date, Date, string, number];
    return rows.filter((row) => row.createdAt >= start && row.createdAt < end &&
      (row.createdAt > after || (+row.createdAt === +after && compareEfficiencyIds(row.id, afterId) > 0)))
      .sort((a, b) => +a.createdAt - +b.createdAt || compareEfficiencyIds(a.id, b.id)).slice(0, take);
  });
}

describe("MCP efficiency report coverage (BI-4BB68EB6)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.transaction.mockImplementation(async (callback) => callback({
      $executeRaw: db.execute, $queryRaw: db.query, toolExecution: { count: db.count },
    }));
    db.notificationFind.mockResolvedValue([]);
    db.notificationCreate.mockResolvedValue({ id: "notification-1" });
    db.dispatch.mockResolvedValue({ skipped: false, backlogItemsFiled: [] });
    installRows([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("includes the newest event and ties exactly once beyond 5,000 calls", async () => {
    installRows(ledgerRows(5_001));
    const { report } = await runCallEfficiencyReport({ windowHours: 24 });
    expect(report.totalCalls).toBe(5_001);
    expect(report.topTools.find((tool) => tool.toolName === "newest_failure")?.failCount).toBe(1);
    expect(report.coverage).toMatchObject({ complete: true, includedCount: 5_001, populationCount: 5_001, pagesRead: 11 });
    expect(report.coverage.lastProcessed?.id).toBe("event-005000");
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.transaction.mock.calls[0]![1]).toMatchObject({ isolationLevel: "RepeatableRead" });
    expect(db.execute.mock.calls[0]![0].join("")).toContain("SET TRANSACTION READ ONLY");
    expect(db.query.mock.invocationCallOrder[0]).toBeLessThan(db.count.mock.invocationCallOrder[0]!);
    expect(db.count.mock.invocationCallOrder[0]).toBeLessThan(db.query.mock.invocationCallOrder[1]!);
  });

  it("does not dispatch corrective work when a diagnostic row budget omits population", async () => {
    installRows(ledgerRows(101));
    const { report, aiOps, notified } = await runCallEfficiencyReport({
      windowHours: 24, limit: 100, notify: true, dispatchAiOps: true, ownerUserId: "user-1",
    });
    expect(db.dispatch).not.toHaveBeenCalled();
    expect(aiOps).toBeNull();
    expect(notified).toBe(1);
    expect(report.ledgerSufficiency.usable).toBe(false);
    expect(report.coverage).toMatchObject({ complete: false, includedCount: 100, populationCount: 101, stopReason: "row-budget" });
    expect(report.coverage.recovery).toMatch(/new snapshot.*not a resumable/i);
    const notification = db.notificationCreate.mock.calls[0]![0].data;
    expect(notification.subjectId).toMatch(/^coverage:/);
    expect(notification.message).toMatch(/partial.*100\/101/i);
    expect(notification.message).toContain(report.coverage.requestedStart);
  });

  it("deduplicates a coverage warning without entering the finding notification loop", async () => {
    installRows(ledgerRows(101));
    db.notificationFind.mockResolvedValue([{ id: "existing-coverage" }]);
    const result = await runCallEfficiencyReport({ limit: 100, notify: true, dispatchAiOps: true, ownerUserId: "user-1" });
    expect(result.notified).toBe(0);
    expect(db.notificationCreate).not.toHaveBeenCalled();
    expect(db.dispatch).not.toHaveBeenCalled();
  });

  it("marks an empty requested range complete with explicit zero population", async () => {
    const { report } = await runCallEfficiencyReport({ windowHours: 24 });
    expect(report).toMatchObject({ totalCalls: 0, coverage: {
      complete: true, includedCount: 0, populationCount: 0, observedStart: null, observedEnd: null, lastProcessed: null,
    } });
    expect(report.coverage.requestedStart).not.toBe(report.windowStart);
    expect(report.coverage.pagesRead).toBe(0);
  });

  it("freezes a half-open interval including its start and excluding its end", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-07T00:00:00.000Z"));
    try {
      const rows = ledgerRows(3);
      rows[0]!.createdAt = new Date("2026-09-06T00:00:00.000Z");
      rows[1]!.createdAt = new Date("2026-09-06T23:59:59.999Z");
      rows[2]!.createdAt = new Date("2026-09-07T00:00:00.000Z");
      installRows(rows);
      const { report } = await runCallEfficiencyReport({ windowHours: 24, pageSize: 1 });
      expect(report.coverage).toMatchObject({ complete: true, includedCount: 2, populationCount: 2,
        requestedStart: "2026-09-06T00:00:00.000Z", requestedEnd: "2026-09-07T00:00:00.000Z" });
    } finally { vi.useRealTimers(); }
  });

  it.each([
    { maxStateEntries: 4, reason: "state-budget", included: 10 },
    { maxRetainedBytes: 0, reason: "memory-budget", included: 0 },
  ])("suppresses every corrective side effect at $reason", async ({ reason, included, ...budget }) => {
    installRows(ledgerRows(11));
    const result = await runCallEfficiencyReport({ ...budget, notify: true, dispatchAiOps: true, ownerUserId: "user-1" });
    expect(result.report.coverage).toMatchObject({ complete: false, stopReason: reason, includedCount: included });
    expect(result.report.ledgerSufficiency.usable).toBe(false);
    expect(db.dispatch).not.toHaveBeenCalled();
    expect(db.notificationCreate.mock.calls.every(([call]) => call.data.subjectId.startsWith("coverage:"))).toBe(true);
  });

  it("stops before an oversized identity can be grouped under a clipped key", async () => {
    const rows = ledgerRows(2);
    rows[1]!.toolName = "x".repeat(1025);
    installRows(rows);
    const { report } = await runCallEfficiencyReport({ dispatchAiOps: true, ownerUserId: "user-1" });
    expect(report.coverage).toMatchObject({ complete: false, stopReason: "field-budget", includedCount: 1 });
    expect(report.topTools).toHaveLength(1);
    expect(db.dispatch).not.toHaveBeenCalled();
  });

  it("labels elapsed-budget exhaustion separately from database failure", async () => {
    installRows(ledgerRows(2));
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    db.count.mockImplementation(async () => { clock.mockReturnValue(2); return 2; });
    const result = await runCallEfficiencyReport({ maxDurationMs: 1, notify: true, dispatchAiOps: true, ownerUserId: "user-1" });
    expect(result.report.coverage).toMatchObject({ complete: false, stopReason: "time-budget", includedCount: 0 });
    expect(db.dispatch).not.toHaveBeenCalled();
  });

  it("allows the existing corrective loop when a budget exactly covers the population", async () => {
    installRows(ledgerRows(100));
    const result = await runCallEfficiencyReport({ limit: 100, notify: true, dispatchAiOps: true, ownerUserId: "user-1" });
    expect(result.report.coverage.complete).toBe(true);
    expect(db.dispatch).toHaveBeenCalledOnce();
    expect(db.notificationCreate.mock.calls.some(([call]) => call.data.subjectId.startsWith("thrash:"))).toBe(true);
  });

  it("propagates a query failure without notifications or corrective work", async () => {
    db.query.mockRejectedValue(new Error("ledger unavailable"));
    await expect(runCallEfficiencyReport({ notify: true, dispatchAiOps: true, ownerUserId: "user-1" }))
      .rejects.toThrow("ledger unavailable");
    expect(db.notificationCreate).not.toHaveBeenCalled();
    expect(db.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a count/page contradiction instead of fabricating completeness", async () => {
    db.count.mockResolvedValue(1);
    await expect(runCallEfficiencyReport({ notify: true, dispatchAiOps: true, ownerUserId: "user-1" }))
      .rejects.toThrow("count/page mismatch");
    expect(db.notificationCreate).not.toHaveBeenCalled();
    expect(db.dispatch).not.toHaveBeenCalled();
  });
});
