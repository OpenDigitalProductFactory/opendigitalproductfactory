---
backlog: BI-CAP-371D70E7
workroom: WC-5F4E82AD
status: active
---

# Reconcile audited development review exceptions

An operator-authorized source publication can leave its Workroom unable to advance because the server recognizes only a native failure-analysis pass. Reuse the existing semantic-review exemption contract and ExternalEvidenceRecord store to give local publication and server readiness an honest, bounded exception path.

## Design grounding

Extend the shared-change-reviewer control design (2026-07-27), evidenced failure recovery plan (2026-09-06), and delegated DEV maintenance design (2026-10-11). Existing exemption types have no canonical writer on main. Ordinary review and evidence calls must retain their existing authority behavior; a separate authority action records the exemption without running a model or claiming a review pass.

The writer checks the canonical development/evolve-dpf installation, authenticated operator capability, delegated human approval, current Workroom source identity, verification evidence, and a cited client assessment. The approving operator explicitly accepts that the assessment's independent execution is unverified. The record distinguishes requester, source executor, and actual recorded assessment producer. Neither requester identity nor a different Workroom proves source authorship or reviewer independence. The server rechecks bindings and rejects changed evidence, expired exceptions, cross-room target mismatch, or any failure on the exact revision. Local caches preserve native review UNRUN and assessment independence UNVERIFIED.

Actual product failures, grants, confidential-data controls, DCO, protected CI, production operations and merge protection remain governed by their existing authorities. An exception is a publication decision, never a failure-analysis verdict or executed test pass.

## Implementation and verification

1. Add failing tests for canonical exception acceptance, explicit assurance acceptance, stale, expired, revoked, failed-review and production refusal.
2. Implement a small helper and writer in the existing change-review pack; reuse canonical installation identity and human approval.
3. Resolve the same exception at Workroom publication and export its exact identity to the existing local cache.
4. Run affected tests, web types, source guards and generated-artifact checks, then DCO-sign and publish a ready PR through normal protection.
5. The existing release coordinator advances the runtime. Verify actual Workroom readiness after deployment and preserve native review UNRUN.

Scope: this slice reconciles native-review infrastructure exceptions. Nonpassing local-CI diagnostics retain their original status. Structured Workroom test evidence can establish passing source checks with the full gate explicitly UNRUN; narration alone cannot. The existing pre-push CI exception and protected cloud CI retain their own controls.

## Evidence contract

`record_semantic_review_exemption` accepts the Workroom, exact SHA/base tree/head tree/diff digest, reason, expiry within 24 hours, `verificationEvidenceId`, `clientAssessmentActivityId`, and mandatory `reviewBasis: operator-accepted-client-assessment`. This is an operator policy waiver with an explicit assurance limit, not a certified independent review. Authenticated operators require platform management capability. Delegates reuse the existing exact approved authority envelope; its fingerprint binds this basis and all evidence references. The writer accepts no approval ID in arguments. Consumption rejects revoked envelopes and re-resolves evidence rather than trusting the original digest alone.

Verification references either fresh governed `local_integration_ci` evidence or an existing Workroom `test` activity whose result has `tier: source-local-checks`, `status: passed`, `sourceHeadSha`, `headTreeHash`, `diffDigest`, actual `commands`, `output`, `completedAt`, `expiresAt`, and `fullGateStatus: UNRUN`. The latter is explicitly client-reported source verification. A Workroom `decision-record` supplies the cited assessment, rationale and the same SHA/tree/digest; cross-room assessments also name the target `capsuleId`. Preserve its actual recorded user and agent, and keep its room's executor separate. These records do not certify independence or substitute for native receipts. A trusted source-author/reviewer producer bridge is a separate follow-up; do not infer it from room labels or create a new ledger here.

The canonical writer returns an exemption and evidence ID. `node scripts/semantic-review-gate.mjs record-exemption --receipt-file <canonical-result.json>` captures it in the existing local sidecar. Both consumers report policy exemption, native review UNRUN, and assessment independence UNVERIFIED. Local files do not confer server authority. Exact-head failure lookup is separate from the bounded receipt history, so twenty newer unrelated reviews cannot hide a failure.
