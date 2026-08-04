import { describe, expect, it } from "vitest";
import {
  analyzeCollaborationHealth,
  type CollaborationEdgeEvent,
} from "./analysis";
import {
  EFFICIENCY_PLANE_MAPPING,
  EFFICIENCY_SHARED_DIMENSIONS,
} from "./dimensions";

function edge(
  partial: Partial<CollaborationEdgeEvent> &
    Pick<CollaborationEdgeEvent, "id" | "edgeKind" | "fromAgentId" | "toAgentId">,
): CollaborationEdgeEvent {
  return {
    state: "completed",
    occurredAt: new Date("2026-08-04T12:00:00.000Z"),
    completedAt: new Date("2026-08-04T12:05:00.000Z"),
    orphanParent: false,
    ...partial,
  };
}

describe("analyzeCollaborationHealth (BI-3003EE63)", () => {
  it("exports shared dimensions with MCP twin plane mapping", () => {
    expect(EFFICIENCY_SHARED_DIMENSIONS).toContain("session");
    expect(EFFICIENCY_PLANE_MAPPING.mcp.plane).toBe("mcp-tool");
    expect(EFFICIENCY_PLANE_MAPPING.a2a.plane).toBe("a2a-collaboration");
  });

  it("flags failed and blocked edges", () => {
    const events: CollaborationEdgeEvent[] = [
      edge({
        id: "f1",
        edgeKind: "a2a-task-lineage",
        fromAgentId: "ceo",
        toAgentId: "eng",
        state: "failed",
      }),
      edge({
        id: "b1",
        edgeKind: "a2a-handoff",
        fromAgentId: "plan",
        toAgentId: "build",
        state: "blocked",
      }),
      edge({
        id: "ok",
        edgeKind: "a2a-delegation",
        fromAgentId: "ceo",
        toAgentId: "ops",
        state: "completed",
      }),
    ];
    // Pad to usable threshold
    for (let i = 0; i < 4; i++) {
      events.push(
        edge({
          id: `pad${i}`,
          edgeKind: "a2a-delegation",
          fromAgentId: "a",
          toAgentId: "b",
          state: "completed",
        }),
      );
    }
    const report = analyzeCollaborationHealth(events);
    expect(report.findings.some((f) => f.kind === "failed_edge")).toBe(true);
    expect(report.findings.some((f) => f.kind === "blocked_edge")).toBe(true);
    expect(report.ledgerSufficiency.usable).toBe(true);
    expect(report.plane).toBe("a2a-collaboration");
  });

  it("flags stuck active delegations", () => {
    const nowMs = Date.parse("2026-08-04T18:00:00.000Z");
    const events: CollaborationEdgeEvent[] = [
      edge({
        id: "stuck1",
        edgeKind: "a2a-delegation",
        fromAgentId: "ceo",
        toAgentId: "eng",
        state: "active",
        occurredAt: new Date("2026-08-04T10:00:00.000Z"),
        completedAt: null,
      }),
      edge({
        id: "fresh",
        edgeKind: "a2a-delegation",
        fromAgentId: "ceo",
        toAgentId: "ops",
        state: "active",
        occurredAt: new Date("2026-08-04T17:30:00.000Z"),
        completedAt: null,
      }),
      ...Array.from({ length: 4 }, (_, i) =>
        edge({
          id: `c${i}`,
          edgeKind: "a2a-handoff",
          fromAgentId: "a",
          toAgentId: "b",
          state: "completed",
        }),
      ),
    ];
    const report = analyzeCollaborationHealth(events, {
      stuckActiveMs: 4 * 60 * 60 * 1000,
      nowMs,
    });
    const stuck = report.findings.find((f) => f.kind === "stuck_active");
    expect(stuck).toBeDefined();
    expect(stuck!.evidence.count).toBe(1);
    expect(stuck!.recommendedAction).toBe("clear_stuck_delegation");
  });

  it("flags orphan lineage and pair failure rate", () => {
    const events: CollaborationEdgeEvent[] = [
      edge({
        id: "orphan1",
        edgeKind: "a2a-task-lineage",
        fromAgentId: "parent-missing",
        toAgentId: "child",
        state: "completed",
        orphanParent: true,
      }),
      ...Array.from({ length: 4 }, (_, i) =>
        edge({
          id: `pair-bad-${i}`,
          edgeKind: "a2a-handoff",
          fromAgentId: "scrum",
          toAgentId: "eng",
          state: i < 3 ? "failed" : "completed",
        }),
      ),
    ];
    const report = analyzeCollaborationHealth(events, {
      pairFailureMinSamples: 4,
      pairFailureRate: 0.5,
      minEdgesForUsable: 5,
    });
    expect(report.findings.some((f) => f.kind === "orphan_lineage")).toBe(true);
    expect(
      report.findings.find((f) => f.kind === "orphan_lineage")!.recommendedAction,
    ).toBe("fix_capture");
    expect(report.findings.some((f) => f.kind === "pair_failure_rate")).toBe(
      true,
    );
  });

  it("reports sparse capture as unusable — does not claim healthy multi-agent ops", () => {
    const report = analyzeCollaborationHealth([
      edge({
        id: "one",
        edgeKind: "a2a-delegation",
        fromAgentId: "a",
        toAgentId: "b",
        state: "completed",
      }),
    ]);
    expect(report.totalEdges).toBe(1);
    expect(report.ledgerSufficiency.usable).toBe(false);
    expect(report.ledgerSufficiency.note).toMatch(/Too few|empty capture/i);
    expect(report.findings.length).toBe(0);
  });
});
