---
status: draft
---

# Make backlog requests in Needs You actionable

**Backlog:** BI-B499CCB3
**Status:** Research and bounded repair design
**Scope:** Existing inbox and coworker-chat approval presentation for duplicate backlog work. The same cases become fixtures for the existing T3/DPF2 interaction slice.

## Observed problem

The production record describes two merges and one duplicate retirement in which the stored parameters named the affected records, but Needs You displayed an unresolved effect, no work name and a recommendation to hold. This is historical production evidence, not a fresh replay. On the researched main ref, `envelopePrimaryDecision` recognizes a merge only far enough to change the title. `loadTargetLabels` does not request labels for either of the two duplicate actions. Existing tests intentionally retain generic effect text for a named merge, including when extra unknown consequential fields appear.

The authority side is separate. `classifyDuplicateMerge` already permits a same-origin, local, unclaimed duplicate with no live work through the normal authority intersection. A written standing ruling is also available within its existing narrow, revocable and non-damaging scope. Neither precedent permits the client to exempt an action. Duplicate retirement has a distinct writer and does not fold reach like a merge. Applying the merge decision to that writer without equivalent admission and transactional guards would widen behavior beyond the evidence.

## Research and design choice

- The existing provider-toggle and Workroom handover cards show that exact, recognized payloads can disclose the action before the general context while staying tied to the original approval. Reuse that projection and its localization. Reject treating a recognized tool name as proof of the complete effect.
- [A2UI catalogs](https://a2ui.org/concepts/catalogs/) provide a host-owned component vocabulary and [A2UI events](https://a2ui.org/concepts/actions-and-functions/) carry structured input. Keep these as a client compatibility probe. Reject model-defined authority, external renderer dependencies and arbitrary UI for this repair.
- [AG-UI](https://docs.ag-ui.com/introduction) separates events and state from display. [T3 absorption C2/C5](2026-11-13-t3-code-absorption-design.md) already designates the DPF Workroom stream, durable input and existing Attention surface. Reuse that continuity. Do not add a second event stream, action writer or transcript store.
- Routes of judgment are distinct. [WWMD escalation policy](../../founder-kernel/wiki/principles/escalation-is-a-gate-not-a-trust-tier.md) determines whether a person is needed. [WSID error prevention and recovery](../../professions/ux-design/wiki/error-prevention-and-recovery.md) puts a concrete action, outcome and next step first. Standing organization policy applies only within its recorded scope. The corpus informs judgment. Current domain facts and server admission determine execution.

## Objectives

**OBJ-1:** Someone reviewing a genuine duplicate exception knows which item changes, which stays and what happens on authorization without reading internal metadata.

**OBJ-2:** Coworkers do routine work proactively only within verified authority. Humans see a receipt for completed work, and the inbox is reserved for decisions requiring a human.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | An exact duplicate merge and an exact duplicate retirement disclose their different effects and both record references. Use readable titles only where the existing viewer authorization permits them. |
| AC-2 | OBJ-1 | Incomplete, unknown-argument or unauthorized presentations cannot imply that the effect was verified. Preserve material facts and the existing approval gate. |
| AC-3 | OBJ-2 | Regression coverage proves the existing proven same-origin merge remains eligible for routine authorization and cases with active work, peer ownership or ambiguous evidence still require the existing decision path. |
| AC-4 | OBJ-2 | The DPF2 C5 slice receives the same scenarios, including a durable exception answered once from either client and an existing activity receipt with no routine interruption. |

## Implementation sequence and boundaries

1. Add failing tests to the shared decision projection and envelope read model. Render a merge's transfer of reach and a retirement's linkage separately from recommendation. Put the named action and affected records first. Known, exact typed inputs are required. Preserve current raw detail, locale, auth checks and payload. Do not treat a reconciliation-only merge as a new merge. Use bounded target enrichment and never read a restricted title before existing access checks.
2. Run the affected decision, envelope, inline approval, inbox and duplicate-merge classifier suites, web/i18n typechecks and the workroom's style guard. Exercise owner inbox and in-context actions using a governed preview, including no duplicate receipt or exposure across principals. Compare first-screen readability in the existing surface under UX-fit. No database migration, new action route or ownership change.
3. For proactive handling, reuse the existing exact merge classifier and recorded activity. Do not infer sameness from similarity or approval rates. Validate deterministic prerequisites before asking anyone for the broader retirement/preflight work tracked in BI-331DBAD1. Keep distinct operations on existing writers. Link exact resume coverage BI-A303E6EB and the DPF2 C5 slice BI-0C13668F rather than claiming this display repair solves either.
4. For the wider client design, use the existing durable request, result and Workroom lifecycle. Keep routine receipts in activity. Ask only where an answer changes a real outcome. Prefer one focused question with valid choices and free-text fallback, and report the outcome without requiring another chat turn. Measure owner interruptions per completed effect, repeated asks, and whether each answered request resumes once. Reuse the existing COO supervision work BI-C43FD3E5 for proactive recovery rather than introducing another scheduler.

Rollback is a normal source revert of the projection and copy. No approval payload, persisted decision or execution authority is changed by the presentation repair. Do not replay historical approvals during verification.
