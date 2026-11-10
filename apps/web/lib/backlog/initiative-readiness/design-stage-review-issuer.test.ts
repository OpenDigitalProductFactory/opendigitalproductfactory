import { describe, expect, it } from "vitest";

import { selectIssuedDesignStagePackets } from "./design-stage-review-issuer";

const ITEM = "BI-0B2C3F6D";

function packet(gate: string, itemId = ITEM) {
  return {
    targetAgent: "AGT-WS-REVIEW",
    requestKey: `initiative-readiness:${itemId}:${gate}`,
    initiativeReviewBinding: {
      writerToolName: gate === "architecture-review"
        ? "record_initiative_architecture_review"
        : "record_initiative_design_review",
      itemId,
      gate,
    },
  };
}

describe("issued design-stage review packets (BI-9CCB88C4)", () => {
  it("returns an empty current-packet list when a recovery route has a null packet, instead of throwing", () => {
    expect(selectIssuedDesignStagePackets([null, undefined], ITEM)).toEqual([]);
  });

  it("keeps a live design-spec packet and drops PIR, other-item, and null packets", () => {
    const live = packet("design-spec");
    expect(selectIssuedDesignStagePackets([
      live,
      packet("post-implementation-review"),
      packet("design-spec", "BI-OTHER"),
      null,
    ], ITEM)).toEqual([live]);
  });

  it("keeps only the named steward gate when one is passed", () => {
    const design = packet("design-spec");
    const architecture = packet("architecture-review");
    expect(selectIssuedDesignStagePackets([design, architecture], ITEM, "architecture-review")).toEqual([architecture]);
  });
});
