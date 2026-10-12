---
backlog: BI-CAP-371D70E7
workroom: WC-5F4E82AD
status: active
---

# Reconcile audited development review exceptions

An operator-authorized source publication can leave its Workroom unable to advance because the server recognizes only a native failure-analysis pass. Reuse the existing semantic-review exemption contract and ExternalEvidenceRecord store to give local publication and server readiness an honest, bounded exception path.

## Design grounding

Extend the shared-change-reviewer control design (2026-07-27), evidenced failure recovery plan (2026-09-06), and delegated DEV maintenance design (2026-10-11). Existing exemption types have no canonical writer on main. Ordinary review and evidence calls must retain their existing authority behavior; a separate authority action records the exemption without running a model or claiming a review pass.

The writer checks the canonical development/evolve-dpf installation, authenticated operator capability, delegated human approval, current Workroom source identity, executed evidence, and an independent review record. It records actor, approving operator, source and evidence bindings, reason, and expiry. The server rechecks those bindings and rejects changed evidence, expired exceptions, cross-room reuse, or a current semantic failure. Local caches preserve the exception disposition and native review UNRUN.

Actual product failures, grants, confidential-data controls, DCO, protected CI, production operations and merge protection remain governed by their existing authorities. An exception is a publication decision, never a failure-analysis verdict or executed test pass.

## Implementation and verification

1. Add failing tests for canonical exception acceptance and stale, expired, forged, failed-review and production refusal.
2. Implement a small helper and writer in the existing change-review pack; reuse canonical installation identity and human approval.
3. Resolve the same exception at Workroom publication and export its exact identity to the existing local cache.
4. Run affected tests, web types, source guards and generated-artifact checks, then DCO-sign and publish a ready PR through normal protection.
5. The existing release coordinator advances the runtime. Verify actual Workroom readiness after deployment and preserve native review UNRUN.

Scope: this slice reconciles native-review infrastructure exceptions. Nonpassing local-CI diagnostics retain their original status. Structured Workroom test evidence can establish passing source checks with the full gate explicitly UNRUN; narration alone cannot. The existing pre-push CI exception and protected cloud CI retain their own controls.

## Evidence contract

`record_semantic_review_exemption` accepts the Workroom, exact SHA/base tree/head tree/diff digest, reason, expiry within 24 hours, `verificationEvidenceId`, and `independentReviewActivityId`. Authenticated operators require platform management capability. Delegates reuse the existing exact approved authority envelope; the writer does not accept approval IDs in arguments. Consumption rejects revoked envelopes and re-resolves evidence rather than trusting the original digest alone.

Verification references either fresh governed `local_integration_ci` evidence or an existing Workroom `test` activity whose result has `tier: source-local-checks`, `status: passed`, `sourceHeadSha`, `headTreeHash`, `diffDigest`, actual `commands`, `output`, `completedAt`, `expiresAt`, and `fullGateStatus: UNRUN`. The latter proves those source checks only. The separate reviewer writes a Workroom `decision-record` with a passing assessment, rationale and the same SHA/tree/digest. A different recorded agent establishes separation; external chats sharing an agent must use distinct recorded Workroom executors. Cross-room assessments also name the target `capsuleId`. The exception records which basis established separation, not a cryptographic assertion of independent thought. Neither record is a native review receipt.

The canonical writer returns an exemption and evidence ID. `node scripts/semantic-review-gate.mjs record-exemption --receipt-file <canonical-result.json>` captures it in the existing local sidecar. The local validator reports `policy-exemption; native review UNRUN`; the server independently checks the canonical records at promotion. Local files do not confer server authority.
