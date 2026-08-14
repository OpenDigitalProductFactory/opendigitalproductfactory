import { describe, expect, it } from "vitest";
import {
  analyzeCallEfficiency,
  type CallEfficiencyEvent,
} from "./analysis";

function ev(
  partial: Partial<CallEfficiencyEvent> & Pick<CallEfficiencyEvent, "id" | "toolName">,
): CallEfficiencyEvent {
  return {
    threadId: "th-1",
    agentId: "agent-1",
    userId: "user-1",
    success: true,
    executionMode: "external-jsonrpc",
    durationMs: 50,
    createdAt: new Date("2026-08-03T12:00:00.000Z"),
    routeContext: null,
    apiTokenId: "tok-1",
    skillId: null,
    ...partial,
  };
}

describe("analyzeCallEfficiency (BI-A08EBAEC)", () => {
  it("flags thrash when the same tool dominates one thread", () => {
    const events: CallEfficiencyEvent[] = Array.from({ length: 12 }, (_, i) =>
      ev({
        id: `e${i}`,
        toolName: "get_backlog_item",
        createdAt: new Date(Date.parse("2026-08-03T12:00:00.000Z") + i * 1000),
      }),
    );
    const report = analyzeCallEfficiency(events, { thrashThreshold: 8 });
    expect(report.totalCalls).toBe(12);
    expect(report.findings.some((f) => f.kind === "thrash")).toBe(true);
    const thrash = report.findings.find((f) => f.kind === "thrash")!;
    expect(thrash.recommendedAction).toMatch(/skill|webhook|investigate|merge/);
    expect(thrash.wasteCallEstimate).toBeGreaterThan(0);
  });

  it("flags retry_storm on fail→same-tool pairs", () => {
    const events: CallEfficiencyEvent[] = [];
    for (let i = 0; i < 4; i++) {
      const t0 = Date.parse("2026-08-03T12:00:00.000Z") + i * 10_000;
      events.push(
        ev({
          id: `fail${i}`,
          toolName: "create_backlog_item",
          success: false,
          createdAt: new Date(t0),
        }),
        ev({
          id: `retry${i}`,
          toolName: "create_backlog_item",
          success: true,
          createdAt: new Date(t0 + 500),
        }),
      );
    }
    const report = analyzeCallEfficiency(events, { retryStormMin: 3 });
    expect(report.findings.some((f) => f.kind === "retry_storm")).toBe(true);
    expect(
      report.findings.find((f) => f.kind === "retry_storm")!.recommendedAction,
    ).toBe("fix_instructions");
  });

  it("flags high_volume and high_failure", () => {
    const events: CallEfficiencyEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(
        ev({
          id: `v${i}`,
          toolName: "list_backlog_items",
          success: i % 2 === 0,
          apiTokenId: null,
          executionMode: "agentic-loop",
          createdAt: new Date(Date.parse("2026-08-03T12:00:00.000Z") + i * 100),
        }),
      );
    }
    const report = analyzeCallEfficiency(events, {
      highVolumeFloor: 25,
      highFailureMinSamples: 8,
      highFailureRate: 0.3,
    });
    expect(report.findings.some((f) => f.kind === "high_volume")).toBe(true);
    expect(report.findings.some((f) => f.kind === "high_failure")).toBe(true);
    expect(report.bySurface.some((s) => s.surface === "agentic-loop")).toBe(true);
    expect(report.ledgerSufficiency.usable).toBe(true);
  });

  it("suppresses healthy contractual edge cadence across machine principals", () => {
    const start = Date.parse("2026-08-03T12:00:00.000Z");
    const events: CallEfficiencyEvent[] = [];
    for (const [agentId, offset] of [["edge-a", 0], ["edge-b", 5_000]] as const) {
      for (let i = 0; i < 30; i++) {
        events.push(ev({
          id: `${agentId}-${i}`,
          toolName: "edge.heartbeat",
          threadId: "",
          agentId,
          apiTokenId: null,
          executionMode: "edge-rest",
          createdAt: new Date(start + offset + i * 60_000),
        }));
      }
    }

    const report = analyzeCallEfficiency(events, { highVolumeFloor: 25 });
    expect(report.findings.some(
      (finding) => finding.kind === "high_volume" && finding.toolName === "edge.heartbeat",
    )).toBe(false);
    expect(report.ledgerSufficiency.note).toContain("contractual machine cadence");
  });

  it("still flags a machine route that exceeds its contractual cadence", () => {
    const start = Date.parse("2026-08-03T12:00:00.000Z");
    const events = Array.from({ length: 30 }, (_, i) => ev({
      id: `edge-fast-${i}`,
      toolName: "edge.heartbeat",
      threadId: "",
      agentId: "edge-a",
      apiTokenId: null,
      executionMode: "edge-rest",
      createdAt: new Date(start + i * 10_000),
    }));

    const report = analyzeCallEfficiency(events, { highVolumeFloor: 25 });
    expect(report.findings.some(
      (finding) => finding.kind === "high_volume" && finding.toolName === "edge.heartbeat",
    )).toBe(true);
  });

  it("reports insufficient ledger when volume is tiny", () => {
    const report = analyzeCallEfficiency([
      ev({ id: "a", toolName: "ping" }),
    ]);
    expect(report.ledgerSufficiency.usable).toBe(false);
  });
});
