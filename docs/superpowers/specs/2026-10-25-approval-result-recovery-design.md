---
status: draft
---
# Recorded approval failure recovery
Backlog: BI-A83A4188. Workroom: WC-B7FF346F.
Extends [approval cards and authorization](2026-09-01-approval-cards-recommendation-versus-authorization-design.md), especially its recorded failed-outcome contract.

## Problem and evidence
On canonical d2f21e69d6ee, an approved failed handoff result exposes a truthful terminal label but only an ID, timestamp and self-link. The original execution carries the typed refusal `handoff-transaction-required`. Native readback confirms the original human, assistant and input digest, with direct-call thread attribution explicitly unrecorded. The current store selects only status receipts. This is a presentation gap, not a diagnosis of the handoff writer. The existing approved request must never be run to recover its evidence.

## Research and existing architecture
Reuse `ApprovalOutcome`, `approval-outcome-store.ts`, `ApprovalOutcomeHistory` and `approval-action-evidence.ts`. The existing provider-test reader already bounds execution selection, rejects ambiguity, proves the exact input fingerprint and actor, excludes parked requests and status audits, and preserves unknowns. Extract those predicates once; retain provider-test behavior through characterization tests.
The earlier canonical approval design supplies the comparable-system research for saved outcomes and preconditions; this repair adopts no dependency or external retry policy. Its research is the source predicate and live persisted reproduction above.
The reviewed UX alternatives are typed explanation in the existing card, generic status only, and raw-payload disclosure. WWMD DI-D71AABE80783 selects the first. Raw messages and arguments remain private. The interactive prototype was authored before this design; browser inspection of its file URL was refused and is not visual acceptance. Advisory UX engagement CE-D6FFE189 is requested, not a gate receipt.

## Objectives
**OBJ-APR-1:** An operator can identify a proven failure and reach its authorized inspection context without reconstructing it in a chat.
**OBJ-APR-2:** Owner UI and caller-scoped tools share truthful bounded evidence without changing execution authority.
**OBJ-APR-3:** Missing, ambiguous or contradictory evidence stays unproven.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-1 | OBJ-APR-1 | Explain the original recorded handoff refusal while retaining authorization and execution as separate facts. |
| AC-2 | OBJ-APR-2 | Owner Inbox, exact status API and caller-scoped MCP use the same safe projection without raw payloads. |
| AC-3 | OBJ-APR-1, OBJ-APR-2 | Show the original room inspection link only after bound input and current reader access are proven. |
| AC-4 | OBJ-APR-2, OBJ-APR-3 | Unknown, conflicting and unsupported outcomes never confer retry or approval authority. |
| AC-5 | OBJ-APR-2, OBJ-APR-3 | Preserve provider-test evidence, actor/input fences and waiting/result routing through meaningful regression tests. |
| AC-6 | OBJ-APR-1, OBJ-APR-2, OBJ-APR-3 | Repeat the baseline scenarios on the deployed revision and separate source, deployment and effectiveness evidence. |

## Contract and flow
CT-APR-BOUND-EXEC is the existing bounded execution-evidence contract, consolidated in the current evidence module. It validates the saved binding before selecting at most eleven records, admits exactly one actual execution, validates actor, tool, time and input identity, and never treats a status receipt as an operation.
CT-APR-READ is the existing owner/user-and-assistant outcome reader. It exposes only a safe failure classification and evidence locator. A known reason is a tool-specific allowlist; an arbitrary error string cannot become UI text. A missing or ambiguous operation produces explicit unproven evidence. Only the failed recorded state is enriched; an approved or unknown record is never promoted to a failure.
CT-APR-PRESENT is the existing themed, localized result card. It leads with status and a brief recorded explanation. Inspection navigation has no execution effect. Identifiers stay in its existing disclosure.
FLOW-APR-READ: authenticate the reader, select the owned envelope, resolve bounded original evidence, project safe typed facts, revalidate room visibility if a bound locator exists, and render the same projection through current UI/API/MCP adapters.
A room link uses existing case-key/route helpers and current room admission. Read failure or revoked access suppresses the destination. It must not expose foreign room metadata.

## Boundaries, compatibility and rollback
No table, migration, grant, credential, approval engine, scheduler, retry endpoint or execution writer changes. Existing action-specific policy, approval expiry, DCO and PR protection remain.
Additional outcome fields are additive. Existing provider-account action evidence keeps its public shape and semantics. No historical record is rewritten. Rollback is one protected source revert; it removes richer explanation without changing saved decisions.
The raw internal evidence object remains server-only. No consumer receives messages, arguments, credentials or arbitrary result fields.

