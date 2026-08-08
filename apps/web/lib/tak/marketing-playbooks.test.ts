import { describe, it, expect } from "vitest";
import {
  getPlaybook,
  getPlaybookForCategory,
  getCompositePlaybook,
} from "./marketing-playbooks";

describe("getPlaybook", () => {
  it("returns category playbook when category is known", () => {
    const pb = getPlaybook("hoa-property-management", "inquiry");
    expect(pb.primaryGoal).toContain("Homeowner");
  });

  it("falls back to CTA type when category is unknown", () => {
    const pb = getPlaybook("unknown-category", "booking");
    expect(pb.primaryGoal).toContain("appointment");
  });

  it("falls back to inquiry when both are unknown", () => {
    const pb = getPlaybook(null, null);
    expect(pb.ctaLanguage).toContain("Get a quote");
  });

  it("uses an evidence-led industrial account playbook for manufacturing", () => {
    const pb = getPlaybook("manufacturing", "inquiry");

    expect(pb.primaryGoal).toContain("industrial accounts");
    expect(pb.keyMetrics).toContain("Request-for-quote response and win rate");
    expect(pb.ctaLanguage).toContain("Talk with an engineer");
  });
});

describe("getCompositePlaybook", () => {
  it("returns primary unchanged when no secondaries", () => {
    const composite = getCompositePlaybook("fitness-recreation", []);
    const primary = getPlaybookForCategory("fitness-recreation");
    expect(composite).toBe(primary);
  });

  it("primary identity fields are unchanged", () => {
    const composite = getCompositePlaybook("fitness-recreation", ["retail-goods"]);
    const primary = getPlaybookForCategory("fitness-recreation");
    expect(composite.primaryGoal).toBe(primary.primaryGoal);
    expect(composite.stakeholders).toBe(primary.stakeholders);
    expect(composite.contentTone).toBe(primary.contentTone);
    expect(composite.keyMetrics).toBe(primary.keyMetrics);
    expect(composite.ctaLanguage).toBe(primary.ctaLanguage);
  });

  it("secondary contributes unique campaign types", () => {
    const composite = getCompositePlaybook("fitness-recreation", ["retail-goods"]);
    const primary = getPlaybookForCategory("fitness-recreation");
    const secondary = getPlaybookForCategory("retail-goods");
    expect(composite.campaignTypes.length).toBeGreaterThan(primary.campaignTypes.length);
    // At least one retail campaign type should appear
    const retailCampaigns = secondary.campaignTypes;
    const addedCount = composite.campaignTypes.filter((c) => retailCampaigns.includes(c)).length;
    expect(addedCount).toBeGreaterThan(0);
  });

  it("secondary contributes unique agent skills", () => {
    const composite = getCompositePlaybook("fitness-recreation", ["retail-goods"]);
    const primary = getPlaybookForCategory("fitness-recreation");
    expect(composite.agentSkills.length).toBeGreaterThanOrEqual(primary.agentSkills.length);
  });

  it("duplicate campaign types are not added", () => {
    // Same category — all campaigns are already in primary
    const composite = getCompositePlaybook("fitness-recreation", ["fitness-recreation"]);
    const primary = getPlaybookForCategory("fitness-recreation");
    expect(composite.campaignTypes.length).toBe(primary.campaignTypes.length);
  });

  it("returns primary unchanged when secondary adds nothing new", () => {
    const composite = getCompositePlaybook("fitness-recreation", ["fitness-recreation"]);
    const primary = getPlaybookForCategory("fitness-recreation");
    expect(composite).toBe(primary);
  });

  it("handles null secondary categories gracefully", () => {
    const composite = getCompositePlaybook("hoa-property-management", [null, undefined]);
    const primary = getPlaybookForCategory("hoa-property-management");
    // Null/undefined resolve to the inquiry fallback — adds its unique skills
    expect(composite.agentSkills.length).toBeGreaterThanOrEqual(primary.agentSkills.length);
  });

  it("multiple secondaries union their unique contributions", () => {
    const composite = getCompositePlaybook("professional-services", [
      "retail-goods",
      "fitness-recreation",
    ]);
    const primary = getPlaybookForCategory("professional-services");
    expect(composite.campaignTypes.length).toBeGreaterThan(primary.campaignTypes.length);
    expect(composite.agentSkills.length).toBeGreaterThan(primary.agentSkills.length);
  });

  it("primary goal is taken from primary even for same-category secondary", () => {
    const composite = getCompositePlaybook("trades-maintenance", ["trades-maintenance"]);
    expect(composite.primaryGoal).toContain("first call");
  });
});
