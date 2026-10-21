import { describe, expect, it, vi } from "vitest";

import { decisionShadowLedgerId } from "./decision-shadow-ledger-mapping";
import { DECISION_TRUST_MIN_SAMPLES, REPORT_ONLY_RECOMMENDATION } from "./decision-trust-state";
import {
  backfillDecisionShadowLedger,
  loadDecisionTrustReport,
  recomputeDecisionTrustStates,
  runDecisionTrustRecompute,
  type DecisionTrustDb,
} from "./decision-trust-state-store";

type Row = Record<string, unknown>;

function resolution(resolvedBy: "human" | "agent", agreement: boolean | null) {
  return {
    type: "kernel-consult-resolution",
    disposition: agreement === null ? "unresolved" : agreement ? "followed" : "overridden",
    resolvedBy,
    recommendedOptionId: "a",
    chosenOptionId: agreement === null ? null : agreement ? "a" : "b",
    agreement,
    rationale: "",
    resolvedAt: "2026-10-01T00:00:00.000Z",
  };
}

function decision(id: string, over: Row = {}): Row {
  return {
    interactionId: id,
    agentId: "AGT-A",
    domainClass: "kernel-consult",
    riskTier: "low",
    outcomeType: "recommend",
    recommendedOptionId: "a",
    options: ["a", "b"],
    rationale: null,
    chosenOptionId: null,
    humanOutcome: null,
    taskRunId: null,
    autonomous: false,
    subjectKind: null,
    subjectRef: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...over,
  };
}

/** An in-memory stand-in that honours the few query shapes the store uses. */
function fakeDb(decisions: Row[], seedLedger: Row[] = [], seedTrust: Row[] = []) {
  const ledger = new Map<string, Row>(seedLedger.map((r) => [String(r.ledgerId), r]));
  const trust = new Map<string, Row>(
    seedTrust.map((r) => [`${r.agentId}|${r.activityType}|${r.riskClass}`, r]),
  );
  const ledgerUpsert = vi.fn(async (args: { where: { ledgerId: string }; create: Row; update: Row }) => {
    const existing = ledger.get(args.where.ledgerId);
    const next = existing
      ? { ...existing, ...args.update }
      : { observedAt: new Date("2026-10-07T00:00:00.000Z"), agreement: null, reconciledAt: null, ...args.create };
    ledger.set(args.where.ledgerId, next);
    return next;
  });
  const trustUpsert = vi.fn(
    async (args: {
      where: { agentId_activityType_riskClass: { agentId: string; activityType: string; riskClass: string } };
      create: Row;
      update: Row;
    }) => {
      const k = args.where.agentId_activityType_riskClass;
      const key = `${k.agentId}|${k.activityType}|${k.riskClass}`;
      const existing = trust.get(key);
      const next = existing ? { ...existing, ...args.update } : { ...args.create };
      trust.set(key, next);
      return next;
    },
  );
  const db = {
    decisionInteraction: {
      findMany: vi.fn(async () => decisions.filter((d) => d.agentId != null)),
    },
    decisionShadowLedger: {
      upsert: ledgerUpsert,
      findMany: vi.fn(async () => [...ledger.values()].filter((r) => r.sourceKind === "governed-decision")),
    },
    trustState: {
      upsert: trustUpsert,
      findMany: vi.fn(async () => [...trust.values()]),
    },
  } as unknown as DecisionTrustDb;
  return { db, ledger, trust, ledgerUpsert, trustUpsert };
}

