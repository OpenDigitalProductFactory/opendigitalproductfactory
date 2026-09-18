import { describe, expect, it } from "vitest";
import { validateFailureAnalysis } from "./failure-analysis";

const identity = { capsuleId: "room", headTreeHash: "a".repeat(40), diffDigest: "b".repeat(64) };
const evidence = [{ id: "test-run", ...identity, status: "passed", expected: "Stale review blocks delivery", observed: "Stale review rejected", completedAt: "2026-09-08T10:00:00Z" }];
const analysis = {
  schemaVersion: 1, ...identity,
  design: { reference: `docs/design.md@${"e".repeat(40)}`, analysis: "A missing review could let a donor payment regression ship." },
  scope: "Shared review protects donor payment and animal care workflows.",
  affectedPeople: "Donors and rescue coordinators depend on these workflows.",
  invariants: "Only current executed verification may satisfy publication.",
  boundaries: "Evidence producers and independent reviewers retain separate authority.",
  eliminated: [{ opportunity: "Reusing evidence from another change", mechanism: "Compare the immutable diff and tree identity", evidenceIds: ["test-run"] }],
  scenarios: [{ key: "stale-review", severity: "high", exposure: "Every donor using the changed contribution workflow is exposed.", trigger: "Evidence belongs to the previous change", effect: "Donors cannot complete contributions after a payment regression ships", prevention: "Bind evidence to final change", containment: "Stop promotion before changes reach users", detection: "Report stale evidence at the gate", recovery: "Run verification on the current change and retry", evidenceIds: ["test-run"], residualRisk: { owner: "release-engineer", disposition: "mitigated", rationale: "The identity check blocks stale receipts; independent review still challenges omitted scenarios" } }],
};

describe("mandatory failure analysis", () => {
  it("accepts a concrete analysis with final-change evidence", () => {
    expect(validateFailureAnalysis(analysis, identity, evidence).valid).toBe(true);
  });
  it.each([undefined, {}, { ...analysis, scenarios: [] }, { ...analysis, scope: "checked" }])("rejects missing or empty analysis", value => {
    expect(validateFailureAnalysis(value, identity, evidence).valid).toBe(false);
  });
  it("rejects missing and stale evidence rather than assurances", () => {
    expect(validateFailureAnalysis(analysis, identity, []).valid).toBe(false);
    expect(validateFailureAnalysis(analysis, identity, [{ ...evidence[0], headTreeHash: "c".repeat(40) }]).valid).toBe(false);
  });
  it("does not equate skipped or inconclusive verification with passing", () => {
    for (const status of ["skipped", "inconclusive", "failed"]) {
      expect(validateFailureAnalysis(analysis, identity, [{ ...evidence[0], status }]).valid).toBe(false);
    }
  });
  it("changes its digest when an observed result changes", () => {
    expect(validateFailureAnalysis(analysis, identity, evidence).digest).not.toBe(
      validateFailureAnalysis(analysis, identity, [{ ...evidence[0], observed: "Stale review rejected before inference" }]).digest);
  });
  it("rejects unbounded zero-risk claims", () => {
    expect(validateFailureAnalysis({ ...analysis, scope: "Every possible failure has been eliminated" }, identity, evidence).valid).toBe(false);
  });
  it("does not let a named owner impersonate risk acceptance", () => {
    const scenario = { ...analysis.scenarios[0], residualRisk: { owner: "director", disposition: "accepted", rationale: "The director accepts this risk" } };
    expect(validateFailureAnalysis({ ...analysis, scenarios: [scenario] }, identity, evidence).valid).toBe(false);
  });
});
