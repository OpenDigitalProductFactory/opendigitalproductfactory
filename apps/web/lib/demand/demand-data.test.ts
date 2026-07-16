import { describe, expect, it } from "vitest";
import { mapDemandRows } from "./demand-data";

describe("mapDemandRows", () => {
  it("maps epic + estimate provenance fields for the demand board", () => {
    const views = mapDemandRows([
      {
        itemId: "BI-1",
        title: "Thing",
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
        epic: { epicId: "EP-1" },
      },
    ]);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      itemId: "BI-1",
      epicId: "EP-1",
      estimateAiJobSize: 2,
      estimateAgreed: false,
    });
  });
});
