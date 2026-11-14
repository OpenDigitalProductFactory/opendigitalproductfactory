// BI-09FB398D: a risk the failure analysis places outside this change goes
// through the escalation gate (BI-5E067004) one risk at a time. Damage reaches
// a person; a WWMD-decided risk is accepted with an owning item; anything the
// consult did not decide stays on the bounded repair path.
import { describe, expect, it, vi } from "vitest";

import type { OwnerAttentionDecision, OwnerAttentionInput } from "@/lib/govern/authority/route-to-human";
import { acceptOutOfScopeRisks, type RiskAcceptanceDeps } from "./risk-acceptance";
import type { UnmitigatedRisk } from "./finalize-stage";

const identity = { capsuleId: "WC-837ACE25", headTreeHash: "a".repeat(40), diffDigest: "b".repeat(64) };

// The PIR-1O0W0 risk, as FB-837ACE25's analysis wrote it.
const webhookRisk: UnmitigatedRisk = {
  key: "crash-between-accept-and-queue", severity: "high",
  trigger: "Service crashes after accepting webhook but before queuing the job",
  effect: "The webhook delivery is acknowledged but never processed",
  disposition: "deferred",
  rationale: "This change cannot mitigate infrastructure failures; mitigation requires a durable queue outside this code change scope",
};

function decision(route: OwnerAttentionDecision["route"], damaging = false): OwnerAttentionDecision {
  return {
    route, damaging, blockerClass: "unmitigated-risk", basis: damaging ? null : "decided",
    reasonCode: damaging ? "damaging-critical-risk" : route === "agent" ? "decided" : "independent-review-required",
    agentAction: route === "agent" ? "route-to-agent" : null,
    consult: {
      status: damaging ? "skipped-damaging" : route === "agent" ? "decided" : "indecisive",
      scope: "platform", optionId: route === "agent" ? "route-to-agent" : null,
      confidence: route === "agent" ? "high" : null, interactionId: damaging ? null : "DI-RISK",
    },
    reason: `routed ${route}`,
  };
}

function deps(route: OwnerAttentionDecision["route"], damaging = false) {
  const decide = vi.fn(async (_input: OwnerAttentionInput) => decision(route, damaging));
  const file = vi.fn(async () => ({ reportId: "PIR-OWNER", ownerUserId: null, error: null }));
  const record = vi.fn(async () => ({ id: "risk-acceptance-1", completedAt: "2026-11-14T10:00:00.000Z" }));
  return { decide, file, record } satisfies RiskAcceptanceDeps;
}

const run = (risks: UnmitigatedRisk[], d: RiskAcceptanceDeps) =>
  acceptOutOfScopeRisks({ buildId: "FB-837ACE25", buildPk: "build-pk", identity, risks }, d);

describe("acceptOutOfScopeRisks", () => {
  it("accepts a non-damaging risk WWMD decided, files the item that owns it, and records the authority", async () => {
    const d = deps("agent");
    const out = await run([webhookRisk], d);

    expect(d.decide).toHaveBeenCalledWith(expect.objectContaining({
      producer: "build-stall", blockerClass: "unmitigated-risk",
      subject: { kind: "build", id: "FB-837ACE25" },
      declarations: { riskTier: "high" },
    }));
    expect(d.decide.mock.calls[0]![0].blockingFacts.join(" ")).toContain("outside this change");
    expect(d.file).toHaveBeenCalledWith(expect.objectContaining({ route: "agent" }), expect.objectContaining({
      featureBuildId: "build-pk", triggerKind: "out-of-scope-risk",
      dedupeKey: "out-of-scope-risk:FB-837ACE25:crash-between-accept-and-queue",
    }));
    expect(d.record).toHaveBeenCalledWith(expect.objectContaining({
      scenarioKey: "crash-between-accept-and-queue", identity, followUpReference: "PIR-OWNER",
    }));
    expect(out.owner).toEqual([]);
    expect(out.unaccepted).toEqual([]);
    expect(out.accepted).toEqual([{
      key: "crash-between-accept-and-queue",
      followUpReference: "PIR-OWNER",
      note: expect.stringContaining("DI-RISK"),
      authority: expect.objectContaining({
        id: "risk-acceptance-1", kind: "risk-acceptance", ...identity, status: "accepted",
        scenarioKey: "crash-between-accept-and-queue", followUpReference: "PIR-OWNER",
      }),
    }]);
  });

  it("sends a damaging risk to a person, and accepts nothing for it", async () => {
    const d = deps("human", true);
    const critical = { ...webhookRisk, severity: "critical" as const };
    const out = await run([critical], d);
    expect(d.decide).toHaveBeenCalledWith(expect.objectContaining({ declarations: { riskTier: "critical" } }));
    expect(out).toEqual({ accepted: [], owner: [critical], unaccepted: [] });
    expect(d.file).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
  });

  it("leaves a risk the consult did not decide on the repair path, with nothing written", async () => {
    const d = deps("independent-review");
    const out = await run([webhookRisk], d);
    expect(out).toEqual({ accepted: [], owner: [], unaccepted: [webhookRisk] });
    expect(d.file).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
  });

  it("never accepts a risk whose owning item or authority could not be written", async () => {
    const noItem = { ...deps("agent"), file: vi.fn(async () => ({ reportId: null, ownerUserId: null, error: "db down" })) };
    expect((await run([webhookRisk], noItem)).unaccepted).toEqual([webhookRisk]);
    const noAuthority = { ...deps("agent"), record: vi.fn(async () => null) };
    expect((await run([webhookRisk], noAuthority)).unaccepted).toEqual([webhookRisk]);
  });
});
