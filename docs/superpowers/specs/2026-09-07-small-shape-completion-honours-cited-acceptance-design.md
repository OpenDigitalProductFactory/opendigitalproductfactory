---
status: active
title: Small-shape completion honours cited acceptance evidence and a re-claim keeps the completion window
backlog_item: BI-05F8860A
---

# Small-shape completion honours cited acceptance evidence and a re-claim keeps the completion window

- **Date:** 2026-09-07
- **Scope:** platform — initiative readiness v3 completion, terminal recovery, backlog claim
- **Backlog item:** `BI-05F8860A`
- **Profile:** fix
- **Status:** Design — implemented in this branch.

**OBJ-SMALL-SHAPE-CLOSE-1:** A merged small or break-fix item closes through the governed path on the evidence its shape defines (delivery evidence plus a cited runtime check or failing-to-passing test), the recovery packet names that evidence when it is missing, and re-entering an already-held claim never resets the completion-evidence window.

## 1. Defect, on a named ref

Observed live on 2026-09-07 01:36–01:47 UTC on this operator install (portal `v2026.09.06-review-provider-admission.1`, readiness policy `initiative-readiness.v3`) while closing BI-A57B6185, a merged fix bound to `delivery-small@1.0.0`:

| Step | Call | Result |
| --- | --- | --- |
| 1 | `update_backlog_item_status(done)` with post-merge evidence | `ACCEPTANCE_EVIDENCE_REQUIRED`; escalation `baseline-not-found` |
| 2 | spec-approval dispatched by hand; baseline minted | `eligible-evidence-not-found` |
| 3 | fresh post-baseline evidence recorded | `objective-mapping-history-unavailable`, no route |
| 4 | `claim_backlog_item_for_work(implementation)` to "refresh readiness" | every evidence row recorded before the re-claim became "outside the current completion window" |
| 5 | four rows re-recorded, `done` again | same `objective-mapping-history-unavailable`; nextAction says "record it with record_execution_evidence and cite it as acceptance", which was already done |

Source at `origin/main` (`60807beafae`):

- `apps/web/lib/backlog/initiative-readiness/shape-requirements.ts:94` — the small shape assigns `ACCEPTANCE_EVIDENCE_REQUIRED` to the `delivery-coordinator` with the comment "the runtime check on the live install, or the failing-to-passing test, is the acceptance. No spec, no plan, no reconciliation receipt."
- `apps/web/lib/backlog/initiative-readiness/backlog-terminal-transition.ts` — `acceptancePass` honours `acceptanceEvidenceRefs` only when `workClass === "documentation"` or when a merge through gates is recognised. A small implementation item therefore falls through to objective reconciliation, which the shape never requires.
- `apps/web/lib/backlog/initiative-readiness/terminal-recovery.ts` — treats every `ACCEPTANCE_EVIDENCE_REQUIRED` as an objective-mapping lane: demands a baseline, then eligible evidence, then a route the projector never emits because `recoveryGate` only maps objective-mapping for an `acceptance-reviewer` lane (`initiative-readiness-tool-grants.ts:463`). Three misleading escalations for one missing evidence row.
- `apps/web/lib/backlog/claim-on-start.ts` `buildClaimAcquireData` — every acquire, including same-owner re-entry, writes `claimedAt = now`; `completion-evidence-runtime.ts:131` opens the completion window at `claimedAt`, so a re-claim invalidates all earlier evidence.
- Merge-through-gates recognition (`defaultResolveMergeDelivery`) scans `DPF_REPO_ROOT`, `DPF_HOST_SOURCE_ROOT`, `/host-dpf` and `cwd` for a git trunk; on a consumer install none is a checkout, so that path can never fire here. Out of scope for this fix; noted for BI-05F8860A acceptance item 4.

Candidate causes ruled out by running: missing evidence kinds (all four dimensions were recorded inside the window at step 5 and delivery passed); reviewer availability (spec-approval passed on attempt 1); the writer-rejection defect just fixed in BI-A57B6185 (no writer was involved after step 2).

## 2. Fix sequence

1. `backlog-terminal-transition.ts`: read the bound work shape before computing acceptance; when the shape is `small` or `break-fix` and the completion verdict is allowed with cited `acceptanceEvidenceRefs`, acceptance and objective reconciliation pass and the acceptance refs are reported. Unshaped (v2) and medium/large items are unchanged.
2. `terminal-recovery.ts`: when the unmet acceptance lane belongs to the `delivery-coordinator`, return a single `acceptance-evidence-required` escalation naming `record_execution_evidence` (kind `manual_check` or `ux_verified`) inside the current window, and warn that a re-claim does not reopen the window. Never consult baseline, eligible evidence or mapping history for that lane.
3. `claim-on-start.ts`: before the acquire, attempt a same-owner re-entry on a fresh active claim that updates ownership fields only and leaves `claimedAt` untouched; report `reentered: true`.
4. Tests for each, plus the v2 guard that an unshaped implementation item still needs reconciliation.

## 3. Acceptance criteria

| Criterion | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-SMALL-SHAPE-CLOSE-1 | A `delivery-small` item with an allowed completion verdict and cited manual acceptance evidence reports acceptance and objective reconciliation as pass and the cited refs as its acceptance evidence |
| AC-2 | OBJ-SMALL-SHAPE-CLOSE-1 | An unshaped implementation item with the same evidence still reports acceptance missing (v2 behaviour unchanged) |
| AC-3 | OBJ-SMALL-SHAPE-CLOSE-1 | Terminal recovery for a `delivery-coordinator` acceptance lane returns one `acceptance-evidence-required` escalation naming `record_execution_evidence` and consults no baseline, evidence or mapping ports |
| AC-4 | OBJ-SMALL-SHAPE-CLOSE-1 | Re-entering a fresh claim held by the same owner updates ownership only and never writes `claimedAt` |

## 4. Non-goals

- Recognising a merge from the GitHub PR on consumer installs (no local trunk). Separate follow-up.
- Changing medium or large shape gates, or the v2 profile tables.
