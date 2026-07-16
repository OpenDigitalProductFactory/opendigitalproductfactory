import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RawLogLine } from "@/lib/observability/log-signature";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  createPIR: vi.fn(),
  accruePIR: vi.fn(),
  queryLoki: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformIssueReport: { findFirst: mocks.findFirst },
  },
}));

vi.mock("@/lib/quality/platform-issue-reports", () => ({
  createPlatformIssueReport: mocks.createPIR,
  accrueIssueReportOccurrence: mocks.accruePIR,
}));

vi.mock("@/lib/observability/loki-query", () => ({
  queryLokiErrorLines: mocks.queryLoki,
}));

import { runLogSignatureScan } from "./log-signature-scanner";

function errLines(service: string, msg: string, n: number): RawLogLine[] {
  return Array.from({ length: n }, (_, i) => ({ service, line: `Error: ${msg} ${i}`, tsMs: 1000 + i }));
}

describe("runLogSignatureScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null); // nothing filed yet by default
    mocks.createPIR.mockResolvedValue({ reportId: "PIR-TEST" });
  });

  it("files one PIR per novel signature, with a stable dedupeKey", async () => {
    mocks.queryLoki.mockResolvedValue([
      ...errLines("portal", "db timeout", 3),
      ...errLines("inngest", "worker crashed", 5),
    ]);

    const res = await runLogSignatureScan({ lookbackMinutes: 20 });

    expect(res.reportsCreated).toBe(2);
    expect(res.skippedExisting).toBe(0);
    expect(mocks.createPIR).toHaveBeenCalledTimes(2);
    for (const call of mocks.createPIR.mock.calls) {
      const arg = call[0];
      expect(arg.type).toBe("log_signature");
      expect(arg.source).toBe("log-signature-scanner");
      expect(arg.dedupeKey).toMatch(/^log-sig:(portal|inngest):[0-9a-f]{10}$/);
    }
  });

  it("does NOT re-file a signature that already has an unresolved report — accrues instead", async () => {
    mocks.queryLoki.mockResolvedValue(errLines("portal", "db timeout", 3));
    mocks.findFirst.mockResolvedValue({ id: "existing" }); // already filed + open

    const res = await runLogSignatureScan();

    expect(res.reportsCreated).toBe(0);
    expect(res.skippedExisting).toBe(1);
    expect(mocks.createPIR).not.toHaveBeenCalled();
    // BI-51F6A428: a recurrence accrues onto the open report so a staged signal
    // advances toward its promotion bar instead of being silently swallowed.
    expect(mocks.accruePIR).toHaveBeenCalledWith("existing");
  });

  it("treats a P2002 race as skipped, not a crash", async () => {
    mocks.queryLoki.mockResolvedValue(errLines("portal", "db timeout", 3));
    mocks.findFirst.mockResolvedValue(null);
    mocks.createPIR.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const res = await runLogSignatureScan();

    expect(res.reportsCreated).toBe(0);
    expect(res.skippedExisting).toBe(1);
  });

  it("returns lokiUnreachable without filing when Loki is down", async () => {
    mocks.queryLoki.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await runLogSignatureScan();

    expect(res.lokiUnreachable).toBe(true);
    expect(res.reportsCreated).toBe(0);
    expect(mocks.createPIR).not.toHaveBeenCalled();
  });

  it("queries the unresolved-status filter for idempotency", async () => {
    mocks.queryLoki.mockResolvedValue(errLines("portal", "db timeout", 1));
    await runLogSignatureScan();
    const where = mocks.findFirst.mock.calls[0][0].where;
    expect(where.dedupeKey).toMatch(/^log-sig:portal:/);
    expect(where.status.notIn).toContain("resolved_locally");
  });
});
