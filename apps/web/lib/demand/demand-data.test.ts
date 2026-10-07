import { describe, expect, it } from "vitest";
import { mapDemandRows } from "./demand-data";

describe("mapDemandRows", () => {
  it("maps epic + estimate provenance fields for the demand board", () => {
    const views = mapDemandRows([
      {
        itemId: "BI-1",
        title: "Thing",
        body: "Customers abandon booking.",
        status: "open",
        workType: "feature",
        demandStage: "screened",
        demandScore: 1.5,
        demandScoreFramework: "rice",
        effortSize: "small",
        jobSize: null,
        impact: null,
        investmentBucket: null,
        estimateAiJobSize: 2,
        estimateHumanJobSize: 3,
        estimateSource: "ai",
        estimateAgreed: false,
        claimStatus: null,
        claimedByAgentId: null,
        reach: 10,
        occurrenceCount: 10,
        confidence: 0.5,
        businessValue: null,
        timeCriticality: null,
        riskOpportunity: null,
        organizationId: "org-1",
        productLineId: null,
        businessProductId: "product-1",
        digitalProductId: null,
        demandEvidenceLinks: [
          {
            evidenceLinkId: "DME-1",
            sourceKind: "booking",
            sourceRef: "booking-1",
            title: "Abandoned booking",
            summary: null,
            confidence: 0.8,
            reviewedAt: new Date("2026-07-28T00:00:00Z"),
          },
        ],
        activities: [
          {
            kind: "demand_funding_decision",
            summary: "Funding deferred",
            recordedAt: new Date("2026-07-28T01:00:00Z"),
            payload: { funded: false },
          },
        ],
        _count: { activities: 1 },
        epic: { epicId: "EP-1" },
      },
    ]);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      itemId: "BI-1",
      epicId: "EP-1",
      estimateAiJobSize: 2,
      estimateAgreed: false,
      organizationId: "org-1",
      businessProductId: "product-1",
      activation: expect.objectContaining({
        stage: "screened",
        readiness: expect.objectContaining({ evidenceReady: true }),
      }),
      fundingDecisionCount: 1,
    });
    expect(views[0].evidenceLinks?.[0]?.reviewedAt).toBe(
      "2026-07-28T00:00:00.000Z",
    );
    expect(views[0].decisionHistory?.[0]).toMatchObject({
      summary: "Funding deferred",
      payload: { funded: false },
    });
  });
});

describe("mapDemandRows value-input provenance (BI-00C68162)", () => {
  const minimal = {
    itemId: "BI-2", title: "T", status: "open", workType: "bug", demandStage: null,
    demandScore: 0.333, demandScoreFramework: "rice", effortSize: "medium", jobSize: 3,
    impact: 1, investmentBucket: "run", estimateAiJobSize: 3, estimateHumanJobSize: null,
    estimateSource: "ai", estimateAgreed: null, claimStatus: null, claimedByAgentId: null,
    epic: null,
  };

  it("carries an agent-proposed source onto the activation explanation", () => {
    const [view] = mapDemandRows([{ ...minimal, demandInputSource: "ai" }]);
    expect(view!.activation!.score.inputSource).toBe("ai");
  });

  it("reads an absent or unknown source as unattributed", () => {
    expect(mapDemandRows([minimal])[0]!.activation!.score.inputSource).toBeNull();
    expect(mapDemandRows([{ ...minimal, demandInputSource: "robot" }])[0]!.activation!.score.inputSource).toBeNull();
  });
});
