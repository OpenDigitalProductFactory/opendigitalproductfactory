import { describe, expect, it, vi } from "vitest";
import {
  BLOCKER_CLASSES,
  classifyOwnerAttentionBlocker,
  decideOwnerAttentionRoute,
  featuresForBlocker,
  fileOwnerAttentionRoute,
  readScopeConsultResult,
  routeToHuman,
  ROUTED_REPAIR_REPORT_TYPE,
  type OwnerAttentionInput,
  type ScopeConsult,
  type ScopeConsultResult,
} from "./route-to-human";

// The recorded case (live PlatformIssueReport PIR-QGQUH, 2026-11): a build that
// spent its two repair rounds on a Prose Lint Guard failure and was sent to the
// owner. Nothing about it is damaging.
const PIR_QGQUH: OwnerAttentionInput = {
  producer: "build-stall",
  subject: { kind: "build", id: "FB-E91802DE" },
  blockingFacts: ["[important] Guard still failing after 2 repair attempt(s): Prose Lint Guard"],
  declarations: { riskTier: "high" },
};

// What WWMD returned for the PIR-QGQUH feature vector (DI-007A5617C3EE).
const decisive = (optionId: string): ScopeConsultResult => ({
  recommendation: { optionId, confidence: "high" },
  autonomyEligible: true,
  commandmentConflict: false,
  interactionId: "DI-TEST",
});

function consultReturning(result: ScopeConsultResult): ScopeConsult & ReturnType<typeof vi.fn> {
  return vi.fn(async () => result) as never;
}

describe("classifyOwnerAttentionBlocker", () => {
  it.each([
    ["[important] Guard still failing after 2 repair attempt(s): Prose Lint Guard", "guard-failure"],
    ["true-merge-conflict", "merge-conflict"],
    ["Refresh onto upstream main still conflicts after 2 repair attempt(s)", "stale-base"],
    ["stale-update-budget-exhausted", "stale-base"],
    ["The build reached review without any committed change, so there is nothing to verify", "empty-change"],
    ["The coding agent's repair of the pull request's failing checks changed nothing", "empty-change"],
    ["Unmitigated risk still open after 2 repair attempt(s): schema drift", "unmitigated-risk"],
    ["Review finding still open after 2 repair attempt(s)", "review-finding"],
    ["observation-budget-exhausted", "observation-budget"],
    ["something nobody has seen before", "other"],
  ])("classifies %j as %s", (fact, expected) => {
    expect(classifyOwnerAttentionBlocker([fact])).toBe(expected);
  });
});

