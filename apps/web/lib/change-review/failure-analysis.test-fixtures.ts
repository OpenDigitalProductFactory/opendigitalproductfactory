import type { FailureAnalysisIdentity } from "./failure-analysis";

export function failureAnalysisFixture(identity: FailureAnalysisIdentity) {
  const binding = { capsuleId: identity.capsuleId, headTreeHash: identity.headTreeHash, diffDigest: identity.diffDigest };
  return {
    failureAnalysis: {
      schemaVersion: 1 as const, ...binding,
      design: { reference: `docs/design.md@${"e".repeat(40)}`, analysis: "Stale receipts could release a broken donor contribution workflow." },
      scope: "Protect the donor contribution workflow from unverified changes.",
      affectedPeople: "Donors and program coordinators depend on contribution processing.",
      invariants: "Only evidence for the final change may permit publication.",
      boundaries: "The author submits analysis; the independent reviewer challenges it.",
      eliminated: [], noEliminationRationale: "This change contains the failure rather than eliminating its trigger.",
      scenarios: [{ key: "stale-review", trigger: "A prior change's verification is reused", effect: "Donors cannot complete contributions after a payment regression",
        severity: "high" as const, exposure: "Every donor using the changed contribution workflow is exposed.",
        prevention: "Compare immutable review and evidence identities", containment: "Stop publication before changes reach users",
        detection: "Report the mismatched evidence reference", recovery: "Verify the current change and request review again", evidenceIds: ["executed-test"],
        residualRisk: { owner: "release-engineer", disposition: "mitigated" as const, rationale: "Independent review challenges scenarios omitted from this analysis" } }],
    },
    resolvedFailureEvidence: [{ id: "executed-test", ...binding, status: "passed", expected: "Stale evidence stops publication",
      observed: "The changed identity was rejected", completedAt: "2026-09-08T10:00:00Z" }],
  };
}
