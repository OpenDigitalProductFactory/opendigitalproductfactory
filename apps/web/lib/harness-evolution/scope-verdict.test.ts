import { describe, expect, it, vi } from "vitest";

import { err, ok } from "@/lib/shared/action-result";

import { probeCandidate, type TraceCall } from "./probe";
import { decideCandidateVerdict, scopeRouteFor, type ScopeDecider } from "./scope-verdict";

// BI-B8DAEB71 (spec AC-11, AC-14..AC-17): the owning scope chooses among the
// measured options; the hard rules still veto; an unanswerable scope is a
// kernel gap, not an edit.

const T0 = new Date("2026-10-28T10:00:00Z").getTime();
let seq = 0;
const call = (threadId: string, success: boolean, errorCode: string | null = null): TraceCall => {
  seq += 1;
  return {
    id: `te-${seq}`, threadId, toolName: "record_workroom_evidence", success,
    errorCode: success ? null : errorCode, namesNextCall: false, tokens: 50, at: new Date(T0 + seq * 1000),
  };
};
function probe(gppPermitsSteer = false) {
  seq = 0;
  return probeCandidate({
    trace: [call("t1", false, "authority_denied"), call("t1", false, "authority_denied"), call("t1", true), call("t2", false, "authority_denied")],
    target: { toolName: "record_workroom_evidence", code: "authority_denied" },
    humanEvents: 0,
    gppPermitsSteer,
  });
}
const candidate = { candidateKey: "WC-1:tool:record_workroom_evidence:authority_denied", capsuleId: "WC-1", decisionScope: "wwmd" as const, missKey: "tool:record_workroom_evidence:authority_denied" };
const decider = (optionId: string | null, extra: Partial<{ confidence: string; autonomyBlockers: string[] }> = {}): ScopeDecider =>
  vi.fn().mockResolvedValue(ok({
    interactionId: "DI-1", recommendedOptionId: optionId, confidence: extra.confidence ?? "high", autonomyBlockers: extra.autonomyBlockers ?? [],
  }));

describe("scopeRouteFor", () => {
  it("routes WWMD to platform doctrine and WWWD to the organization; WSID has no route here yet", () => {
    expect(scopeRouteFor("wwmd")).toEqual({ decisionDomain: "platform-development" });
    expect(scopeRouteFor("wwwd")).toEqual({ decisionDomain: "org-business" });
    expect(scopeRouteFor("wsid")).toBeNull();
  });
});

describe("decideCandidateVerdict", () => {
  it("asks the owning scope with every option's measured features and records its decision id", async () => {
    const decide = decider("in-tool-resolution");
    const verdict = await decideCandidateVerdict({ candidate, probe: probe(), decide });
    const args = vi.mocked(decide).mock.calls[0]![0];
    expect(args.decisionDomain).toBe("platform-development");
    expect(args.options.map((o) => o.id)).toEqual(["keep-base", "in-tool-resolution", "named-next-call", "gpp-permit"]);
    expect(args.options.every((o) => Object.keys(o.features).length > 0)).toBe(true);
    expect(verdict).toMatchObject({
      verdict: "ADOPT",
      variantKey: "in-tool-resolution",
      decisionScope: "wwmd",
      decisionId: "DI-1",
      conditions: ["verify-encoded-rule-on-real-host", "adopt-through-governed-change"],
    });
    expect(verdict.deltas).toMatchObject({ human: 0, completionRate: 0.5 });
    expect(verdict.deltas.ai).toBeLessThan(0);
    expect(verdict.deltas.code).toBeGreaterThan(0);
  });

  it("keeps the base when the scope says so", async () => {
    const verdict = await decideCandidateVerdict({ candidate, probe: probe(), decide: decider("keep-base") });
    expect(verdict).toMatchObject({ verdict: "KEEP_BASE", variantKey: null, reasons: ["scope-keeps-base"] });
  });

  it("vetoes a scope pick that raises human load: never ADOPT", async () => {
    const verdict = await decideCandidateVerdict({ candidate, probe: probe(false), decide: decider("gpp-permit") });
    expect(verdict.verdict).toBe("KEEP_BASE");
    expect(verdict.reasons).toEqual(["scope-pick-vetoed", "raises-human-load"]);
  });

  it("prefers the in-tool gate over a named refusal of equal or worse outcome", async () => {
    const verdict = await decideCandidateVerdict({ candidate, probe: probe(), decide: decider("named-next-call") });
    expect(verdict).toMatchObject({ verdict: "ADOPT", variantKey: "in-tool-resolution", reasons: ["gate-preference"] });
  });

  it("turns an unanswerable scope into a kernel gap instead of an edit", async () => {
    for (const decide of [decider(null), decider("in-tool-resolution", { confidence: "low" }), decider("x", { autonomyBlockers: ["insufficient_signal"] })]) {
      const verdict = await decideCandidateVerdict({ candidate, probe: probe(), decide });
      expect(verdict).toMatchObject({ verdict: "KERNEL_GAP", variantKey: null });
      expect(verdict.kernelGap?.reason).toMatch(/insufficient|low-confidence|no-recommendation/);
    }
    const wsid = await decideCandidateVerdict({ candidate: { ...candidate, decisionScope: "wsid" }, probe: probe(), decide: decider("keep-base") });
    expect(wsid).toMatchObject({ verdict: "KERNEL_GAP", kernelGap: { reason: "scope-route-unavailable" } });
  });

  it("records a scope that could not be reached as undecided, not as a doctrine gap", async () => {
    const decide: ScopeDecider = vi.fn().mockResolvedValue(err("WWMD did not return a decision."));
    const verdict = await decideCandidateVerdict({ candidate, probe: probe(), decide });
    expect(verdict).toMatchObject({ verdict: "KEEP_BASE", decisionId: null, reasons: ["scope-unavailable"] });
  });
});
