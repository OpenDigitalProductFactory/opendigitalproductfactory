import { describe, expect, it } from "vitest";

import {
  buildScopeOptions,
  judgeVariant,
  measureTrace,
  probeCandidate,
  refusalNamesNextCall,
  type TraceCall,
} from "./probe";

// BI-B8DAEB71 (slice 2; spec AC-6, AC-14..AC-16): a candidate is replayed
// baseline-versus-variant on the room's recorded trace, on three axes —
// outcome, load per rung, gate burden — and no variant that raises human load
// can pass.

const T0 = new Date("2026-10-28T10:00:00Z").getTime();
let seq = 0;
function call(threadId: string, success: boolean, errorCode: string | null = null, opts: Partial<TraceCall> = {}): TraceCall {
  seq += 1;
  return {
    id: `te-${seq}`,
    threadId,
    toolName: "record_workroom_evidence",
    success,
    errorCode: success ? null : errorCode,
    namesNextCall: false,
    tokens: 100,
    at: new Date(T0 + seq * 1000),
    ...opts,
  };
}

const TARGET = { toolName: "record_workroom_evidence", code: "authority_denied" };

describe("refusalNamesNextCall", () => {
  it("counts a structured next action or a named other tool, not the tool's own name", () => {
    expect(refusalNamesNextCall({ toolName: "a_tool", data: { nextAction: "x" }, message: null })).toBe(true);
    expect(refusalNamesNextCall({ toolName: "a_tool", data: { recovery: {} }, message: null })).toBe(true);
    expect(refusalNamesNextCall({ toolName: "a_tool", data: null, message: "call heartbeat_workroom first" })).toBe(true);
    expect(refusalNamesNextCall({ toolName: "record_workroom_evidence", data: null, message: "record_workroom_evidence rejected: withheld." })).toBe(false);
  });
});

describe("measureTrace", () => {
  it("groups calls into intents per thread and counts the three axes", () => {
    seq = 0;
    const trace = [
      call("t1", false, "authority_denied"), call("t1", false, "authority_denied"), call("t1", true),
      call("t2", false, "authority_denied"),
      call("t3", true),
    ];
    expect(measureTrace(trace, TARGET, { humanEvents: 2 })).toEqual({
      outcome: { intents: 3, completed: 2, completionRate: 2 / 3 },
      load: { human: 2, ai: 5, code: 0, tokens: 500 },
      gate: { refusals: 3, successes: 2, refusalsPerSuccess: 1.5, recoveryTurns: 2, namedNextCallShare: 0 },
    });
  });

  it("counts approval cards routed to a person as human load", () => {
    seq = 0;
    const m = measureTrace([call("t1", false, "approval_required"), call("t1", true)], { ...TARGET, code: "approval_required" }, { humanEvents: 0 });
    expect(m.load.human).toBe(1);
  });
});

describe("judgeVariant", () => {
  const base = {
    outcome: { intents: 2, completed: 1, completionRate: 0.5 },
    load: { human: 1, ai: 6, code: 0, tokens: 600 },
    gate: { refusals: 4, successes: 1, refusalsPerSuccess: 4, recoveryTurns: 4, namedNextCallShare: 0 },
  };
  it("never passes a variant that raises human load, whatever the outcome", () => {
    const v = { ...base, outcome: { intents: 2, completed: 2, completionRate: 1 }, load: { ...base.load, human: 2 } };
    expect(judgeVariant(base, v)).toEqual({ pass: false, reasons: ["raises-human-load"] });
  });
  it("rejects lower outcome, rising refusals without gain, and no movement down the ladder", () => {
    expect(judgeVariant(base, { ...base, outcome: { ...base.outcome, completed: 0, completionRate: 0 } }).reasons).toContain("lowers-outcome");
    expect(judgeVariant(base, { ...base, gate: { ...base.gate, refusalsPerSuccess: 6 } }).reasons).toContain("raises-gate-burden-without-gain");
    expect(judgeVariant(base, base)).toEqual({ pass: false, reasons: ["no-gain"] });
  });
  it("passes a variant that moves AI load into code without hurting the outcome", () => {
    expect(judgeVariant(base, { ...base, load: { human: 1, ai: 2, code: 4, tokens: 200 } })).toEqual({ pass: true, reasons: [] });
  });
});

