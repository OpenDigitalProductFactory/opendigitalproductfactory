import { describe, expect, it } from "vitest";

import {
  computeReviewLines,
  isBareQuestion,
  measureAgreement,
  measureCraftFallback,
  measureEmptyQuestion,
  measureRepeatEscalation,
  measureStarvation,
  measureUnlearned,
  measureWeightSensitive,
  normaliseQuestion,
  type ReviewLedgerRow,
} from "./measures";

const NOW = new Date("2026-09-08T00:00:00Z");
const OLD = new Date("2026-08-28T00:00:00Z");

let seq = 0;
function row(over: Partial<ReviewLedgerRow> = {}): ReviewLedgerRow {
  seq += 1;
  return {
    interactionId: `DI-${seq}`,
    profileId: "mark-dpf-platform",
    profileKind: "platform",
    gateKey: "kernel-consult",
    routeContext: "mcp:principle_decide",
    domainClass: "kernel-consult",
    outcomeType: "recommend",
    riskTier: "medium",
    question: "Should we split the ledger?",
    gateFallbackUsed: false,
    outcomePayload: null,
    recommendedOptionId: null,
    chosenOptionId: null,
    sensitivityUnstable: null,
    sensitivity: null,
    createdAt: NOW,
    ...over,
  };
}

function repeat(n: number, make: (i: number) => ReviewLedgerRow): ReviewLedgerRow[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

/** The 2026-09-08 review reproduced as a fixture (design AC-1). */
function fixtureLedger(): ReviewLedgerRow[] {
  return [
    // 348 EA architecture-tradeoff consults that fell back to platform doctrine.
    ...repeat(348, () => row({
      gateKey: "profession",
      routeContext: "reviewDesignDoc",
      domainClass: "architecture-tradeoff",
      outcomeType: "defer",
      gateFallbackUsed: true,
      outcomePayload: { professionKey: "enterprise-architecture" },
      question: "Architectural alignment review: split the ledger",
    })),
    // 160 kernel consults with a recommendation nobody recorded a choice for.
    ...repeat(160, (i) => row({ recommendedOptionId: `opt-${i % 2}`, createdAt: OLD })),
    // Four empty tool-name escalations against the org profile.
    ...["create portal pr: ", "run hive scout ingest: ", "discovery sweep: ", "grok signin start: "].map((q) =>
      row({
        profileId: "org-perspective-x",
        profileKind: "organization",
        gateKey: "org-business",
        routeContext: `/tool/${q.trim().replace(/:$/, "").replaceAll(" ", "_")}`,
        domainClass: "plan-readiness",
        outcomeType: "escalate",
        question: q,
      })),
  ];
}

describe("computeReviewLines on the 2026-09-08 fixture (AC-1)", () => {
  const lines = computeReviewLines({
    rows: fixtureLedger(),
    materialCountByProfile: { "mark-dpf-platform": 6, "org-perspective-x": 16 },
    now: NOW,
  });
  const byKey = (k: string) => lines.filter((l) => l.measureKey === k);

  it("reports craft fallback for enterprise-architecture / architecture-tradeoff", () => {
    expect(byKey("craft-fallback")).toEqual([
      expect.objectContaining({
        scope: "wsid",
        professionKey: "enterprise-architecture",
        proposedAction: "publish-craft-page",
        evidence: { consults: 348, deferred: 348, domainClass: "architecture-tradeoff" },
      }),
    ]);
  });

  it("reports the kernel-consult recommendations nobody graded", () => {
    expect(byKey("unlearned")).toEqual([
      expect.objectContaining({ scope: "wwmd", evidence: expect.objectContaining({ gate: "kernel-consult", total: 160, unlearned: 160, ratio: 1 }) }),
    ]);
  });

  it("reports the four bare tool-name escalations as a defect", () => {
    const [line] = byKey("empty-question");
    expect(line?.proposedAction).toBe("file-defect");
    expect(line?.evidence.rows).toBe(4);
    expect(line?.evidence.labels).toHaveLength(4);
  });

  it("reports the platform profile as starved (160 decisions on 6 rows)", () => {
    expect(byKey("starvation")).toEqual([
      expect.objectContaining({ scope: "wwmd", evidence: { decisions: 160, materialRows: 6, decisionsPerRow: 27 } }),
    ]);
  });

  it("says plainly that no scope has graded decisions", () => {
    expect(byKey("agreement").map((l) => l.lineKey).sort()).toEqual([
      "agreement:wsid:none",
      "agreement:wwmd:none",
      "agreement:wwwd:none",
    ]);
  });

  it("is deterministic", () => {
    const again = computeReviewLines({ rows: fixtureLedger(), materialCountByProfile: { "mark-dpf-platform": 6, "org-perspective-x": 16 }, now: NOW });
    expect(again.map((l) => l.lineKey)).toEqual(lines.map((l) => l.lineKey));
  });
});

describe("individual measures", () => {
  it("craft-fallback ignores consults the craft answered itself", () => {
    expect(measureCraftFallback([row({ gateKey: "profession", outcomeType: "recommend", gateFallbackUsed: false, outcomePayload: { professionKey: "ux-design" } })])).toEqual([]);
  });

  it("starvation stays quiet below the threshold and flags a profile with no material at all", () => {
    expect(measureStarvation(repeat(5, () => row()), { "mark-dpf-platform": 6 })).toEqual([]);
    const [line] = measureStarvation(repeat(20, () => row({ profileId: "wsid-finance", profileKind: "profession" })), {});
    expect(line).toMatchObject({ scope: "wsid", professionKey: "finance", evidence: { materialRows: 0, decisionsPerRow: -1 } });
  });

  it("repeat-escalation clusters by tool route or normalised question and proposes stance capture for the org", () => {
    const lines = measureRepeatEscalation([
      ...repeat(3, () => row({ gateKey: "org-business", profileKind: "organization", outcomeType: "escalate", routeContext: "/tool/send_marketing_email", question: "send marketing email: Spring drive" })),
      ...repeat(3, (i) => row({ outcomeType: "defer", question: `Should BI-${i}ABC land behind a flag?  ` })),
      row({ outcomeType: "defer", question: "one-off" }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.scope === "wwwd")?.proposedAction).toBe("capture-stance");
    expect(lines.find((l) => l.scope === "wwmd")?.evidence.repeats).toBe(3);
  });

  it("empty-question only counts unanswered rows", () => {
    expect(measureEmptyQuestion([row({ question: "create portal pr:", outcomeType: "recommend" })])).toEqual([]);
  });

  it("unlearned ignores rows younger than a week and rows without a recommendation", () => {
    expect(measureUnlearned([row({ recommendedOptionId: "a" }), row({ createdAt: OLD })], NOW)).toEqual([]);
  });

  it("agreement flags a class humans disagree with and stays quiet above threshold", () => {
    const disagree = repeat(4, (i) => row({ recommendedOptionId: "a", chosenOptionId: i === 0 ? "a" : "b" }));
    const lines = measureAgreement(disagree).filter((l) => l.evidence.total !== undefined);
    expect(lines).toEqual([expect.objectContaining({ lineKey: "agreement:wwmd/kernel-consult", proposedAction: "examine-weight", evidence: { agreed: 1, total: 4, rate: 0.25 } })]);
    const agree = repeat(4, () => row({ recommendedOptionId: "a", chosenOptionId: "a" }));
    expect(measureAgreement(agree).filter((l) => l.evidence.total !== undefined)).toEqual([]);
  });

  it("weight-sensitive groups flips by driving principle and attributes unstable rows without ids", () => {
    const lines = measureWeightSensitive([
      ...repeat(3, () => row({ sensitivity: { flippingPrincipleIds: ["proper-fix-over-quick-fix"] } })),
      ...repeat(3, () => row({ sensitivityUnstable: true })),
      row({ sensitivity: { flippingPrincipleIds: ["single-source-of-truth"] } }),
    ]);
    expect(lines.map((l) => [l.evidence.principleId, l.evidence.flips])).toEqual([
      ["proper-fix-over-quick-fix", 3],
      ["(unattributed)", 3],
    ]);
  });

  it("normalises questions and recognises bare labels", () => {
    expect(normaliseQuestion("Should  BI-12AB land?")).toBe("should <id> land?");
    expect(isBareQuestion("create portal pr: ")).toBe(true);
    expect(isBareQuestion("Should we extend net-60 terms?")).toBe(false);
  });
});