describe("backfillDecisionShadowLedger", () => {
  it("writes a ledger row for an attributed decision that predates the bridge, at the decision's own time", async () => {
    const made = new Date("2026-08-15T12:00:00.000Z");
    const { db, ledger } = fakeDb([decision("DI-1", { createdAt: made })]);
    const result = await backfillDecisionShadowLedger(db);
    expect(result).toMatchObject({ examined: 1, written: 1, alreadyCurrent: 0 });
    const row = ledger.get(decisionShadowLedgerId("DI-1"))!;
    expect(row).toMatchObject({ agentId: "AGT-A", autonomyLevel: "shadow", observedAt: made });
  });

  it("is idempotent: a second pass writes nothing", async () => {
    const { db, ledgerUpsert } = fakeDb([decision("DI-1"), decision("DI-2")]);
    await backfillDecisionShadowLedger(db);
    ledgerUpsert.mockClear();
    const again = await backfillDecisionShadowLedger(db);
    expect(again).toMatchObject({ written: 0, alreadyCurrent: 2 });
    expect(ledgerUpsert).not.toHaveBeenCalled();
  });

  it("completes a ledger row whose decision has since been resolved", async () => {
    const { db, ledger } = fakeDb(
      [decision("DI-1", { humanOutcome: resolution("human", true), chosenOptionId: "a" })],
      [
        {
          ledgerId: decisionShadowLedgerId("DI-1"),
          decisionInteractionId: "DI-1",
          sourceKind: "governed-decision",
          agreement: null,
          reconciledAt: null,
        },
      ],
    );
    const result = await backfillDecisionShadowLedger(db);
    expect(result.written).toBe(1);
    expect(ledger.get(decisionShadowLedgerId("DI-1"))).toMatchObject({ agreement: true });
  });

  it("counts a refusal by reason rather than inventing a bucket", async () => {
    const { db } = fakeDb([decision("DI-1", { domainClass: "not-a-class" })]);
    const result = await backfillDecisionShadowLedger(db);
    expect(result.written).toBe(0);
    expect(result.refused).toEqual({ "unmapped-domain-class": 1 });
  });

  it("stops at the write budget and reports what it deferred", async () => {
    const { db } = fakeDb([decision("DI-1"), decision("DI-2"), decision("DI-3")]);
    const result = await backfillDecisionShadowLedger(db, { maxWrites: 2 });
    expect(result).toMatchObject({ written: 2, deferred: 1 });
  });
});

describe("backfill of a coworker's own proposal (BI-AE416D75)", () => {
  const takMenu = [
    { id: "proceed", features: { gtm_fit: 1, market_fit: 1, mission_fit: 1, product_fit: 1 }, description: "Proceed" },
    { id: "decline", features: { blast_radius: 0, reversibility: 1 }, description: "Decline" },
  ];
  function takDecision(id: string, over: Row = {}): Row {
    return decision(id, {
      agentId: "AGT-WS-SCOUT",
      domainClass: "plan-readiness",
      riskTier: "medium",
      outcomeType: "escalate",
      recommendedOptionId: null,
      options: ["Proceed", "Decline"],
      gateKey: "org-business",
      scoredOptions: takMenu,
      outcomePayload: { outcomeType: "escalate" },
      ...over,
    });
  }
  const answered = {
    chosenOptionId: "proceed",
    humanOutcome: {
      type: "escalation",
      answer: "Proceed — always.",
      resolverUserId: "user-1",
      capturedAt: "2026-09-15T22:54:10.753Z",
      clearsGate: true,
      chosenOptionId: "proceed",
    },
  };
  // The row the BI-6082C235 backfill wrote before the proposal was readable.
  function legacyLedgerRow(id: string): Row {
    return {
      ledgerId: decisionShadowLedgerId(id),
      decisionInteractionId: id,
      agentId: "AGT-WS-SCOUT",
      activityType: "governed_decision_plan_readiness",
      riskClass: "internal-irreversible",
      sourceKind: "governed-decision",
      observedAt: new Date("2026-09-15T00:00:00.000Z"),
      proposedDecision: { outcomeType: "escalate", recommendedOptionId: null, options: ["Proceed", "Decline"] },
      metadata: { resolvedBy: null },
      agreement: null,
      reconciledAt: null,
    };
  }

  it("rewrites a legacy TAK-gate row with the coworker's 'proceed' and counts a person's answer as a sample", async () => {
    const { db, ledger, trust } = fakeDb(
      [takDecision("DI-T1", answered), takDecision("DI-T2")],
      [legacyLedgerRow("DI-T1"), legacyLedgerRow("DI-T2")],
    );
    const result = await backfillDecisionShadowLedger(db);
    expect(result).toMatchObject({ written: 2, alreadyCurrent: 0 });
    expect(ledger.get(decisionShadowLedgerId("DI-T1"))).toMatchObject({
      proposedDecision: { recommendedOptionId: "proceed", recommendedBy: "coworker" },
      agreement: true,
      metadata: { resolvedBy: "human" },
    });
    expect(ledger.get(decisionShadowLedgerId("DI-T2"))).toMatchObject({
      proposedDecision: { recommendedOptionId: "proceed", recommendedBy: "coworker" },
      agreement: null,
    });

    await recomputeDecisionTrustStates(db, new Date("2026-10-21T00:00:00.000Z"));
    expect([...trust.values()][0]).toMatchObject({ agentId: "AGT-WS-SCOUT", sampleCount: 1, agreementCount: 1 });

    const again = await backfillDecisionShadowLedger(db);
    expect(again).toMatchObject({ written: 0, alreadyCurrent: 2 });
  });

  it("leaves an architecture advisory whose verdict was never stored without a recommendation", async () => {
    const ea = decision("DI-EA", {
      agentId: "AGT-WS-EA",
      domainClass: "architecture-tradeoff",
      riskTier: "medium",
      outcomeType: "escalate",
      recommendedOptionId: null,
      options: ["aligned", "revise-before-building"],
      gateKey: "profession",
      scoredOptions: null,
      outcomePayload: { outcomeType: "escalate" },
    });
    const { db, ledger } = fakeDb([ea]);
    await backfillDecisionShadowLedger(db);
    expect(ledger.get(decisionShadowLedgerId("DI-EA"))).toMatchObject({
      proposedDecision: { recommendedOptionId: null, recommendedBy: null },
    });
    const again = await backfillDecisionShadowLedger(db);
    expect(again).toMatchObject({ written: 0, alreadyCurrent: 1 });
  });

  it("carries a proposal the gate recorded on a new architecture advisory", async () => {
    const ea = decision("DI-EA2", {
      agentId: "AGT-WS-EA",
      domainClass: "architecture-tradeoff",
      outcomeType: "escalate",
      recommendedOptionId: null,
      options: ["aligned", "revise-before-building"],
      gateKey: "profession",
      scoredOptions: null,
      outcomePayload: { outcomeType: "escalate", proposedOptionId: "aligned" },
    });
    const { db, ledger } = fakeDb([ea]);
    await backfillDecisionShadowLedger(db);
    expect(ledger.get(decisionShadowLedgerId("DI-EA2"))).toMatchObject({
      proposedDecision: { recommendedOptionId: "aligned", recommendedBy: "coworker" },
    });
  });
});

