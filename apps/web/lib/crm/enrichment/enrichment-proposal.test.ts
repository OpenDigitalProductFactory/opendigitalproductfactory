import { describe, expect, it } from "vitest";

import { buildEnrichmentProposal, type BuildProposalInput } from "./enrichment-proposal";
import type { EnrichmentFinding, EnrichmentScope } from "./types";

const ACCOUNT_SCOPE: EnrichmentScope = {
  sources: ["website", "linkedin", "web-search"],
  fields: ["name", "website", "industry", "employeeCount", "location", "notes"],
};

function base(findings: EnrichmentFinding[], current: Record<string, unknown> = {}): BuildProposalInput {
  return {
    recordKind: "customer-account",
    recordId: "ACCT-1",
    current: { name: "TeamLogic IT", ...current },
    findings,
    scope: ACCOUNT_SCOPE,
  };
}

describe("enrichment proposal builder (AC3/AC5/AC6)", () => {
  it("builds a scant→enriched diff with per-field provenance (AC3/AC5)", () => {
    const proposal = buildEnrichmentProposal(
      base([
        { field: "industry", value: "Managed IT Services", source: "website", sourceRef: "https://teamlogicit.com" },
        { field: "location", value: "Round Rock, TX", source: "web-search", sourceRef: "serp:1" },
      ]),
    );
    expect(proposal.changes).toHaveLength(2);
    const industry = proposal.changes.find((c) => c.field === "industry");
    expect(industry).toMatchObject({
      current: null,
      proposed: "Managed IT Services",
      source: "website",
      sourceRef: "https://teamlogicit.com",
    });
  });

  it("corrects an incorrect scant field and shows the before value (AC5)", () => {
    const proposal = buildEnrichmentProposal(
      base(
        [{ field: "name", value: "TeamLogic IT of Round Rock", source: "website", sourceRef: "https://teamlogicit.com/rrtx" }],
        { name: "TeamLogic IT" },
      ),
    );
    const change = proposal.changes.find((c) => c.field === "name");
    expect(change).toMatchObject({ current: "TeamLogic IT", proposed: "TeamLogic IT of Round Rock" });
  });

  it("drops a masked value and surfaces it as a confirm-what's-needed gap (AC4/AC6)", () => {
    const proposal = buildEnrichmentProposal({
      recordKind: "customer-contact",
      recordId: "CT-1",
      current: { firstName: "Greg" },
      findings: [
        // masked work email — must be rejected, never written
        { field: "jobTitle", value: "j***@teamlogicit.com", source: "web-search", sourceRef: "zoominfo" },
      ],
      scope: { sources: ["web-search"], fields: ["jobTitle"] },
    });
    expect(proposal.changes).toHaveLength(0);
    expect(proposal.rejected).toHaveLength(1);
    expect(proposal.unresolvedGaps.some((g) => g.field === "jobTitle")).toBe(true);
  });

  it("enforces scope: findings outside confirmed sources/fields are ignored (AC2)", () => {
    const proposal = buildEnrichmentProposal({
      recordKind: "customer-account",
      recordId: "ACCT-1",
      current: {},
      findings: [
        { field: "industry", value: "MSP", source: "linkedin", sourceRef: "li:1" }, // source not in scope
        { field: "website", value: "https://x.com", source: "website", sourceRef: "w:1" }, // field not in scope
      ],
      scope: { sources: ["website"], fields: ["industry"] },
    });
    expect(proposal.changes).toHaveLength(0);
  });

  it("treats a finding equal to the current value as a no-op", () => {
    const proposal = buildEnrichmentProposal(
      base([{ field: "name", value: "teamlogic it", source: "website", sourceRef: "w" }], { name: "TeamLogic IT" }),
    );
    expect(proposal.changes.find((c) => c.field === "name")).toBeUndefined();
  });

  it("picks the highest-confidence finding when a field has several", () => {
    const proposal = buildEnrichmentProposal(
      base([
        { field: "industry", value: "IT", source: "web-search", sourceRef: "a", confidence: 0.4 },
        { field: "industry", value: "Managed IT Services", source: "website", sourceRef: "b", confidence: 0.9 },
      ]),
    );
    expect(proposal.changes.find((c) => c.field === "industry")?.proposed).toBe("Managed IT Services");
  });

  it("does not raise a gap for a field that already had a value", () => {
    const proposal = buildEnrichmentProposal(
      base([], { name: "TeamLogic IT", website: "https://teamlogicit.com" }),
    );
    expect(proposal.unresolvedGaps.some((g) => g.field === "website")).toBe(false);
  });
});