## Runtime reconciliation result readback (BI-08B1B79B)

This successor extends the same recorded-result contracts. It does not reopen
BI-A83A4188 or change approval or runtime execution policy. D6
BI-0282088D retains its original incomplete runtime acceptance.

On November 14 the coordinator's original image-only request reported an
authorized but failed approval, while both evidence readers returned
`operation-unsupported`. Source `6b9dc5c` supports provider tests and one handoff
refusal only. An absent local journal is not proof that nothing happened.
Normal DESIGN admission is IRD-A00D9C0EFD55 / WC-7F3ECF54. The item retains its
unresolved funding warning; the original D6 binding is not transferred.

The existing typed projection selected by DI-D71AABE80783 remains the design.
A generic raw-result panel would expose private data. A new transition/history
tool would duplicate the owned-envelope boundary. Instead, reuse the exact
bound execution selector, then admit a runtime-specific safe observation.

**OBJ-ARR-1:** The owner and their currently admitted assistant can inspect the
original runtime reconciliation without replaying it.
**OBJ-ARR-2:** Approval, recorded operation result, durable transition and
verified host receipt remain separate facts; missing proof stays unverified.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-ARR-1 | OBJ-ARR-1 | Existing owner Inbox, exact API and caller-scoped MCP share the original reconcile-runtime evidence without raw arguments, errors or receipt payloads. |
| AC-ARR-2 | OBJ-ARR-1, OBJ-ARR-2 | Original envelope, human, assistant, input digest, tool, thread and unique actual-execution fences remain; status receipts cannot shadow the operation. |
| AC-ARR-3 | OBJ-ARR-2 | An exact transition read additionally checks current platform read authority, requested owner and the complete original request binding; it never selects the latest transition. |
| AC-ARR-4 | OBJ-ARR-2 | Only closed known operation codes receive explanations. A failed approval, absent row, unsigned file absence or unverified receipt never establishes no effects, success, restoration or retry authority. |
| AC-ARR-5 | OBJ-ARR-1, OBJ-ARR-2 | Provider and handoff behavior remains compatible; meaningful regressions cover identity drift, ambiguity, unsafe payloads, missing/conflicting transition and receipt proof. |
| AC-ARR-6 | OBJ-ARR-1, OBJ-ARR-2 | Record protected source delivery separately from deployment and actual owner saved-result/reload verification; retain the original action uncertainty until its own proof resolves it. |

CT-ARR-READ extends CT-APR-BOUND-EXEC/READ/PRESENT. The original operation may
report a closed status or allowlisted refusal even when host proof is missing.
The runtime observation reads only the exact bound transition under current
`manage_platform` authority. It checks `requestedById`, original reconciliation
baselines/intent and image-service selection before projecting a closed recorded
status. No row, unavailable access or contradictory binding stays explicit.
No current live-host inventory is substituted for the original result.

A stored host receipt is verified with the existing historical transition
validator, matching signed envelope and original request. Missing or rotated
verification material, malformed or partial receipts remain unverified. Reading
this evidence never calls the executor, startup reconciler, compensation,
approval writer or Docker. Recorded recovery-required state is disclosed as a
recorded requirement, never a completed restoration. No raw failure, signature,
secret, host path or private execution data crosses this boundary.

The existing result card uses short localized copy and its existing technical
disclosure. It adds no retry/authorize control and no new destination. Schema,
migrations, credentials, grants, host services and original records are unchanged.
Rollback is a protected source revert, with no data rewrite.

## Ownership and investment
BI-AFEAAA76 and BI-130120F1 are delivered predecessors. BI-038AA4BC retains broader consequence-first presentation. BI-E458A9CB owns unchanged retry parking; BI-035BE8D1 owns pre-approval preconditions; retired BI-FA22D90B did not diagnose Inbox presentation. This repair does not execute those scopes.
Windows BI-BFDB98B6/WC-C6796FCF and transaction BI-5366EF78/WC-A4E8BC72 retain their owners and acceptance. Original uncertain reviews remain unchanged.
The latest explicit operator direction supersedes the earlier 20% allocation: target 80% of this implementation's effort toward relevant consolidation and refactoring. Four of five work packages consolidate existing contracts and tests; one adds bounded presentation. This is a planning estimate, not measured labor or a token quota. The room's native funding binding remains unresolved until recorded authority is read; no installation-based funding attribution is inferred.