describe("recomputeDecisionTrustStates", () => {
  it("creates a TrustState at shadow for every coworker with a governed decision, resolved or not", async () => {
    const { db, trust } = fakeDb([
      decision("DI-1"),
      decision("DI-2", { agentId: "AGT-B", humanOutcome: resolution("human", true), chosenOptionId: "a" }),
    ]);
    await backfillDecisionShadowLedger(db);
    const result = await recomputeDecisionTrustStates(db, new Date("2026-10-07T00:00:00.000Z"));
    expect(result.trustStates).toBe(2);
    const states = [...trust.values()];
    expect(states.map((s) => s.agentId).sort()).toEqual(["AGT-A", "AGT-B"]);
    for (const s of states) {
      expect(s.currentLevel).toBe("shadow");
      expect(s.recommendation).toEqual(REPORT_ONLY_RECOMMENDATION);
    }
    expect(states.find((s) => s.agentId === "AGT-A")).toMatchObject({ sampleCount: 0, agreementRate: null });
    expect(states.find((s) => s.agentId === "AGT-B")).toMatchObject({ sampleCount: 1, agreementCount: 1 });
  });

  it("never writes currentLevel on an existing row, so no pass can raise it", async () => {
    const { db, trustUpsert } = fakeDb([decision("DI-1")]);
    await backfillDecisionShadowLedger(db);
    await recomputeDecisionTrustStates(db, new Date());
    await recomputeDecisionTrustStates(db, new Date());
    for (const call of trustUpsert.mock.calls) {
      expect(call[0].update).not.toHaveProperty("currentLevel");
      expect(call[0].create.currentLevel).toBe("shadow");
    }
  });
});

describe("loadDecisionTrustReport", () => {
  it("shows every attributed coworker, withholds thin rates and states its caveats", async () => {
    const { db } = fakeDb([
      decision("DI-1"),
      decision("DI-2", { humanOutcome: resolution("human", false), chosenOptionId: "b" }),
      decision("DI-3", { agentId: "AGT-C" }),
    ]);
    await runDecisionTrustRecompute(db, new Date("2026-10-07T00:00:00.000Z"));
    const report = await loadDecisionTrustReport(db);
    expect(report.allShadow).toBe(true);
    const a = report.rows.find((r) => r.agentId === "AGT-A")!;
    expect(a).toMatchObject({ decisionCount: 2, sampleCount: 1, unresolvedCount: 1, agreementRate: null });
    expect(a.rateDisplay).toBe(`insufficient samples (1 of ${DECISION_TRUST_MIN_SAMPLES})`);
    expect(report.rows.find((r) => r.agentId === "AGT-C")).toMatchObject({ unresolvedCount: 1 });
    expect(report.caveats.join(" ")).toContain("concordance, not correctness");
  });

  it("lists a coworker whose decisions have not reached the ledger yet", async () => {
    const { db } = fakeDb([decision("DI-1", { agentId: "AGT-LATE" })]);
    const report = await loadDecisionTrustReport(db);
    expect(report.unmeasuredCoworkers).toEqual([{ agentId: "AGT-LATE", attributedDecisions: 1, inLedger: 0 }]);
  });
});
