import { describe, expect, it } from "vitest";
import {
  BUSINESS_ACTIVITIES,
  ambiguousActivities,
  deriveActivity,
  seedsForActivity,
} from "./archetype-activities";
import {
  STANCE_VECTOR_ACTIVITY,
  resolveStanceVectors,
  seededStanceVectorKeys,
} from "./archetype-business-context";

/**
 * BI-0902BAE9. Six field-service questions — employee location, evidence
 * photos, lawful basis — reached the owner of a SOFTWARE-PLATFORM install and
 * sat unanswerable, because that archetype has none of the underlying activity.
 * The activity decides whether the question exists, and the activity is
 * derived: asking a trades business whether its people visit customers is a
 * tax, not a gate.
 */
describe("deriving what a business does from its archetype", () => {
  it("takes on-site work as given for a trade whose work is at the customer's place", () => {
    const d = deriveActivity({ industry: "trades-maintenance", activity: "workers-at-customer-sites" });
    expect(d.confidence).toBe("certain");
    expect(d.because).toMatch(/taken as given rather than asked/i);
  });

  it("derives nothing for an archetype with no such activity", () => {
    for (const activity of BUSINESS_ACTIVITIES) {
      expect(deriveActivity({ industry: "software-platform", activity }).confidence).toBe("absent");
    }
  });

  it("assumes nothing about an archetype it has never characterised", () => {
    // Silence means no: an unknown business is not assumed to send people out.
    expect(
      deriveActivity({ industry: "no-such-industry", activity: "workers-at-customer-sites" }).confidence,
    ).toBe("absent");
    expect(deriveActivity({ industry: null, activity: "evidence-media-capture" }).confidence).toBe("absent");
  });

  it("marks the genuinely mixed trades ambiguous rather than guessing", () => {
    expect(ambiguousActivities({ industry: "professional-services" })).toContain("workers-at-customer-sites");
    expect(ambiguousActivities({ industry: "software-platform" })).toEqual([]);
  });

  it("knows the defining third-party case: residents are not the customer", () => {
    expect(
      deriveActivity({ industry: "hoa-property-management", activity: "third-party-personal-data" }).confidence,
    ).toBe("certain");
  });

  it("seeds on certain and on ambiguous, never on absent", () => {
    // A mixed business is better served by an editable default than by silence;
    // the cost of an unneeded card is one card, the cost of a missing stance is
    // an unanswerable escalation.
    expect(seedsForActivity("certain")).toBe(true);
    expect(seedsForActivity("ambiguous")).toBe(true);
    expect(seedsForActivity("absent")).toBe(false);
  });
});

describe("which stances an install is seeded", () => {
  it("never hands a software platform a worker-location posture", () => {
    expect(seededStanceVectorKeys({ industry: "software-platform" })).not.toContain("on-site-work-conduct");
  });

  it("gives a trades business one without asking whether its people travel", () => {
    expect(seededStanceVectorKeys({ industry: "trades-maintenance" })).toContain("on-site-work-conduct");
  });

  it("seeds every universal vector for both, so gating removes nothing else", () => {
    const universal = Object.entries(STANCE_VECTOR_ACTIVITY).length;
    expect(universal).toBeGreaterThan(0);
    const platform = seededStanceVectorKeys({ industry: "software-platform" });
    const trades = seededStanceVectorKeys({ industry: "trades-maintenance" });
    for (const key of platform) expect(trades).toContain(key);
    expect(trades.length).toBe(platform.length + 1);
  });

  it("words the on-site stance in the trade's own terms, not one paraphrase", () => {
    const trades = resolveStanceVectors({ industry: "trades-maintenance" })["on-site-work-conduct"];
    const hoa = resolveStanceVectors({ industry: "hoa-property-management" })["on-site-work-conduct"];
    const care = resolveStanceVectors({ industry: "healthcare-wellness" })["on-site-work-conduct"];
    expect(trades.stance).not.toBe(hoa.stance);
    expect(hoa.stance).not.toBe(care.stance);
    expect(trades.stance).toMatch(/home/i);
    expect(hoa.stance).toMatch(/resident/i);
    expect(care.stance).toMatch(/clinician|care/i);
  });

  it("keeps a non-commercial archetype free of commercial vocabulary", () => {
    const np = resolveStanceVectors({ industry: "nonprofit-community" })["on-site-work-conduct"];
    expect(`${np.title} ${np.stance}`).not.toMatch(/\bcustomer\b/i);
    expect(np.stance).toMatch(/someone we serve|programme/i);
  });
});
