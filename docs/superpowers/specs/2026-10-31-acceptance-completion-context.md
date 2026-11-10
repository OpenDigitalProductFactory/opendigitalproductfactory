---
status: active
---
# Acceptance completion context
Backlog: BI-5B0CD1BC. Workroom: WC-6D95C3A1. Status: proposed corrective design.

## Problem and observed boundary
On 2026-10-31, typed completion IRD-6F4E88CDA334 for BI-1A4CC847 issued an independent AGT-132 objective-mapping packet. Submitting the returned object unchanged was refused by request admission. The prescribed bounded read returned workroom-not-found. Evidence: BI-72CEB47A activity cmvx2pni90nca01mewrf1v621. The request is retained in the originating chat's windows-acceptance-packet-admission-repro.json.

The canonical evaluator accepts a raw completion manifest. The transition supplies it; readBacklogItemCompletion supplies undefined. Independent request admission regenerates the packet from that read. The missing delivery prerequisite prevents the archived body-author fallback. This is distinct from reviewer grants and room access, which the successful issuer route checked.

## Existing architecture and research
Extend [initiative readiness](2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md) and [proportional gates](2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md). BI-72CEB47A preserves allowed terminal decisions; this successor preserves current nonterminal evaluation. BI-F89EC5BA supplies retained body criteria and exact delivered-author recovery. BI-04140C98 excludes routing.

Inspected substrate:
- backlog-completion-evaluation.ts: shared current evaluator, read wrapper and activity selection.
- backlog-terminal-transition.ts / terminal-transition-repository.ts: serialized subject transition and existing initiative_readiness_decision audit.
- completion-evidence-policy.ts / completion-evidence-runtime.ts: normalization, evidence ownership, freshness, failures and applicability.
- independent-review-request.ts / terminal-recovery.ts: exact packet equality, independent eligibility and current content access.
- body-baseline-author-room.ts: exact provider-verified retired author identity.

This is an internal contract repair, not adoption of a new workflow framework. Existing BMAD comparison is [the recorded evaluation](../../security/tool-evaluations/2026-09-15-bmad-method.md): retain explicit artifact-bound handoffs, reject a second orchestration engine. No external dependency or new service is introduced. Kernel decision DI-A96BC6850DB1 selects retained inputs; the earlier DI-A8F2CA6D5395 had insufficient signal and is not approval.

Options rejected: inferring a manifest from an old verdict loses UX/migration rationale; forwarding a manifest through every client packet expands transport and coordination. Retained inputs are not evidence of a current pass.

## Objectives
**OBJ-1:** Issuance, reads and review admission evaluate the same current completion inputs.
**OBJ-2:** Current evidence, immutable source, scope and authority invalidate stale requests.

## Contract
Persist normalized, validated completion input context inside the existing terminal readiness audit payload; no new table, ledger, public endpoint or client packet field. Include a versioned binding to item/scope, bound shape, current baseline and exact source attempt. Retain the full explicit UX/migration classifications; never reconstruct them from pass refs. Only the authorized serialized terminal path can publish context.

Reads may use only the newest applicable terminal attempt, validated against current binding; malformed, absent, conflicting or stale latest context does not fall back to an older passing attempt. Explicit caller input takes precedence, including invalid input. The shared evaluator always reruns completion-evidence policy, freshness/ownership/failure checks and objective reconciliation. Current source and scope changes invalidate retained context; changed evidence and access remain checked by their existing owners.

The issuer and request admission reuse the same current evaluation. Existing independent identity, room access, exact packet equality, original-task recovery and writer protections remain unchanged. No auto-dispatch, cached allowed verdict, fabricated receipt or UNKNOWN replay. Legacy rows without context keep existing missing-manifest behavior until an authorized fresh terminal attempt records context.

## Acceptance
| ID | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | Reproduce the real offered-packet to request-admission mismatch before fixing it. |
| AC-2 | OBJ-1 | An unchanged eligible server-issued packet survives current request admission. |
| AC-3 | OBJ-1 | Ordinary and bounded recovery use the same current completion context. |
| AC-4 | OBJ-2 | Evidence deletion/failure, baseline/source/scope changes and revoked access or independence fail closed. |
| AC-5 | OBJ-2 | Missing/malformed/latest invalid context cannot revive an older pass. |
| AC-6 | OBJ-1, OBJ-2 | Affected regression tests, typecheck and governed checks pass; deployed exercise is reported separately. |

## Scope, compatibility and risks
No UI styling or navigation changes; recovery text and behavior must identify the actual prerequisite. No schema migration. Existing JSON audit payload readers ignore the additive context field; rollback loses recovery but gains no authority. Revert the one corrective PR to roll back. New context must not reach logs with credential material; only existing manifest IDs/applicability and source/scope bindings are retained.

Implementation limits reuse to awaiting-acceptance, delivery-medium items with an item-body document baseline and a full source identity. Context is at most 32 KB, inherits the existing audit row lifecycle, and is removed from the public recent-activity projection. No new query index, model, retention policy or backfill is introduced. The data-impact guard classifies none of its schema/projection/lifecycle surfaces as changed. Existing operator instructions remain valid: submit typed completion, then use its offered review request. This repairs that promised flow without a new operator action; no additional user-guide procedure is needed.

Shared context normalization and resolution is the relevant refactoring allocation (approximately 20% of effort under the user's explicit direction). Do not duplicate evaluation across the issuer and validator. Use bounded reads and stable ordering. Races must fail through existing source/current-state checks; inspect whether a source/context read needs an existing transaction fence.

This does not block independent packaging/Critic release. It does not repair BI-CAP-437F7745 identity or BI-56E9CEC2 role configuration. Funding is bound to the existing owner-approved shared-platform scope (Workroom binding recorded 2026-11-01T00:30:12.245Z, policy revision 2363f731-0df4-4058-8cd2-ff126a37600b). Its cumulative 80/20 repair/new-capability policy is distinct from this task's 20% relevant code-refactoring target; no budget or provider spending authority is added by this design.
