import { describe, expect, it } from "vitest";
import {
  journeyFailureToAttentionItem,
  journeyUnverifiableToAttentionItem,
  journeyWhyNow,
} from "./business-journey";

const BASE = {
  issueKey: "journey-failure:storefront-booking",
  severity: "error",
  summary: "Customers can book a time with you — not working",
  firstDetectedAt: new Date("2026-07-28T06:00:00.000Z"),
};

const DETAILS = {
  journeyId: "storefront-booking",
  outcome: "Customers can book a time with you",
  businessImpact: "Customers cannot reserve a slot.",
  revenueBearing: true,
  achievedDepth: null,
  failedSteps: [{ label: "The booking page opens", detail: "The page returned 503." }],
};

describe("journeyWhyNow", () => {
  it("leads with what the business lost, then names what failed", () => {
    const why = journeyWhyNow(DETAILS);
    expect(why).toContain("Customers cannot reserve a slot.");
    expect(why).toContain("What failed: The page returned 503.");
  });

  it("always states what was not checked, so the card cannot imply full coverage", () => {
    expect(journeyWhyNow(DETAILS)).toContain("Not checked:");
    expect(journeyWhyNow({ ...DETAILS, achievedDepth: "data-path" })).toContain(
      "a customer doing this in a browser",
    );
  });

  it("degrades gracefully when details are missing", () => {
    expect(() => journeyWhyNow({})).not.toThrow();
  });
});

describe("journeyFailureToAttentionItem", () => {
  it("titles the card with the lost outcome, not the mechanism", () => {
    const item = journeyFailureToAttentionItem({ ...BASE, details: DETAILS });
    expect(item.title).toBe("Customers can book a time with you — not working");
    expect(item.title).not.toMatch(/probe|step|adapter/i);
  });

  it("deep-links to the specific journey, never a broad list", () => {
    const item = journeyFailureToAttentionItem({ ...BASE, details: DETAILS });
    expect(item.deepLink).toBe("/ops/journeys?journey=storefront-booking");
    expect(item.actions).toHaveLength(1);
    expect(item.actions[0].href).toBe("/ops/journeys?journey=storefront-booking");
  });

  it("escalates a revenue-bearing journey to high-risk", () => {
    const item = journeyFailureToAttentionItem({ ...BASE, details: DETAILS });
    expect(item.riskClass).toBe("high-risk");
  });

  it("keeps a non-revenue journey at bounded-write", () => {
    const item = journeyFailureToAttentionItem({
      ...BASE,
      severity: "warn",
      details: { ...DETAILS, revenueBearing: false },
    });
    expect(item.riskClass).toBe("bounded-write");
  });

  it("treats a broken journey as an unscorable fact, not a scored decision", () => {
    const item = journeyFailureToAttentionItem({ ...BASE, details: DETAILS });
    expect(item.decisionClass).toEqual({ scorability: "unscorable" });
    expect(item.triage.residueReason).toBe("no-self-heal");
    expect(item.triage.decideEffort).toBe("review");
  });

  it("recovers the journey id from the issue key when details are malformed", () => {
    const item = journeyFailureToAttentionItem({ ...BASE, details: "not-an-object" });
    expect(item.deepLink).toBe("/ops/journeys?journey=storefront-booking");
    expect(item.title).toBe(BASE.summary);
  });
});

// BI-04CC2090 — the could-not-check card. It must never read like the failure
// card above: same source, opposite meaning.
describe("journeyUnverifiableToAttentionItem", () => {
  const UNVERIFIABLE = {
    issueKey: "journey-unverifiable:no-public-address",
    severity: "warn",
    summary:
      "Checks cannot run — this install has no public web address set, so the pages a customer would use cannot be opened.",
    firstDetectedAt: new Date("2026-08-03T06:00:00.000Z"),
    details: {
      reason: "no-public-address",
      blockedJourneys: [
        { journeyId: "storefront-booking", outcome: "Customers can book a time with you", revenueBearing: true },
        { journeyId: "customer-sign-in", outcome: "Existing customers can sign in to their account", revenueBearing: false },
      ],
    },
  };

  it("never claims anything is not working", () => {
    const item = journeyUnverifiableToAttentionItem(UNVERIFIABLE);
    expect(item.title).toBe("Some checks could not run");
    expect(`${item.title} ${item.context}`).not.toMatch(/not working/i);
  });

  it("is never high-risk, even when it blocks a revenue-bearing journey", () => {
    // storefront-booking is revenueBearing above. A missing setting is still not
    // an outage, and ranking it with the reds is what buried the real signal.
    expect(journeyUnverifiableToAttentionItem(UNVERIFIABLE).riskClass).toBe("bounded-write");
  });

  it("names the journeys it could not check, and says so plainly", () => {
    const item = journeyUnverifiableToAttentionItem(UNVERIFIABLE);
    expect(item.context).toContain("Customers can book a time with you");
    expect(item.context).toContain("They were not tested.");
  });

  it("lands on the journeys surface, since no single journey owns the cause", () => {
    expect(journeyUnverifiableToAttentionItem(UNVERIFIABLE).deepLink).toBe("/ops/journeys");
  });

  it("survives malformed details without inventing coverage", () => {
    const item = journeyUnverifiableToAttentionItem({ ...UNVERIFIABLE, details: "garbage" });
    expect(item.title).toBe("Some checks could not run");
    expect(item.context).not.toMatch(/undefined/);
  });
});
