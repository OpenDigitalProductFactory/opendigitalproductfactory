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

// BI-09FB398D: a risk outside the change is accepted only on a platform-written
// authority the boundary resolves: bound to this room, this exact change and
// this scenario, and naming the item that owns the risk.
describe("risk acceptance needs a resolved authority, never a narrative", () => {
  const authority = {
    id: "risk-acceptance-1", kind: "risk-acceptance" as const, ...identity, status: "accepted",
    expected: "WWMD consult through the escalation gate", observed: "route-to-agent (high), DI-1",
    completedAt: "2026-11-14T10:00:00Z", scenarioKey: "stale-review", followUpReference: "PIR-OWNER",
  };
  const accepted = (residual: Record<string, unknown>) => ({
    ...analysis,
    scenarios: [{ ...analysis.scenarios[0], residualRisk: {
      owner: "platform", disposition: "accepted", rationale: "Outside this change; owned by the follow-up item", ...residual,
    } }],
  });

  it("accepts a risk whose authority resolves for this scenario and change", () => {
    const out = validateFailureAnalysis(
      accepted({ authorityEvidenceId: authority.id, followUpReference: "PIR-OWNER" }), identity, [...evidence, authority]);
    expect(out).toMatchObject({ valid: true, reasons: [] });
  });

  it("refuses an authority id that did not resolve", () => {
    const out = validateFailureAnalysis(accepted({ authorityEvidenceId: authority.id, followUpReference: "PIR-OWNER" }), identity, evidence);
    expect(out.reasons).toContain("risk-disposition-requires-authority:stale-review");
  });

  it("refuses an authority for another scenario, another change, or another owner", () => {
    for (const other of [
      { ...authority, scenarioKey: "different" },
      { ...authority, headTreeHash: "c".repeat(40) },
      { ...authority, followUpReference: "PIR-ELSEWHERE" },
    ]) {
      const out = validateFailureAnalysis(
        accepted({ authorityEvidenceId: authority.id, followUpReference: "PIR-OWNER" }), identity, [...evidence, other]);
      expect(out.valid).toBe(false);
    }
  });

  it("refuses an authority with no named owning item", () => {
    expect(validateFailureAnalysis(accepted({ authorityEvidenceId: authority.id }), identity, [...evidence, authority]).valid).toBe(false);
  });

  it("never counts an authority as verification evidence", () => {
    const citing = { ...analysis, scenarios: [{ ...analysis.scenarios[0], evidenceIds: [authority.id] }] };
    expect(validateFailureAnalysis(citing, identity, [...evidence, authority]).reasons).toContain(`unverified-evidence:${authority.id}`);
  });

  it("still refuses a blocked risk whatever authority exists", () => {
    const out = validateFailureAnalysis(
      accepted({ disposition: "blocked", authorityEvidenceId: authority.id, followUpReference: "PIR-OWNER" }), identity, [...evidence, authority]);
    expect(out.valid).toBe(false);
  });
});
