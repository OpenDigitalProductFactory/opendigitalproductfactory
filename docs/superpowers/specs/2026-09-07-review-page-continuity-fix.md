---
title: Immutable review page continuity and truthful task waits
status: binding
date: 2026-09-07
owner: platform
---

# Immutable review page continuity and truthful task waits

## Design grounding

This ordered repair amends the [canonical immutable traversal design](2026-08-25-immutable-source-review-traversal-design.md), specifically its character-offset cursor, informational line metadata, complete-evidence requirement, and same-task recovery contract. It adds no reviewer role, evidence store, approval path, or retry allowance.

## Reproduction and research

At source ref `80d8b1c091d`, `version-history-pack.ts` pages by character offset while `terminal-tool-policy.ts` demands the next line. A live immutable document read returned line ranges 1–200, 201–371, 371–423: line 371 spans two pages. The validator rejected the final page; reviewers repeated the read and exhausted six calls without a receipt. A single long final line also violates its assumption that `hasMore` implies `endLine < totalLines`.

Four task records contained a technical `terminalWriterWait` and no approval envelopes. `tasks-lifecycle.ts` nevertheless set `requiresApproval: true` for every input-required task. The existing `projectRemoteTaskReplay` already distinguishes technical waits from approvals.

Direct immutable reads succeeded with matching commit and blob, ruling out missing source, provider access, and stale identity. Database reads found zero envelopes, ruling out pending human approval. The merged page-size and provider-rotation repairs leave both contradictory checks intact.

## Objectives

- **OBJ-CONT-001:** Accept complete exact-bound character traversal, including split lines, without accepting gaps or replayed pages.
- **OBJ-CONT-002:** Project technical recovery and genuine approval accurately through the existing task endpoints.
- **OBJ-CONT-003:** Preserve bounded recovery, independent verdicts, caller isolation, and receipt authority.

## Acceptance criteria

| ID | Objectives | Observable proof |
| --- | --- | --- |
| AC-CONT-001 | OBJ-CONT-001 | Real reader pages for mixed lines and an over-cap final line reach complete evidence within the existing budget. |
| AC-CONT-002 | OBJ-CONT-001, OBJ-CONT-003 | Missing, reordered, replayed, wrong-bound, and premature-terminal pages remain incomplete; no receipt is fabricated. |
| AC-CONT-003 | OBJ-CONT-002 | Task get/result return false approval plus canonical reason/resumability for writer waits, provider waits, and escalation. |
| AC-CONT-004 | OBJ-CONT-002, OBJ-CONT-003 | Genuine pending approval retains its location; absent approval and a different caller cannot acquire approval authority. |
| AC-CONT-005 | OBJ-CONT-003 | Regression tests demonstrate before/after behavior; exact-tree gates and independent review precede PR publication. Live same-task replay follows canonical deployment. |

## Ordered fix sequence

1. Exercise the real reader handler with the terminal validator, and exercise task get/result with realistic persisted wait records. Record failing assertions on the named base.
2. Make continuation validation honor the reader's character boundary while preserving exact cursor and artifact binding. Line continuity is derived from the prior page's content boundary; a partial final line may have more characters. Do not simply allow arbitrary repeated line ranges.
3. Reuse the canonical task replay projection for technical wait metadata; retain the authorized approval-location lookup and existing task wire shape. Do not expose source bytes or raw request metadata.
4. Run focused and adjacent tests, typecheck, the required integration gate, and independent review. Publish DCO-signed source through a governed PR.
5. After canonical deployment, replay the original immutable requests on their existing task identities. Verify receipt outcomes rather than assuming a reviewer will pass.

## Failure analysis and recovery

False incomplete evidence delays delivery of business repairs and wastes reviewer capacity. Exact cursor continuity eliminates this avoidable failure opportunity. Incorrectly accepting skipped content could hide risks affecting donors, staff, and beneficiaries: retain immutable identity, cursor ordering, and terminal-page checks and test each rejection path.

A false approval label makes a business owner wait for an action they cannot take. Shared projection prevents drift; real envelope lookup and caller checks contain authority risks. Reviewer/provider outages remain bounded technical waits and cannot create a passing receipt. Detection uses persisted wait reasons and regression tests; recovery preserves the same task and request binding.

There is no schema migration. Older evidence lacking enough boundary information must fail closed and use the existing bounded reread. Existing budgets still limit very large documents; this repair does not claim every artifact can be traversed. The delivery owner remains accountable for live same-task verification after release. Rollback reverts this scoped change without rewriting audit history or accepting residual business risk.

## Documentation and compatibility

This amendment is the contributor-facing explanation. Task status field spelling, cursor format, grants, and approval semantics remain compatible. No new end-user screen or platform-specific dependency is introduced. Existing task projection and page metadata are the sources of truth.