describe("probeCandidate", () => {
  const makeTrace = () => {
    seq = 0;
    return [
      call("t1", false, "authority_denied"), call("t1", false, "authority_denied"), call("t1", true),
      call("t2", false, "authority_denied"), call("t2", false, "authority_denied"),
    ];
  };

  it("replays every variant on the same trace with one pair key, permit-gap codes included", () => {
    const probe = probeCandidate({ trace: makeTrace(), target: TARGET, humanEvents: 0, gppPermitsSteer: false });
    expect(probe.variants.map((v) => v.variantKey)).toEqual(["in-tool-resolution", "named-next-call", "gpp-permit"]);
    expect(new Set(probe.variants.map((v) => v.pairKey))).toEqual(new Set([probe.baseline.pairKey]));
    expect(probe.replays).toBe(4);
    // Fixtures without an executor count as unknown; live traces carry claude / codex / build-studio / coworker.
    expect(probe.executors).toEqual({ unknown: 4 });
  });

  it("moves resolved refusals into code units for an in-tool resolution, and demands a real-host check", () => {
    const probe = probeCandidate({ trace: makeTrace(), target: TARGET, humanEvents: 0, gppPermitsSteer: false });
    const inTool = probe.variants.find((v) => v.variantKey === "in-tool-resolution")!;
    expect(inTool.assessment.load).toEqual({ human: 0, ai: 2, code: 4, tokens: 200 });
    expect(inTool.assessment.outcome.completionRate).toBe(1);
    expect(inTool.assessment.gate.refusals).toBe(0);
    expect(inTool.encodedRuleCheck).toBe("required-on-real-host");
    expect(inTool.judgement.pass).toBe(true);
  });

  it("shows a permit grant raising human load while GPP permits are minted by approval", () => {
    const probe = probeCandidate({ trace: makeTrace(), target: TARGET, humanEvents: 0, gppPermitsSteer: false });
    const permit = probe.variants.find((v) => v.variantKey === "gpp-permit")!;
    expect(permit.assessment.load.human).toBe(2);
    expect(permit.judgement).toEqual({ pass: false, reasons: ["raises-human-load"] });
    const steering = probeCandidate({ trace: makeTrace(), target: TARGET, humanEvents: 0, gppPermitsSteer: true });
    expect(steering.variants.find((v) => v.variantKey === "gpp-permit")!.assessment.load.human).toBe(0);
  });

  it("offers no permit variant for a refusal that is not a permit gap", () => {
    seq = 0;
    const probe = probeCandidate({
      trace: [call("t1", false, "scope_conflict", { toolName: "claim_workroom_scope" }), call("t1", true, null, { toolName: "claim_workroom_scope" })],
      target: { toolName: "claim_workroom_scope", code: "scope_conflict" },
      humanEvents: 0,
      gppPermitsSteer: false,
    });
    expect(probe.variants.map((v) => v.variantKey)).toEqual(["in-tool-resolution", "named-next-call"]);
  });
});

describe("buildScopeOptions", () => {
  it("scores KEEP_BASE and every variant on measured features, costs high-is-worse", () => {
    seq = 0;
    const probe = probeCandidate({
      trace: [call("t1", false, "authority_denied"), call("t1", true)],
      target: TARGET,
      humanEvents: 0,
      gppPermitsSteer: false,
    });
    const options = buildScopeOptions(probe);
    expect(options.map((o) => o.id)).toEqual(["keep-base", "in-tool-resolution", "named-next-call", "gpp-permit"]);
    for (const option of options) {
      expect(Object.keys(option.features).sort()).toEqual(
        ["evidence_density", "human_cognitive_load", "operator_effort", "reversibility", "speed_to_value"],
      );
      for (const value of Object.values(option.features)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    const inTool = options.find((o) => o.id === "in-tool-resolution")!;
    const keep = options.find((o) => o.id === "keep-base")!;
    expect(inTool.features.operator_effort).toBeLessThan(keep.features.operator_effort);
    expect(options.find((o) => o.id === "gpp-permit")!.features.human_cognitive_load).toBeGreaterThan(keep.features.human_cognitive_load);
  });
});
