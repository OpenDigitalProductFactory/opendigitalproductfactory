import { describe, it, expect } from "vitest";
import {
  decideDelegation,
  renderDelegationGuidance,
  MAX_DELEGATION_DEPTH,
  type DelegationSignals,
} from "./delegation-policy";

function signals(over: Partial<DelegationSignals> = {}): DelegationSignals {
  return {
    effortLevel: "medium",
    hitlTier: 3, // autonomous
    capabilityGap: false,
    decomposable: false,
    delegationDepth: 0,
    ...over,
  };
}

describe("decideDelegation", () => {
  it("handles a routine in-capability task inline", () => {
    expect(decideDelegation(signals()).mode).toBe("inline");
    expect(decideDelegation(signals({ effortLevel: "low" })).mode).toBe("inline");
  });

  it("escalates high-altitude work under tight human oversight (HITL ≤ 1)", () => {
    expect(decideDelegation(signals({ effortLevel: "high", hitlTier: 1 })).mode).toBe("escalate");
    expect(decideDelegation(signals({ effortLevel: "high", hitlTier: 0 })).mode).toBe("escalate");
    // Loose oversight → not escalated on altitude alone.
    expect(decideDelegation(signals({ effortLevel: "high", hitlTier: 3 })).mode).not.toBe("escalate");
  });

  it("requests a peer when the task needs a capability the agent lacks", () => {
    expect(decideDelegation(signals({ capabilityGap: true })).mode).toBe("request_coworker");
    // Capability gap outranks fan-out.
    expect(
      decideDelegation(signals({ capabilityGap: true, effortLevel: "high", decomposable: true })).mode,
    ).toBe("request_coworker");
  });

  it("fans out a high-effort decomposable task", () => {
    expect(decideDelegation(signals({ effortLevel: "high", decomposable: true })).mode).toBe("fan_out");
    // Not decomposable → stays inline (no gap, loose oversight).
    expect(decideDelegation(signals({ effortLevel: "high", decomposable: false })).mode).toBe("inline");
  });

  it("escalation outranks a capability gap and fan-out", () => {
    const d = decideDelegation(
      signals({ effortLevel: "high", hitlTier: 1, capabilityGap: true, decomposable: true }),
    );
    expect(d.mode).toBe("escalate");
  });

  it("stops delegating at the depth cap — handles inline", () => {
    const d = decideDelegation(
      signals({ capabilityGap: true, delegationDepth: MAX_DELEGATION_DEPTH }),
    );
    expect(d.mode).toBe("inline");
    expect(d.reason).toMatch(/depth/i);
  });
});

describe("renderDelegationGuidance", () => {
  it("returns null for inline (no hint — just do the work)", () => {
    expect(renderDelegationGuidance({ mode: "inline", reason: "x" })).toBeNull();
  });

  it("names the recommended mode, the reason, and the primitive to use", () => {
    const g = renderDelegationGuidance({ mode: "request_coworker", reason: "needs crm access" })!;
    expect(g).toContain("request_coworker");
    expect(g).toContain("needs crm access");
    expect(g).toContain("request_coworker`"); // the primitive name in backticks
  });

  it("points escalate at a human and fan_out at spawn_work_thread", () => {
    expect(renderDelegationGuidance({ mode: "escalate", reason: "r" })!).toMatch(/human/i);
    expect(renderDelegationGuidance({ mode: "fan_out", reason: "r" })!).toContain("spawn_work_thread");
  });
});

describe("alignment delegation policy", () => {
  it("treats specialist qualification as evidence rather than action permission", async () => {
    const { decideAlignmentDelegation } = await import("./alignment-specialist-delegation");
    expect(decideAlignmentDelegation({ product: "support", motion: "partner" })).toEqual([
      expect.objectContaining({ corpus: "portfolio", permissionGranted: false }),
      expect.objectContaining({ corpus: "gtm", permissionGranted: false }),
    ]);
  });
});
