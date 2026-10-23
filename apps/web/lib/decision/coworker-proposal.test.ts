import { describe, expect, it } from "vitest";

import {
  TAK_ALIGNMENT_OPTIONS,
  TAK_ALIGNMENT_PROPOSED_OPTION_ID,
  TAK_ALIGNMENT_SCORED_OPTIONS,
} from "@/lib/tak/alignment-gate-options";

import { normalizeProposedOptionId, readRecordedCoworkerProposal } from "./coworker-proposal";

describe("normalizeProposedOptionId (BI-AE416D75)", () => {
  it("keeps a proposal that names an offered option or scored option id", () => {
    expect(normalizeProposedOptionId("aligned", { options: ["aligned", "revise-before-building"] })).toBe("aligned");
    expect(normalizeProposedOptionId("proceed", {
      options: [...TAK_ALIGNMENT_OPTIONS],
      scoredOptions: TAK_ALIGNMENT_SCORED_OPTIONS,
    })).toBe("proceed");
  });

  it("drops a proposal outside the menu, or an empty one, rather than recording it", () => {
    expect(normalizeProposedOptionId("ship-it", { options: ["aligned", "revise-before-building"] })).toBeNull();
    expect(normalizeProposedOptionId("  ", { options: ["a"] })).toBeNull();
    expect(normalizeProposedOptionId(null, { options: ["a"] })).toBeNull();
  });
});

describe("readRecordedCoworkerProposal (BI-AE416D75)", () => {
  const takRow = {
    gateKey: "org-business",
    options: [...TAK_ALIGNMENT_OPTIONS],
    // As Postgres returns jsonb: key order is not the writer's.
    scoredOptions: JSON.parse(JSON.stringify(TAK_ALIGNMENT_SCORED_OPTIONS)).map(
      (option: { id: string; features: Record<string, number>; description: string }) => ({
        id: option.id,
        features: Object.fromEntries(Object.entries(option.features).reverse()),
        description: option.description,
      }),
    ),
    outcomePayload: { outcomeType: "escalate" },
  };

  it("reads the proposal the gate recorded", () => {
    expect(readRecordedCoworkerProposal({
      gateKey: "profession",
      options: ["aligned", "revise-before-building"],
      scoredOptions: null,
      outcomePayload: { proposedOptionId: "revise-before-building" },
    })).toBe("revise-before-building");
  });

  it("refuses a recorded proposal that is not on the stored menu", () => {
    expect(readRecordedCoworkerProposal({
      gateKey: "profession",
      options: ["aligned", "revise-before-building"],
      scoredOptions: null,
      outcomePayload: { proposedOptionId: "something-else" },
    })).toBeNull();
  });

  it("recovers 'proceed' from a TAK alignment-gate row, whose coworker asked to run the tool", () => {
    expect(readRecordedCoworkerProposal(takRow)).toBe(TAK_ALIGNMENT_PROPOSED_OPTION_ID);
  });

  it("does not recover a proposal from a similar menu the TAK gate did not write", () => {
    const altered = JSON.parse(JSON.stringify(TAK_ALIGNMENT_SCORED_OPTIONS));
    altered[0].features.mission_fit = 0.5;
    expect(readRecordedCoworkerProposal({ ...takRow, scoredOptions: altered })).toBeNull();
    expect(readRecordedCoworkerProposal({ ...takRow, gateKey: "build-studio" })).toBeNull();
    expect(readRecordedCoworkerProposal({ ...takRow, scoredOptions: TAK_ALIGNMENT_SCORED_OPTIONS.slice(0, 1) })).toBeNull();
  });

  it("recovers nothing for an architecture advisory written before the verdict was recorded", () => {
    expect(readRecordedCoworkerProposal({
      gateKey: "profession",
      options: ["aligned", "revise-before-building"],
      scoredOptions: null,
      outcomePayload: { domainClass: "architecture-tradeoff", outcomeType: "escalate" },
    })).toBeNull();
  });
});
