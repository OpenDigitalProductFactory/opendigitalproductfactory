/**
 * BI-F5344F65. `scripts/gate-worktree.mjs` run with DPF_ALLOW_LOCAL_CI_STUB=1
 * builds nothing, yet walks the whole pass path under a real lease and reports
 * status "passed". Since BI-53B189C8 it marks that payload `evidence.testStub:
 * true`; `isTestStubGateRecord` in scripts/lib/local-ci-gate-state.mjs is the
 * same mark on the gate's local record.
 *
 * A stub run measured nothing, so the portal keeps none of it: no evidence row a
 * PR could cite as Local-CI-Evidence, no pool-policy change, no builder
 * calibration. The refusal is named so the gate fails closed instead of holding
 * a PASS nobody built.
 */
export const TEST_STUB_EVIDENCE_REFUSED = "test_stub_evidence_refused";

export const TEST_STUB_EVIDENCE_REFUSED_MESSAGE =
  "This local-CI result came from the DPF_ALLOW_LOCAL_CI_STUB=1 test stub, which builds nothing. "
  + "It is not recorded as evidence. Run the real gate: pnpm run pregate";

export function isTestStubLocalIntegrationEvidence(evidence: unknown): boolean {
  return typeof evidence === "object"
    && evidence !== null
    && !Array.isArray(evidence)
    && (evidence as Record<string, unknown>).testStub === true;
}
