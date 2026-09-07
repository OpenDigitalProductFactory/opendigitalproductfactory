import { beforeEach, describe, expect, it, vi } from "vitest";

const runReport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/operate/mcp-call-efficiency/report", () => ({ runCallEfficiencyReport: runReport }));
import { optimizationPack } from "./optimization-pack";

describe("MCP efficiency public coverage projection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("labels a partial population in the headline and retains its recovery packet", async () => {
    const coverage = {
      complete: false, includedCount: 100, populationCount: 101,
      requestedStart: "2026-09-06T00:00:00.000Z", requestedEnd: "2026-09-07T00:00:00.000Z",
      stopReason: "row-budget", recovery: "Narrow the requested window and restart with a new snapshot.",
    };
    runReport.mockResolvedValue({ report: {
      totalCalls: 100, successRate: 0.5, findings: [], coverage,
      ledgerSufficiency: { usable: false, note: "Incomplete requested window." },
    }, notified: 0, aiOps: null });
    const result = await optimizationPack.handlers.analyze_mcp_call_efficiency!({
      windowHours: 24, notify: true, dispatchAiOps: true,
    }, "user-1");
    expect(result.message).toMatch(/partial.*100.*101/i);
    expect(result.message).toMatch(/success.*included|included.*success/i);
    expect(result.data).toMatchObject({ coverage });
    expect(runReport).toHaveBeenCalledWith(expect.objectContaining({
      notify: true, dispatchAiOps: true, ownerUserId: "user-1",
    }));
  });

  it("does not turn a failed ledger read into a complete report", async () => {
    runReport.mockRejectedValue(new Error("snapshot query failed"));
    await expect(optimizationPack.handlers.analyze_mcp_call_efficiency!({}, "user-1"))
      .rejects.toThrow("snapshot query failed");
  });
});
