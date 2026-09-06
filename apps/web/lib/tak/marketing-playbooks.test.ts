import { describe, it, expect } from "vitest";
import {
  getPlaybook,
  getPlaybookForCategory,
  getCompositePlaybook,
  getPlaybookForLeafArchetype,
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

describe("leaf-archetype playbooks (EP-5CC9C184)", () => {
  it("gives pet-rescue a placement goal, not the category's donor goal", () => {
    const leaf = getPlaybook("nonprofit-community", "inquiry", "pet-rescue");
    const category = getPlaybook("nonprofit-community", "inquiry");

    // The category answer is wrong for this leaf: a rescue's job is placing
    // animals, and marketing it as a fundraiser is the wrong job.
    expect(category.primaryGoal).toMatch(/donor/i);
    expect(leaf.primaryGoal).toMatch(/place/i);
    expect(leaf.primaryGoal).not.toMatch(/donor base/i);
  });

  it("names adopters and fosters, whom the category playbook omits entirely", () => {
    const leaf = getPlaybook("nonprofit-community", "inquiry", "pet-rescue");
    const category = getPlaybook("nonprofit-community", "inquiry");

    expect(category.stakeholders).not.toMatch(/adopter|foster/i);
    expect(leaf.stakeholders).toMatch(/adopter/i);
    expect(leaf.stakeholders).toMatch(/foster/i);
  });

  it("leaves every other leaf on its category playbook", () => {
    // The leaf tier exists only where the category is wrong; it must not become
    // a second place to restate the same advice.
    expect(getPlaybook("nonprofit-community", "inquiry", "food-bank")).toEqual(
      getPlaybook("nonprofit-community", "inquiry"),
    );
    expect(getPlaybookForLeafArchetype("hoa-single-family")).toBeNull();
    expect(getPlaybookForLeafArchetype(null)).toBeNull();
  });

  it("keeps the pre-existing two-arg behaviour unchanged", () => {
    expect(getPlaybook("retail-goods", "purchase")).toEqual(
      getPlaybookForCategory("retail-goods"),
    );
  });
});

describe("channel policy (EP-5CC9C184 / BI-3543E59D)", () => {
  it("carries the Marketplace constraint with a rationale and a route that works", () => {
    const leaf = getPlaybook("nonprofit-community", "inquiry", "pet-rescue");
    const marketplace = leaf.channelConstraints?.find((c) => /Marketplace/i.test(c.channel));

    expect(marketplace).toBeDefined();
    expect(marketplace!.constraint).toMatch(/do not list/i);
    // Rationale is load-bearing: it is how an operator re-checks a crowd-sourced
    // rule when a platform changes its terms.
    expect(marketplace!.rationale.length).toBeGreaterThan(40);
    expect(marketplace!.insteadUse).toMatch(/group/i);
  });

  it("does not publish an animal that is not yet available", () => {
    const leaf = getPlaybook("nonprofit-community", "inquiry", "pet-rescue");
    const hold = leaf.channelConstraints?.find((c) => /hold|assessment/i.test(c.constraint));
    expect(hold).toBeDefined();
    expect(hold!.rationale).toMatch(/reclaim|owner/i);
  });

  it("every constraint explains itself and every vehicle says what it is for", () => {
    for (const [id] of Object.entries({ "pet-rescue": true })) {
      const pb = getPlaybook(null, null, id);
      for (const c of pb.channelConstraints ?? []) {
        expect(c.channel.length, `${id} constraint channel`).toBeGreaterThan(0);
        expect(c.rationale.length, `${id} constraint rationale`).toBeGreaterThan(0);
      }
      for (const v of pb.channelVehicles ?? []) {
        expect(v.purpose.length, `${id} vehicle purpose`).toBeGreaterThan(0);
      }
    }
  });

  it("channel policy is optional, so untouched category playbooks stay valid", () => {
    const category = getPlaybookForCategory("retail-goods");
    expect(category.channelConstraints).toBeUndefined();
    expect(category.channelVehicles).toBeUndefined();
  });
});
