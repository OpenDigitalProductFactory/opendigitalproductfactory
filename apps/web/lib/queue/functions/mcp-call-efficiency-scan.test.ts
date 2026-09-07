import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
  report: vi.fn(), gate: vi.fn(), owner: vi.fn(),
}));
vi.mock("../inngest-client", () => ({ inngest: { createFunction: mock.createFunction } }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: mock.gate }));
vi.mock("../scheduled-owner", () => ({ resolveScheduledOwnerUserId: mock.owner }));
vi.mock("@/lib/operate/mcp-call-efficiency/report", () => ({ runCallEfficiencyReport: mock.report }));
import "./mcp-call-efficiency-scan";

const handler = mock.createFunction.mock.calls[0]![1] as (context: {
  step: { run: (name: string, fn: () => Promise<unknown>) => Promise<unknown> };
}) => Promise<unknown>;
const step = { run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()) };

describe("daily MCP efficiency coverage projection", () => {
  beforeEach(() => {
    mock.report.mockReset(); mock.gate.mockReset(); mock.owner.mockReset(); step.run.mockClear();
    mock.gate.mockResolvedValue({ proceed: true });
    mock.owner.mockResolvedValue("scheduled-owner");
  });

  it("retains incomplete coverage and does not advertise findings as actionable", async () => {
    const coverage = { complete: false, includedCount: 100, populationCount: 101, stopReason: "row-budget" };
    mock.report.mockResolvedValue({ report: {
      totalCalls: 100, findings: [], coverage, ledgerSufficiency: { usable: false },
    }, notified: 1, aiOps: null });
    expect(await handler({ step })).toMatchObject({ coverage, aiOps: null });
    expect(mock.report).toHaveBeenCalledWith({
      windowHours: 24, notify: true, dispatchAiOps: true, ownerUserId: "scheduled-owner",
    });
  });

  it("propagates database failure for the scheduler to record instead of a success receipt", async () => {
    mock.report.mockRejectedValue(new Error("snapshot query failed"));
    await expect(handler({ step })).rejects.toThrow("snapshot query failed");
  });

  it("honors the shared quiescence entry without reading or dispatching", async () => {
    mock.gate.mockResolvedValue({ proceed: false, reason: "self-upgrade" });
    expect(await handler({ step })).toEqual({ skipped: true, reason: "self-upgrade" });
    expect(mock.report).not.toHaveBeenCalled();
  });
});
