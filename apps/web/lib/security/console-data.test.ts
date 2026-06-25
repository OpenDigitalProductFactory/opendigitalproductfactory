// EP-SOVEREIGN-SOC P4 — SOC console data aggregation unit tests.
import { describe, expect, it } from "vitest";

import { computeSocConsoleData, type SocConsoleInput } from "./console-data";

function input(o: Partial<SocConsoleInput> = {}): SocConsoleInput {
  return { detections: [], cases: [], activeSourceKinds: [], allSourceKinds: [], ...o };
}

const T0 = new Date("2026-06-25T12:00:00.000Z");
const T30 = new Date("2026-06-25T12:30:00.000Z");

describe("computeSocConsoleData", () => {
  it("flags monitoring=false on an empty board (an empty board is NOT green)", () => {
    const d = computeSocConsoleData(input());
    expect(d.coverage.monitoring).toBe(false);
    expect(d.coverage.connectedSources).toBe(0);
  });

  it("computes coverage and stale sources", () => {
    const d = computeSocConsoleData(
      input({
        activeSourceKinds: ["windows.security", "syslog"],
        allSourceKinds: ["windows.security", "syslog", "aws.cloudtrail"],
      }),
    );
    expect(d.coverage.connectedSources).toBe(2);
    expect(d.coverage.staleSources).toBe(1);
    expect(d.coverage.staleSourceKinds).toEqual(["aws.cloudtrail"]);
    expect(d.coverage.monitoring).toBe(true);
  });

  it("tallies detections by severity and the open count", () => {
    const d = computeSocConsoleData(
      input({
        detections: [
          { severity: "high", status: "open" },
          { severity: "high", status: "closed" },
          { severity: "low", status: "open" },
        ],
      }),
    );
    expect(d.detections.open).toBe(2);
    expect(d.detections.total).toBe(3);
    expect(d.detections.bySeverity).toEqual({ high: 2, low: 1 });
  });

  it("computes case open/awaiting-decision/resolved + MTTR + FP rate", () => {
    const d = computeSocConsoleData(
      input({
        cases: [
          { severity: "high", status: "new", verdict: "unknown", openedAt: T0, resolvedAt: null },
          { severity: "medium", status: "resolved", verdict: "malicious", openedAt: T0, resolvedAt: T30 },
          { severity: "low", status: "closed", verdict: "false-positive", openedAt: T0, resolvedAt: T30 },
        ],
      }),
    );
    expect(d.cases.open).toBe(1); // new is an open state
    expect(d.cases.awaitingDecision).toBe(1); // new awaits triage
    expect(d.cases.resolved).toBe(2); // resolved + closed
    expect(d.metrics.mttrMinutes).toBe(30);
    expect(d.metrics.falsePositiveRate).toBe(0.5); // 1 FP of 2 verdicted
  });
});
