import { describe, expect, it } from "vitest";
import {
  analyzeCallEfficiency,
  compareEfficiencyIds,
  createCallEfficiencyAccumulator,
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
    parameters: null,
    ...partial,
  };
}

describe("analyzeCallEfficiency (BI-A08EBAEC)", () => {
  it("orders tied identities like PostgreSQL C collation, including supplementary Unicode", () => {
    const ids = ["\u{10000}", "\ue000", "a", "aa", "A", "é"];
    expect(ids.sort(compareEfficiencyIds)).toEqual(["A", "a", "aa", "é", "\ue000", "\u{10000}"]);
    expect(compareEfficiencyIds("same", "same")).toBe(0);
  });

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
    expect(report.findings.some(
      (finding) => finding.kind === "thrash" && finding.toolName === "edge.heartbeat",
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

  it("uses ownerSessionId when external JSON-RPC rows have no thread attribution", () => {
    const start = Date.parse("2026-08-03T12:00:00.000Z");
    const events = Array.from({ length: 10 }, (_, i) => ev({
      id: `claim-${i}`,
      toolName: "claim_nonprod_environment_lease",
      threadId: "",
      agentId: "unknown",
      parameters: { ownerSessionId: "gate-session-a" },
      createdAt: new Date(start + i * 1_000),
    }));

    const report = analyzeCallEfficiency(events, { thrashThreshold: 8 });
    const thrash = report.findings.find((finding) => finding.kind === "thrash");
    expect(thrash?.evidence.correlationId).toBe("owner-session:gate-session-a");
  });

  it("does not turn unattributed aggregate read traffic into a polling finding", () => {
    const start = Date.parse("2026-08-03T12:00:00.000Z");
    const events = Array.from({ length: 30 }, (_, i) => ev({
      id: `read-${i}`,
      toolName: "get_backlog_item",
      threadId: "",
      agentId: "unknown",
      parameters: {},
      createdAt: new Date(start + i * 1_000),
    }));

    const report = analyzeCallEfficiency(events, { highVolumeFloor: 25 });
    expect(report.findings.some(
      (finding) => finding.kind === "high_volume" && finding.toolName === "get_backlog_item",
    )).toBe(false);
    expect(report.ledgerSufficiency.note).toContain("unattributed aggregate");
  });

  it("suppresses healthy per-session lease renewal cadence", () => {
    const start = Date.parse("2026-08-03T12:00:00.000Z");
    const events: CallEfficiencyEvent[] = [];
    for (const [session, offset] of [["gate-a", 0], ["gate-b", 5_000]] as const) {
      for (let i = 0; i < 30; i++) {
        events.push(ev({
          id: `${session}-${i}`,
          toolName: "renew_nonprod_environment_lease",
          threadId: "",
          agentId: "unknown",
          parameters: { ownerSessionId: session },
          createdAt: new Date(start + offset + i * 40_000),
        }));
      }
    }

    const report = analyzeCallEfficiency(events, { highVolumeFloor: 25 });
    expect(report.findings.some(
      (finding) => finding.kind === "high_volume"
        && finding.toolName === "renew_nonprod_environment_lease",
    )).toBe(false);
    expect(report.findings.some(
      (finding) => finding.kind === "thrash"
        && finding.toolName === "renew_nonprod_environment_lease",
    )).toBe(false);
    expect(report.ledgerSufficiency.note).toContain("contractual machine cadence");
  });

  it("reports insufficient ledger when volume is tiny", () => {
    const report = analyzeCallEfficiency([
      ev({ id: "a", toolName: "ping" }),
    ]);
    expect(report.ledgerSufficiency.usable).toBe(false);
  });
});

describe("bounded ordered efficiency accumulation", () => {
  it("keeps aggregate state bounded as one execution grows beyond 5,000 calls", () => {
    const accumulator = createCallEfficiencyAccumulator({ maxStateEntries: 20 });
    for (let i = 0; i < 10_001; i++) {
      expect(accumulator.push(ev({
        id: String(i).padStart(6, "0"), toolName: "get_workroom",
        createdAt: new Date(1_000 + i), success: i !== 10_000,
      }))).toBe(true);
    }
    expect(accumulator.stats.stateEntries).toBe(4);
    expect(accumulator.finish()).toMatchObject({ totalCalls: 10_001 });
    expect(accumulator.finish().topTools[0]?.failCount).toBe(1);
  });

  it("stops atomically before a new key exceeds the state budget", () => {
    const accumulator = createCallEfficiencyAccumulator({ maxStateEntries: 4 });
    expect(accumulator.push(ev({ id: "a", toolName: "get_workroom" }))).toBe(true);
    expect(accumulator.push(ev({ id: "b", toolName: "new_tool" }))).toBe(false);
    expect(accumulator.stats).toMatchObject({ stateEntries: 4, includedCount: 1, stopReason: "state-budget" });
    expect(accumulator.finish().topTools.map((tool) => tool.toolName)).toEqual(["get_workroom"]);
    // Once partial, a subsequent known key cannot make the missing row disappear.
    expect(accumulator.push(ev({ id: "c", toolName: "get_workroom" }))).toBe(false);
  });

  it("rejects an out-of-order page instead of publishing misleading adjacency", () => {
    const accumulator = createCallEfficiencyAccumulator();
    accumulator.push(ev({ id: "b", toolName: "get_workroom" }));
    expect(() => accumulator.push(ev({ id: "a", toolName: "get_workroom" }))).toThrow(/order/i);
  });

  it("preserves reports when retry and cadence groups cross page boundaries", () => {
    const events = Array.from({ length: 80 }, (_, i) => ev({
      id: String(i).padStart(3, "0"),
      toolName: i % 3 ? "get_workroom" : "edge.heartbeat",
      threadId: i % 3 ? "thread-a" : "", agentId: i % 3 ? "agent-1" : "edge-a",
      success: i % 5 !== 0, governedRefusal: i % 10 === 0,
      createdAt: new Date(1_000 + i * 30_000),
    }));
    const accumulator = createCallEfficiencyAccumulator();
    for (let offset = 0; offset < events.length; offset += 7) {
      for (const event of events.slice(offset, offset + 7)) accumulator.push(event);
    }
    expect(accumulator.finish()).toEqual(analyzeCallEfficiency([...events].reverse()));
  });
});

// A governed refusal is not a tool failure. ToolExecution.success is false for
// both a broken tool and a gate correctly saying no, and counting them together
// filed `fix_instructions` findings against working gates. Measured live over
// seven days: ~4,900 of ~5,700 failures were governed refusals.
describe("governed refusals are not tool failures", () => {
  it("retains distinct headline, surface and answerable-call denominators", () => {
    const events = [
      ev({ id: "a", toolName: "gate", success: false, governedRefusal: true }),
      ev({ id: "b", toolName: "gate", success: false }),
      ev({ id: "c", toolName: "gate", success: true, durationMs: null }),
    ];
    const report = analyzeCallEfficiency(events);
    expect(report.successRate).toBe(1 / 3);
    expect(report.bySurface).toEqual([
      { surface: "external-pat:external-jsonrpc", count: 3, failCount: 2 },
    ]);
    expect(report.topTools[0]).toEqual({
      toolName: "gate", count: 3, refusalCount: 1, failCount: 1,
      successRate: 1 / 2, avgDurationMs: 50,
    });
  });

  it("does not join retries across an intervening tool in the same execution", () => {
    const events = Array.from({ length: 8 }, (_, i) => ev({
      id: String(i).padStart(2, "0"),
      toolName: i % 2 ? "read_context" : "some_gate",
      success: i % 2 === 1,
      governedRefusal: i % 2 === 0,
      createdAt: new Date(1_000 + i),
    }));
    expect(analyzeCallEfficiency(events).findings.filter(
      (finding) => finding.kind === "retry_storm",
    )).toEqual([]);
  });

  it("makes tied timestamps deterministic by identity regardless of input order", () => {
    const events = Array.from({ length: 8 }, (_, i) => ev({
      id: String(i).padStart(2, "0"), toolName: "some_gate", success: i % 2 === 1,
    }));
    expect(analyzeCallEfficiency([...events].reverse())).toEqual(analyzeCallEfficiency(events));
  });

  it("does not raise high_failure for a gate that declines most calls", () => {
    // The live shape: record_plan_backlog_coverage at 91% "failure", every one a
    // readiness refusal. The tool is working; the work was not ready.
    const events = Array.from({ length: 40 }, (_, i) =>
      ev({
        id: `r-${i}`,
        toolName: "record_plan_backlog_coverage",
        success: false,
        governedRefusal: true,
        createdAt: new Date(`2026-08-03T12:${String(i).padStart(2, "0")}:00.000Z`),
      }),
    );

    const report = analyzeCallEfficiency(events);

    expect(report.findings.filter((f) => f.kind === "high_failure")).toEqual([]);
    const tool = report.topTools.find((t) => t.toolName === "record_plan_backlog_coverage");
    expect(tool?.refusalCount).toBe(40);
    expect(tool?.failCount).toBe(0);
    // Nothing answerable failed, so the tool reads as reliable rather than 9%.
    expect(tool?.successRate).toBe(1);
  });

  it("still raises high_failure for real faults mixed in with refusals", () => {
    // The guard must not become a blanket excuse: refusals are excluded from the
    // denominator, so genuine faults show a HIGHER rate, not a hidden one.
    const events = [
      ...Array.from({ length: 30 }, (_, i) =>
        ev({ id: `ref-${i}`, toolName: "some_gate", success: false, governedRefusal: true })),
      ...Array.from({ length: 8 }, (_, i) =>
        ev({ id: `bad-${i}`, toolName: "some_gate", success: false })),
      ...Array.from({ length: 2 }, (_, i) =>
        ev({ id: `ok-${i}`, toolName: "some_gate", success: true })),
    ];

    const report = analyzeCallEfficiency(events);
    const finding = report.findings.find((f) => f.kind === "high_failure");

    expect(finding).toBeDefined();
    // 8 failures out of 10 answerable calls, not 38 out of 40.
    expect(finding?.title).toContain("80%");
    expect(finding?.detail).toContain("8/10 answerable calls failed");
    expect(finding?.detail).toContain("30 further call(s) were governed refusals");
  });

  it("an unknown error code is still counted as a failure", () => {
    // The classification is deliberately conservative — a gap in the refusal list
    // must never silently excuse a broken tool.
    const events = Array.from({ length: 12 }, (_, i) =>
      ev({ id: `u-${i}`, toolName: "mystery_tool", success: false }));

    const report = analyzeCallEfficiency(events);

    expect(report.findings.some((f) => f.kind === "high_failure")).toBe(true);
    expect(report.topTools.find((t) => t.toolName === "mystery_tool")?.failCount).toBe(12);
  });

  it("names the caller's loop when a retry storm is retrying refusals", () => {
    // The live case: 4,504 gate_evidence_blocked refusals re-claimed in one day,
    // filed as "Fix tool errors or agent instructions" — which would have sent
    // someone to rewrite guidance for a tool that was behaving correctly.
    const events = Array.from({ length: 30 }, (_, i) =>
      ev({
        id: `s-${i}`,
        toolName: "claim_nonprod_environment_lease",
        success: false,
        governedRefusal: true,
        createdAt: new Date(Date.parse("2026-08-03T12:00:00.000Z") + i * 1000),
      }),
    );

    const report = analyzeCallEfficiency(events);
    const storm = report.findings.find((f) => f.kind === "retry_storm");

    expect(storm).toBeDefined();
    expect(storm?.detail).toContain("GOVERNED REFUSAL");
    expect(storm?.detail).toContain("Fix the caller's retry loop");
    expect(storm?.detail).not.toContain("Fix tool errors or agent instructions");
  });
});