describe("featuresForBlocker: the fixed extraction that makes the consult decisive", () => {
  it.each(BLOCKER_CLASSES)("gives %s three options, each with the same ten axes in range", (blocker) => {
    const options = featuresForBlocker(blocker);
    expect(options.map((o) => o.id)).toEqual(["resume", "route-to-agent", "escalate"]);
    const axes = Object.keys(options[0].features).sort();
    expect(axes).toHaveLength(10);
    for (const option of options) {
      expect(Object.keys(option.features).sort()).toEqual(axes);
      for (const value of Object.values(option.features)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is fixed: the same class always yields the same vector", () => {
    expect(featuresForBlocker("guard-failure")).toEqual(featuresForBlocker("guard-failure"));
  });

  it("carries the vector WWMD scored as route-to-agent for PIR-QGQUH", () => {
    const agent = featuresForBlocker("guard-failure").find((o) => o.id === "route-to-agent")!;
    expect(agent.features).toMatchObject({ speed_to_value: 0.8, governance_compliance: 0.9, operator_effort: 0.1 });
  });
});

describe("decideOwnerAttentionRoute", () => {
  it("routes PIR-QGQUH (Prose Lint Guard failure) to an agent, not the owner", async () => {
    const consult = consultReturning(decisive("route-to-agent"));
    const decision = await decideOwnerAttentionRoute(PIR_QGQUH, consult);
    expect(decision).toMatchObject({ route: "agent", damaging: false, blockerClass: "guard-failure", agentAction: "route-to-agent" });
    expect(decision.reason).toContain("DI-TEST");
    // The consult received features, never an empty vector (the deleted responder's defect).
    const request = consult.mock.calls[0][0];
    expect(request.scope).toBe("platform");
    expect(request.options.every((o: { features: Record<string, number> }) => Object.keys(o.features).length === 10)).toBe(true);
  });

  it.each([
    ["true-merge-conflict"],
    ["stale-update-budget-exhausted"],
    ["The build reached review without any committed change"],
  ])("routes the mechanical stall %j away from the owner", async (fact) => {
    const decision = await decideOwnerAttentionRoute(
      { ...PIR_QGQUH, blockingFacts: [fact] },
      consultReturning(decisive("route-to-agent")),
    );
    expect(decision.route).not.toBe("human");
  });

  it.each([
    ["critical risk", { riskTier: "critical" as const }, "damaging-critical-risk"],
    ["an outward consequence", { consequence: "outward" as const }, "damaging-consequence"],
    ["an irreversible consequence", { consequence: "irreversible" as const }, "damaging-consequence"],
    ["an authority consequence", { consequence: "authority" as const }, "damaging-consequence"],
    ["a crossed threshold", { thresholdExceeded: true }, "damaging-threshold"],
    ["a regulation", { regulated: true }, "damaging-regulated"],
    ["restricted data", { sensitivity: "restricted" as const }, "damaging-sensitivity"],
    ["a propose boundary", { proposeBoundary: true }, "propose-boundary"],
  ])("still sends %s to a person, without consulting", async (_label, declarations, reasonCode) => {
    const consult = consultReturning(decisive("route-to-agent"));
    const decision = await decideOwnerAttentionRoute({ ...PIR_QGQUH, declarations }, consult);
    expect(decision).toMatchObject({ route: "human", damaging: true, reasonCode });
    expect(decision.consult.status).toBe("skipped-damaging");
    expect(decision.reason).toMatch(/requires a person because/);
    expect(consult).not.toHaveBeenCalled();
  });

  it("sends a non-damaging case to independent review when the consult fails", async () => {
    const consult = vi.fn(async () => { throw new Error("offline"); });
    const decision = await decideOwnerAttentionRoute(PIR_QGQUH, consult);
    expect(decision).toMatchObject({ route: "independent-review", basis: "evaluation-fault" });
    expect(decision.reason).toContain("could not be consulted");
  });

  it.each([
    ["no recommendation", { ...decisive("route-to-agent"), recommendation: null }, "corpus-gap"],
    ["low confidence", { ...decisive("route-to-agent"), recommendation: { optionId: "route-to-agent", confidence: "low" } }, "corpus-gap"],
    ["not autonomy-eligible", { ...decisive("route-to-agent"), autonomyEligible: false }, "corpus-gap"],
    ["a commandment conflict", { ...decisive("route-to-agent"), commandmentConflict: true }, "vector-gap"],
    ["a decisive escalate on a non-damaging case", decisive("escalate"), "policy-limit"],
  ])("sends %s to independent review, never to a person", async (_label, result, basis) => {
    const decision = await decideOwnerAttentionRoute(PIR_QGQUH, consultReturning(result as ScopeConsultResult));
    expect(decision).toMatchObject({ route: "independent-review", basis });
  });

  it("keeps a decisive resume as an agent route that resumes", async () => {
    const decision = await decideOwnerAttentionRoute(PIR_QGQUH, consultReturning(decisive("resume")));
    expect(decision).toMatchObject({ route: "agent", agentAction: "resume" });
  });

  it("consults WWWD for organization work", async () => {
    const consult = consultReturning(decisive("route-to-agent"));
    const decision = await decideOwnerAttentionRoute({ ...PIR_QGQUH, scope: "organization" }, consult);
    expect(consult.mock.calls[0][0].scope).toBe("organization");
    expect(decision.reason).toContain("WWWD");
  });
});

describe("readScopeConsultResult", () => {
  it("reads the principle_decide response shape", () => {
    expect(readScopeConsultResult({
      recommendation: { optionId: "route-to-agent", confidence: "high", margin: 6.18 },
      signalQuality: { autonomyEligible: true },
      flags: { commandmentConflict: false },
      ledger: { interactionId: "DI-007A5617C3EE" },
    })).toEqual({
      recommendation: { optionId: "route-to-agent", confidence: "high" },
      autonomyEligible: true,
      commandmentConflict: false,
      interactionId: "DI-007A5617C3EE",
    });
  });

  it("treats a missing recommendation as none", () => {
    expect(readScopeConsultResult({ recommendation: null }).recommendation).toBeNull();
  });
});

describe("fileOwnerAttentionRoute", () => {
  const report = {
    source: "build-studio", severity: "high", title: "Build Studio needs you",
    description: "Root cause.", featureBuildId: "fb-pk", triggerKind: "review-review-exhausted",
    dedupeKey: "build-escalation:FB-1",
  };
  const deps = () => ({
    createReport: vi.fn(async () => ({ reportId: "PIR-1" })),
    resolveOwner: vi.fn(async () => "user-1"),
    notify: vi.fn(async () => undefined),
  });

  it("files the owner report with its reason and notifies the owner on the human route", async () => {
    const decision = await decideOwnerAttentionRoute({ ...PIR_QGQUH, declarations: { riskTier: "critical" } });
    const d = deps();
    const filed = await fileOwnerAttentionRoute(decision, report, { deepLink: "/admin/issue-reports" }, d);
    expect(filed).toEqual({ reportId: "PIR-1", ownerUserId: "user-1", error: null });
    const written = d.createReport.mock.calls[0][0] as Record<string, unknown>;
    expect(written).toMatchObject({ type: "build-stall-escalation", selfFixClass: "needs-human", dedupeKey: report.dedupeKey });
    expect(written.description).toContain("Why: This decision requires a person because it carries critical risk.");
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({ source: "escalation", itemKey: "PIR-1", deepLink: "/admin/issue-reports" }));
  });

  it("files projected agent work with no self-fix class and no owner notice on the agent route", async () => {
    const decision = await decideOwnerAttentionRoute(PIR_QGQUH, consultReturning(decisive("route-to-agent")));
    const d = deps();
    const filed = await fileOwnerAttentionRoute(decision, report, { deepLink: "/admin/issue-reports" }, d);
    expect(filed.ownerUserId).toBeNull();
    const written = d.createReport.mock.calls[0][0] as Record<string, unknown>;
    expect(written.type).toBe(ROUTED_REPAIR_REPORT_TYPE);
    expect(written.selfFixClass).toBeUndefined();
    expect(written.dedupeKey).toBe("build-escalation:FB-1:routed");
    expect(written.title).toMatch(/^Routed to a coding agent: /);
    expect(written.description).toContain("route agent");
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.resolveOwner).not.toHaveBeenCalled();
  });

  it("returns a write failure instead of throwing", async () => {
    const decision = await decideOwnerAttentionRoute({ ...PIR_QGQUH, declarations: { riskTier: "critical" } });
    const d = { ...deps(), createReport: vi.fn(async () => { throw new Error("duplicate"); }) };
    const filed = await fileOwnerAttentionRoute(decision, report, undefined, d);
    expect(filed).toEqual({ reportId: null, ownerUserId: null, error: "duplicate" });
  });
});

describe("routeToHuman", () => {
  it("decides and writes in one call", async () => {
    const write = {
      createReport: vi.fn(async () => ({ reportId: "PIR-2" })),
      resolveOwner: vi.fn(async () => "user-1"),
      notify: vi.fn(async () => undefined),
    };
    const out = await routeToHuman(
      { ...PIR_QGQUH, report: { source: "s", severity: "high", title: "t", description: "d", triggerKind: "k", dedupeKey: "x" } },
      { consult: consultReturning(decisive("route-to-agent")), write },
    );
    expect(out).toMatchObject({ reportId: "PIR-2", decision: { route: "agent" } });
  });
});
