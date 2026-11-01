---
status: draft
---

# Preserve Responses request semantics — BI-E78253FF

Design: docs/superpowers/specs/2026-10-31-responses-contract-preservation-design.md.
Historical evidence: BI-EFA3869E / PR5520; current source regression cmvx218cf4f3r01pndtrpj4nh. Historical completion remains unchanged.

**For agentic workers:** execute this plan one independently reviewable backlog item at a time. Use dpf-tdd for red-green implementation, dpf-local-merge-ci-before-push for governed verification, and dpf-pr-with-dco for protected publication.

## Acceptance and contracts

- AC-CONTRACT: A named unsupported required field receives one classified provider rejection without deleting the field and retrying.
- AC-OPTIONAL: An unsupported temperature setting may be removed for one retry, with every remaining field identical.
- AC-CHATGPT: The ChatGPT backend continues to omit temperature before its first request.
- AC-DELIVERY: Affected tests, TypeScript checks, independent source assessment and governed integration qualify the correction before protected publication.

CT-REQUEST-SEMANTICS: required tools, instructions, input/model, storage policy, output bounds, reasoning and conversation identity are preserved.
CT-OPTIONAL-RETRY: only temperature may be removed, for at most one retry, without changing any other serialized field.
FLOW-REJECT: required-field HTTP400 follows existing provider-error classification.
FLOW-OPTIONAL: optional-temperature HTTP400 follows the existing bounded compatibility retry.
VERIFY-REGRESSION: protected-field table cases fail before implementation and pass afterward.
VERIFY-CONTROL: complete serialized-body equality and returned synthetic tool call prove compatibility control.
VERIFY-INTEGRATION: affected tests, both TypeScript programs, impact obligations and canonical integration qualify the exact source.

## Execution

1. After the preceding quota PR releases its frozen publication pin, refresh protected main through the existing safe procedure. Claim the corrective item in the existing session worktree using its live delivery classification; bind the exact source and claim the two adapter paths plus these design/plan paths. Resolve actual changeImpactContract and incorporate testImpact/guardObligation here; unresolved selection means exhaustive verification, not exemption. No source implementation before native readiness and immutable coverage.
2. Commit this proportional design/plan and record current live atomic backlog coverage. The contract correction and its regressions are one independently revertible deliverable; no extra child item or substrate is needed. Preserve the old broad-retry acceptance as history and explicitly replace it for this successor with optional-only retry.
3. Add regression cases in apps/web/lib/routing/responses-adapter.test.ts without changing the production adapter. Execute that actual test file and record the observed failing cases. Do not commit a deliberately failing intermediate publication.
4. Change only the narrowing predicate/comment in apps/web/lib/routing/responses-adapter.ts. Run the same file green, inspect the complete diff and run both web TypeScript programs plus selected mandatory checks. The optional control must compare the entire request body minus temperature and return an actual-shaped function call.
5. Freeze the DCO-signed correction and obtain independent exact-source assessment. Use the established governed verification path, with the actual executor identity and lease, full metadata and real results. Preserve unrelated old inconclusive receipts; never rename a failed/unknown execution or mint a replacement nonce to evade it.
6. Publish through a regular ready PR after pr:ready, protected checks, pr:health and merge queue. Coordinate canonical deployment with the existing sole release owner; do not create a competing upgrade. After material deployment, use one separately admitted fresh live acceptance check when authorized and eligible. Do not replay original uncertain executions or report this source regression as their proven cause.

## Risk and rollback

A provider that rejects a required field now reports an error instead of producing degraded work. Optional-temperature handling stays compatible. No schema, migration, credential, provider, model-grade, floor, grant, private reader or UI change is included. Roll back through a protected revert if needed; retain original execution/evidence identities.

## Backlog coverage

Atomic deliverable: Preserve required Responses request fields, mapped to BI-E78253FF.
requirementRefs: AC-CONTRACT, AC-OPTIONAL, AC-CHATGPT, AC-DELIVERY.
contractRefs: CT-REQUEST-SEMANTICS, CT-OPTIONAL-RETRY.
flowRefs: FLOW-REJECT, FLOW-OPTIONAL.
verificationRefs: VERIFY-REGRESSION, VERIFY-CONTROL, VERIFY-INTEGRATION.
Native immutable coverage is pending publication of this plan; this prepared artifact is not coverage or implementation authorization.

## Start-of-work verification impact

Workroom WC-5EC02776 resolved the four claimed paths before implementation. The current source graph is ready and returns two exact tests: apps/web/lib/routing/responses-adapter.test.ts and apps/web/lib/inference/ai-inference.reassessment.test.ts. Execute both before handoff. The adapter test is the first-Red target. The resolved guard obligation is node scripts/check-style-drift.mjs. The derived-artifact check is node scripts/gen-doc-index.mjs --check; claim a real derived change before writing it. The worktree dependency probe reports compile-ready with repository-pinned pnpm10.33.2, no ignored builds or stale workspace links. Both web TypeScript programs and the governed integration/publication gates remain required. No standalone replay of the original source84be host preflight is authorized.
