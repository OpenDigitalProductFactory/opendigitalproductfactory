import { describe, expect, it } from "vitest";

import { capabilityNeedOriginId } from "@/lib/coworker-self-assessment/assessment-service";
import {
  capabilityNeedKey,
  evidenceFingerprint,
  improvementSignalKey,
} from "@/lib/tak/pattern-observer/fingerprint";

describe("pattern observer fingerprint helpers", () => {
  it("matches the coworker capability need origin id exactly", () => {
    const agentId = "agent-1";
    const kind = "tool";
    const need = `  Need   PUBLISH tools with a consistent playbook surface that keeps the agent from
      rediscovering the same coordination gap every time the evidence changes shape. Extra text.  `;

    expect(capabilityNeedKey(agentId, kind, need)).toBe(
      capabilityNeedOriginId(agentId, kind, need),
    );
  });

  it("returns the improvement signal source dedupe pair", () => {
    expect(improvementSignalKey("platform_issue_report", "PIR-123")).toEqual({
      sourceType: "platform_issue_report",
      sourceId: "PIR-123",
    });
  });

  it("keeps object-key-equivalent evidence payloads on the same fingerprint", () => {
    const first = evidenceFingerprint({
      agentId: "agent-1",
      routeContext: "/build-studio",
      kind: "tool",
      need: "  Needs   a governed playbook. ",
      evidence: {
        observations: [
          { message: "missing step", count: 2 },
          { count: 1, message: "manual retry" },
        ],
        source: { id: "PIR-123", type: "platform_issue_report" },
      },
    });

    const second = evidenceFingerprint({
      agentId: "agent-1",
      routeContext: "/build-studio",
      kind: "tool",
      need: "needs a governed playbook.",
      evidence: {
        source: { type: "platform_issue_report", id: "PIR-123" },
        observations: [
          { count: 2, message: "missing step" },
          { message: "manual retry", count: 1 },
        ],
      },
    });

    expect(second).toBe(first);
  });

  it("keeps ordered evidence arrays distinct", () => {
    const base = {
      agentId: "agent-1",
      routeContext: "/build-studio",
      kind: "tool",
      need: "needs a governed playbook",
    };

    expect(evidenceFingerprint({ ...base, evidence: ["start", "fail"] })).not.toBe(
      evidenceFingerprint({ ...base, evidence: ["fail", "start"] }),
    );
  });

  it("changes when the normalized need changes", () => {
    const base = {
      agentId: "agent-1",
      routeContext: "/build-studio",
      kind: "tool",
      evidence: { sourceId: "PIR-123" },
    };

    expect(evidenceFingerprint({ ...base, need: "needs a governed playbook" })).not.toBe(
      evidenceFingerprint({ ...base, need: "needs a governed runbook" }),
    );
  });

  it("rejects non-json evidence values instead of collapsing them", () => {
    expect(() =>
      evidenceFingerprint({
        agentId: "agent-1",
        kind: "tool",
        need: "needs a governed playbook",
        evidence: { observedAt: new Date("2026-06-27T00:00:00.000Z") },
      }),
    ).toThrow(/JSON-compatible/);
  });
});
