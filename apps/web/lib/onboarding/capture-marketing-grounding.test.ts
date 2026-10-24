import { describe, it, expect } from "vitest";

import { buildMarketingGrounding } from "./capture-marketing-grounding";

describe("buildMarketingGrounding (BI-74E9BD73)", () => {
  it("turns a plain answer about who you serve into target segments", () => {
    const out = buildMarketingGrounding({ servedGroups: "adopters, foster carers and volunteers" });

    expect(out.grounding.targetSegments?.map((s) => s.name)).toEqual([
      "adopters",
      "foster carers",
      "volunteers",
    ]);
    expect(out.answered).toContain("Who you serve");
  });

  it("NEVER infers proof from prose — proof is operator-attributed or absent", () => {
    // A proof asset is a claim about what the organization achieved. Splitting a
    // sentence into bullets and filing them as evidence would manufacture the
    // outcome claims the platform refuses elsewhere.
    const out = buildMarketingGrounding({ servedGroups: "adopters, donors" });

    expect(out.grounding.proofAssets).toBeUndefined();
    expect(out.research.map((r) => r.key)).toContain("proof");
    expect(out.research.find((r) => r.key === "proof")!.because).toMatch(/never inferred/i);
  });

  it("keeps proven results as one operator-attributed note, not a manufactured list", () => {
    const out = buildMarketingGrounding({
      provenResults: "We have placed 240 animals since 2019 and work with two local vets",
    });

    expect(out.grounding.proofAssets).toHaveLength(1);
    expect(out.grounding.proofAssets![0]!.label).toMatch(/240 animals/);
  });

  it("always asks the coworker to research channels, even when reach is answered", () => {
    // The operator's answer says where people find them TODAY. That is a
    // starting point, not the set of channels the sector supports.
    const out = buildMarketingGrounding({ currentReach: "Facebook and word of mouth" });

    const channels = out.research.find((r) => r.key === "channels");
    expect(channels).toBeDefined();
    expect(channels!.question).toMatch(/Beyond Facebook and word of mouth/);
    expect(out.answered).toContain("Where people find you today");
  });

  it("asks what each channel prohibits, and says why that feeds the archetype seed", () => {
    const out = buildMarketingGrounding({});
    const rules = out.research.find((r) => r.key === "channel-rules");

    expect(rules).toBeDefined();
    expect(rules!.because).toMatch(/archetype seed/i);
  });

  it("treats a completely unanswered capture as empty rather than as failure", () => {
    const out = buildMarketingGrounding({});

    expect(out.empty).toBe(true);
    expect(out.answered).toEqual([]);
    // Still hands the coworker something to do — an unanswered operator is not
    // a dead end, it is a research brief.
    expect(out.research.length).toBeGreaterThan(0);
  });

  it("partial answers are normal and produce partial grounding", () => {
    const out = buildMarketingGrounding({ servedGroups: "adopters" });

    expect(out.empty).toBe(false);
    expect(out.grounding.targetSegments).toHaveLength(1);
    expect(out.grounding.proofAssets).toBeUndefined();
    expect(out.research.map((r) => r.key)).toContain("proof");
  });

  it("captures a refusal as a constraint the coworker must honour", () => {
    const out = buildMarketingGrounding({
      localConstraints: "Never show animals in cages, and never guilt-trip donors",
    });

    expect(out.grounding.constraints?.compliance).toMatch(/never guilt-trip/i);
    expect(out.answered).toContain("What you will not do");
  });

  it("ignores punctuation-only and single-character fragments", () => {
    const out = buildMarketingGrounding({ servedGroups: "adopters, , x; donors" });

    expect(out.grounding.targetSegments?.map((s) => s.name)).toEqual(["adopters", "donors"]);
  });
});
