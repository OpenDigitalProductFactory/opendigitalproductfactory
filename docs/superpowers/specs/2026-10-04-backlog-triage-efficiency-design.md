---
status: active
---

# Backlog triage assesses changed work once

Backlog: BI-E3FBB0C4. Workroom: WC-C9D2BC8A.

## Problem and evidence

The canonical portal reported 25 considered, zero advanced, 25 left for review at 2026-10-04T17:28:51Z and 18:30:38Z. The oldest ten screenshot items remain triaging. The wrapper always selects the oldest 25; the core collapses failures and review into one result. An unchanged held prefix is repeatedly inferred and later work starves.

## Design grounding

Extend the scheduling-surface-review design (2026-06-21) and existing backlog triage implementation. Nullable typed fields on BacklogItem own fingerprint, disposition, attempts, retry time, assessment time and claim token; BacklogItemActivity remains bounded audit history. Activity retention (365 days) cannot own durable suppression. ScheduledJob gets a typed lastRunSummary and runCursor; optional metadata carries supplementary diagnostic counts. An additive migration extends these existing carriers, with a generated assessment-outcome enum. No new service, table, provider or dependency. Work status and assessment disposition remain separate: held work stays triaging and visible.

## Ordered fix

1. Refactor the item core into a typed assessment result distinguishing build, review, low confidence, invalid response, model error, ledger error, apply error and concurrent change. Keep the legacy entry point compatible where needed. Persist assessments independently of the governance ledger; the ledger still precedes every build mutation.
2. Fingerprint the exact decision inputs plus a versioned policy. Read the typed assessment projection for that fingerprint. Completed judgments are held until inputs/policy change; transient failures get bounded backoff and a finite retry count. Explicitly re-triaging an item invalidates the assessment through lifecycle activity newer than its assessment timestamp. Unrelated activity must not cause another inference. Claim tokens fence expired workers without locking across inference.
3. Select eligible candidates across the waiting queue rather than stopping at the first 25 held items. Use bounded, paged database reads and deterministic ordering. Use existing job flow controls and durable steps; before inference and before mutation, re-read status and inputs. Conditional update prevents overwriting manual triage.
4. Bound model starts per run and elapsed model time. Store small structured outcomes and error classifications, never prompt bodies or provider exception text. Infrastructure/recording failure stops unsafe work and is reported.
5. Project the latest counts and reason in the existing Scheduled Jobs result area. Preserve enablement, cadence and kill switch. Show review needed separately from infrastructure errors; idle is an honest completed run.

## Research & Benchmarking

