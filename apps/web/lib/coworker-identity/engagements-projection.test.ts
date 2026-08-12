// apps/web/lib/coworker-identity/engagements-projection.test.ts
// Unit tests for the pure engager aggregator (EP-COWORKER-IDENTITY-360 Phase 1).
import { describe, it, expect } from "vitest";

import { aggregateEngagers, type EngagerEvent } from "./engagements-projection";

const NOW = new Date("2026-08-07T12:00:00.000Z");
function hoursAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 3_600_000);
}

describe("aggregateEngagers", () => {
  it("collapses repeat touches from one counterparty into a single row with a count", () => {
    const events: EngagerEvent[] = [
      { kind: "person", id: "u1", label: "Mark", how: "Engaged directly", status: "requested", at: hoursAgo(2) },
      { kind: "person", id: "u1", label: "Mark", how: "Engaged directly", status: "completed", at: hoursAgo(30) },
      { kind: "person", id: "u1", label: "Mark", how: "Engaged directly", status: "completed", at: hoursAgo(50) },
    ];
    const { engagers, totals } = aggregateEngagers(events);
    expect(engagers).toHaveLength(1);
    expect(engagers[0].count).toBe(3);
    // most-recent touch (2h ago) drives status/tone
    expect(engagers[0].status).toBe("requested");
    expect(engagers[0].tone).toBe("open");
    expect(totals).toMatchObject({ total: 1, people: 1, agents: 0, open: 1 });
  });

  it("separates people from agents and counts both", () => {
    const events: EngagerEvent[] = [
      { kind: "person", id: "u1", label: "Mark", how: "Engaged directly", status: "completed", at: hoursAgo(2) },
      { kind: "agent", id: "AGT-ORCH-000", label: "COO", how: "A2A engagement", status: "accepted", at: hoursAgo(1) },
      { kind: "agent", id: "AGT-WS-REVIEW", label: "Change Reviewer", how: "A2A engagement", status: "completed", at: hoursAgo(5) },
    ];
    const { totals } = aggregateEngagers(events);
    expect(totals.people).toBe(1);
    expect(totals.agents).toBe(2);
    expect(totals.total).toBe(3);
    expect(totals.open).toBe(1); // only the accepted agent touch is open
  });

  it("sorts engagers by most-recent touch, descending", () => {
    const events: EngagerEvent[] = [
      { kind: "person", id: "u1", label: "Older", how: "x", status: "completed", at: hoursAgo(40) },
      { kind: "agent", id: "AGT-1", label: "Newer", how: "x", status: "completed", at: hoursAgo(1) },
    ];
    const { engagers } = aggregateEngagers(events);
    expect(engagers[0].label).toBe("Newer");
    expect(engagers[1].label).toBe("Older");
  });

  it("caps the returned list but counts all in totals", () => {
    const events: EngagerEvent[] = Array.from({ length: 12 }, (_, i) => ({
      kind: "person" as const,
      id: `u${i}`,
      label: `User ${i}`,
      how: "Engaged directly",
      status: "completed",
      at: hoursAgo(i + 1),
    }));
    const { engagers, totals } = aggregateEngagers(events, { maxEngagers: 5 });
    expect(engagers).toHaveLength(5);
    expect(totals.total).toBe(12);
  });
});
