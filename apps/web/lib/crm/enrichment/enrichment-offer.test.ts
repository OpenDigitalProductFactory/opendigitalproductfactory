import { describe, expect, it } from "vitest";

import { resolveProactivityPlan } from "@/lib/proactivity/proactivity-resolver";
import { resolveProactivityPlanForLevel } from "@/lib/proactivity/proactivity-resolver";
import { buildEnrichmentOffer } from "./enrichment-offer";
import { scoreAccountCompleteness, scoreContactCompleteness } from "./completeness";

const THIN = scoreAccountCompleteness({ name: "TeamLogic IT" });
const COMPLETE = scoreAccountCompleteness({
  name: "TeamLogic IT of Round Rock",
  website: "https://teamlogicit.com/rrtx",
  industry: "Managed IT Services",
  employeeCount: 12,
  location: "Round Rock, TX",
  notes: "MSP",
});

function plan(level: "quiet" | "balanced" | "assertive") {
  return resolveProactivityPlanForLevel({ activityFamily: "crm-record-enrichment" }, level);
}

describe("enrichment offer — proactivity binding (AC1/AC8)", () => {
  it("offers on a thin record at balanced", () => {
    const offer = buildEnrichmentOffer({
      recordKind: "customer-account",
      recordId: "ACCT-1",
      recordLabel: "TeamLogic IT",
      completeness: THIN,
      plan: plan("balanced"),
    });
    expect(offer).not.toBeNull();
    expect(offer?.proposedFields).toContain("industry");
    expect(offer?.proposedSources).toContain("website");
    expect(offer?.message).toMatch(/want me to/i);
  });

  it("is SILENT at quiet (AC1 — silent at quiet, AC8 — level binds)", () => {
    const offer = buildEnrichmentOffer({
      recordKind: "customer-account",
      recordId: "ACCT-1",
      recordLabel: "TeamLogic IT",
      completeness: THIN,
      plan: plan("quiet"),
    });
    expect(offer).toBeNull();
  });

  it("offers more eagerly context still gated — assertive still returns an offer", () => {
    const offer = buildEnrichmentOffer({
      recordKind: "customer-account",
      recordId: "ACCT-1",
      recordLabel: "TeamLogic IT",
      completeness: THIN,
      plan: plan("assertive"),
    });
    expect(offer).not.toBeNull();
  });

  it("never offers on an already-complete record, at any level", () => {
    for (const level of ["balanced", "assertive"] as const) {
      const offer = buildEnrichmentOffer({
        recordKind: "customer-account",
        recordId: "ACCT-1",
        recordLabel: "TeamLogic IT of Round Rock",
        completeness: COMPLETE,
        plan: plan(level),
      });
      expect(offer).toBeNull();
    }
  });

  it("a contact offer targets linkedin + web-search (no own website)", () => {
    const contactThin = scoreContactCompleteness({ firstName: "Greg" });
    const offer = buildEnrichmentOffer({
      recordKind: "customer-contact",
      recordId: "CT-1",
      recordLabel: "Greg Torosian",
      completeness: contactThin,
      plan: plan("balanced"),
    });
    expect(offer?.proposedSources).toEqual(["linkedin", "web-search"]);
  });

  it("the default resolver puts crm-record-enrichment at balanced (offers by default)", () => {
    const p = resolveProactivityPlan({ activityFamily: "crm-record-enrichment" });
    expect(p.resolvedLevel).toBe("balanced");
    expect(p.actionBoundary).toBe("propose");
  });
});