- [Inngest retries](https://www.inngest.com/docs/durable-execution/guides-and-advanced/error-handling/retries): reuse completed named steps and stable operation identity. Adopt per-item checkpoints; reject batch-wide repeated inference.
- [Inngest concurrency](https://www.inngest.com/docs/functions/concurrency): concurrency controls steps, not whole runs. Do not claim a concurrency setting alone prevents overlapping runs; use persisted assessments and conditional mutation.
- [Temporal retry policy](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/retry-policies.mdx): distinguish non-retryable results and bounded exponential retries. Adopt bounded transient retries; reject unlimited retries for a cost-sensitive model judgment. No Temporal dependency.

## Authority, compatibility and rollback

Automatic build is still the only permitted automatic disposition, with confidence threshold, author size preservation, mirror ownership and fail-closed governance. No discard, defer, scope widening or new approval policy. Existing rows without an assessment are eligible once. Rollback leaves additive nullable columns and audit history in place; do not drop recorded state. An assessment is evidence of a judgment, never proof that a failed apply changed work.

## Acceptance

- AC-1: An unchanged item already assessed as needing review receives no further scheduled model request; relevant input or policy changes make it eligible again.
- AC-2: Held older items do not prevent later eligible triaging items from being assessed.
- AC-3: Model failures, invalid responses, low confidence, review decisions, ledger failures and apply failures have distinct durable outcomes with bounded retry rules.
- AC-4: Each run has a bounded request/time budget and cannot overwrite a concurrent manual triage decision.
- AC-5: Existing scheduled-work reporting presents meaningful run counts and errors, including zero-progress and skipped work, rather than a misleading blanket ok.
- AC-6: Regression tests verify repeat suppression, change invalidation, queue fairness, retries, concurrent updates and safety gates.

---

## Addendum (2026-11-28): Server-owned intake preparation and durable Workroom design handoff (`BI-026DBD4A`)

**Backlog:** `BI-026DBD4A` · **Workroom:** `WC-56F76C46` · **Epic:** `EP-DELIVERY-ENGINE-V2` · **Matched CLI cutover proof:** `BI-8B3DBAD8` (S8).
**Extends:** This design (`BI-E3FBB0C4`), [Delivery Engine v2 §3.1 and §3.6](2026-11-12-delivery-engine-v2-design.md), and `BI-B62B218E` Workroom intake/continuation semantics.

### Problem and reproduction (`cmx09w7w6295k0ekjk01dc20s`)

On `BI-A59837E5`, scheduled triage recorded `needs-review` citing a truncated brief (`cmwz9276q09eo0emwual05bqr`), with no retry and no Workroom, forcing a manual chat intervention to open the item and staff design. On pinned `89cd7b12` and current `fa369301`, `buildTriageDrainPrompt` in `apps/web/lib/operate/backlog-triage-drain.ts:72` slices `item.body` to `1200` characters, silently dropping the stored `## Acceptance criteria` heading starting at offset `1462` (evidence `cmx09w7w6295k0ekjk01dc20s`). Even after an eligible item passes triage, the drain only flips `status` to `open` and stops short of preparing one durable Workroom design handoff, leaving continuation dependent on a chat nudge.

### Objectives

**OBJ-INTAKE-1:** Provide complete authorized stored scope and acceptance criteria to the triage assessment within bounded data limits before classifying content as missing, without turning preview truncation or ordinary packet assembly into a human-review escalation.

**OBJ-INTAKE-2:** After a governed, ledgered build decision on an eligible item, prepare and persist exactly one server-owned Workroom design handoff (scoped evidence packet, accountable owner, and next design action) and let Workroom Drive advance it through existing gates without a chat nudge.

**OBJ-INTAKE-3:** Guarantee idempotent single-action continuity across restarts, replays, and concurrent assessments while holding fail-closed on stale revisions, federated/mirrored or unauthorized items, missing authority/grants, uncertain dispatch, or owed independent/owner decisions.

**OBJ-INTAKE-4:** Keep one portal-owned assignment, action-admission, and receipt contract shared by portal/Build Studio and absorbed T3/NixOS CLI executors, with matched served CLI parity verified by S8 (`BI-8B3DBAD8`) before cutover.

### Acceptance criteria (`BI-026DBD4A`)

| ID | Objectives | Criterion |
| --- | --- | --- |
| AC-INTAKE-1 | OBJ-INTAKE-1 | On the controlled `BI-A59837E5` reproduction (`## Acceptance criteria` at offset 1,462), `buildTriageDrainPrompt` preserves complete stored scope and acceptance criteria within bounded structured packet limits and never drops criteria behind a 1,200-character slice. |
| AC-INTAKE-2 | OBJ-INTAKE-1 | Unauthorized, federated-mirrored, or confidentiality-restricted content respects existing visibility and data limits; ordinary packet assembly never produces a `needs-review` escalation solely due to preview truncation. |
| AC-INTAKE-3 | OBJ-INTAKE-2 | An eligible intake records its fail-closed `DecisionInteraction` ledger row first, then persists one durable server-owned Workroom design handoff (scoped evidence, accountable owner, next design action) using existing Workroom assignment and command-receipt primitives without a chat action. |
| AC-INTAKE-4 | OBJ-INTAKE-2, OBJ-INTAKE-3 | Restart, repeat, and concurrent assessment of the same revision/fingerprint retain the single owned next action with zero duplicate Workrooms, zero duplicate dispatches, and zero chat nudges, while preserving `BI-E3FBB0C4` unchanged-item suppression. |
| AC-INTAKE-5 | OBJ-INTAKE-3 | Stale revisions, mirrored or unauthorized content, missing action authority/grants, and uncertain dispatch hold fail-closed without advancing or resending; any owed independent or owner gate keeps one named hold naming the exact missing input, responsible role, and reopening event with its decision packet prepared. |
| AC-INTAKE-6 | OBJ-INTAKE-4 | Portal and absorbed T3/CLI executors consume the same server-owned assignment, action-admission, and receipt contract with deterministic duplicate, restart, reconnect, stale-revision, and revoked-authority checks; matched served NixOS CLI proof is explicitly carried by S8 (`BI-8B3DBAD8`) before cutover. |

### Architecture and substrate reuse

No parallel queue, scheduler, owner model, or review engine is introduced:

1. **Authorized bounded intake packet (`backlog-triage-drain.ts`, `backlog-triage-assessment.ts`):** Replace the blind `.slice(0, 1200)` truncation with a structured bounded packet assembler that extracts and retains required governed sections (`## Observed failure` / problem statement, `## Scope` / design anchor, `## Acceptance` / `## Acceptance criteria`, and linked spec/evidence pointers) within an explicit character budget, or performs an authorized bounded section read before classifying content as missing. Bump `TRIAGE_POLICY_VERSION` (`triage-assessment.v2`) so previously truncated `needs-review` assessments re-evaluate once while unchanged post-v2 items retain `BI-E3FBB0C4` suppression.
2. **Fail-closed ledger before mutation (`backlog-triage-ledger.ts`):** Keep `recordTriageDecision` as the mandatory fail-closed `DecisionInteraction` write preceding any build or handoff mutation. No grant widening or approval bypass.
3. **One durable Workroom design handoff (`backlog-triage-repository.ts`, `command-receipts.ts`, `bounded-handoff.ts`, `workroom-drive.ts`):** Key the handoff command deterministically to `(backlogItemId, triageFingerprint)` through the existing Workroom command-receipt (`commandScopeKey`, `commandKey`, `commandPayloadBinding`) and row-locked assignment transaction. Persist the prepared scoped evidence packet, resolved accountable owner, and next design action on the single Workroom so Workroom Drive picks it up on ordinary schedule/trigger without any chat nudge. The current stage prepares the next gate's evidence before relinquishing custody and never decides independent outcomes or treats a queue/request acknowledgement as stage acceptance.
4. **Fail-closed holds and preserved gates:** Mirror-owned items (`FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX`), stale `updatedAt`/fingerprint revisions, missing or revoked grants, and uncertain dispatch outcomes hold without advancing or resending. Genuine independent reviews (spec-approval, architecture, security, data, UX) and owner decisions retain their exact current grants and authority boundaries, surfacing one named hold with exact missing input and reopening event.
5. **Portal/CLI single contract and S8 cutover boundary:** Both portal/Build Studio and the qualified NixOS CLI consume the exact same server-issued Workroom assignment, action-admission check, and command-receipt contract and return evidence against that exact revision. The CLI never takes over coordination, widens grants, or infers approval. Matched served CLI verification before cutover belongs explicitly to S8 (`BI-8B3DBAD8`), not a second implementation or live pilot inside this slice.

### Test-first ordered implementation plan

Per the `fix` readiness profile, this ordered sequence lives in this design document rather than a separate plan file:

1. **Phase 1 — Minimal Red (`cmx09w7w6295k0ekjk01dc20s`):** Add a deterministic failing unit test in `apps/web/lib/operate/backlog-triage-drain.test.ts` calling the real `buildTriageDrainPrompt` on the controlled `BI-A59837E5` brief (without later staffing notes; `## Acceptance criteria` at offset `1462`), asserting criterion visibility and observing Red against the `1200`-character slice.
2. **Phase 2 — Structured bounded brief packet (Green on Phase 1):** Implement structured bounded section preservation in `apps/web/lib/operate/backlog-triage-drain.ts` and policy version bump in `apps/web/lib/operate/backlog-triage-assessment.ts`; verify `BI-A59837E5` criteria survive while data limits, visibility bounds, and unchanged-item suppression hold.
3. **Phase 3 — Durable server-owned one-action handoff:** Extend `apps/web/lib/operate/backlog-triage-repository.ts` and `apps/web/lib/queue/functions/backlog-triage-drain.ts` to prepare one receipted Workroom design handoff after `recordTriageDecision` succeeds, reusing existing Workroom assignment, command receipts, and drive continuation. Add deterministic no-effect tests proving: (a) single owned action across restart, repeat, and concurrent assessment with zero chat nudges; (b) fail-closed hold on stale revision, federated/unauthorized item, missing grant/authority, and uncertain dispatch; (c) named hold preservation when an independent or owner gate is owed.
4. **Phase 4 — Shared portal/CLI contract checks and S8 handoff:** Add deterministic contract tests covering duplicate, restart, reconnect, stale-revision, and revoked-authority enforcement on the shared assignment/admission/receipt seam; leave matched served NixOS CLI cutover proof to S8 (`BI-8B3DBAD8`).

### Explicit exclusions

No changes to quarterly planning points (`BI-A59837E5`), S9 review-dispatch recovery, S5, provider selection or spend controls, unrelated Workrooms, archived `WC-40C49642`, parked draft PR `#7226`, prior `BI-C3EBDCEC` acceptance, or live production state.
