# Plan — Autonomous assurance remediation loop (off-hours, budgeted, WWMD-gated)

_Status: planned · EP-ASSURANCE-LEDGER · P1 BI-7C121CCF / P2 BI-204EE70B / P3 BI-4D5C702F · 2026-06-22_

## Goal (founder directive)

Auto-created assurance BIs (PR #2290) must actually get **worked**, not pile up.
Make remediation **autonomous, but with four rails**: (1) WWMD-gated — any
uncertain decision the kernel can't resolve **escalates to a human**; (2) a
**budget cap**; (3) **incremental** (a few at a time); (4) **off-hours, flexible
timing** (not a fixed clock slot).

## Reuse map (don't reinvent)

| Rail | Existing substrate |
| --- | --- |
| incremental + promote→build | `governed-backlog-tee-up.ts` (`promoteBacklogItemToBuildDraft` → auto-approve → Ideate; cap `backlogTeeUpDailyCap`) |
| off-hours / flexible | `self-upgrade/auto-window.ts` + `windows-eval.ts` (low-traffic trough resolver) + `quiescence-gates.gateAtEntry` |
| WWMD-gate + escalate | `build/decision-service.ts` (principle_decide) + `build/escalate-build-to-human.ts` + capture-kernel-gap |
| scheduling visibility | scheduled-jobs catalog + `scheduling-map.ts` |

The only gap is an **assurance-specific lane** wiring these together. Today
auto-file lands BIs in `triaging` (no `triageOutcome`), so the tee-up (which
selects `status=open` + `triageOutcome=build`) never picks them up.

## Phase 1 — get them building (BI-7C121CCF)

- New scheduled inngest fn `assurance-remediation-teeup`, gated to the low-traffic
  window via `auto-window` + `gateAtEntry` (fire on a frequent cron, only act
  off-hours; no fixed slot).
- Pure selector `selectAssuranceRemediationCandidates`: origin `assuranceFinding`,
  EP-ASSURANCE-LEDGER, `proposedOutcome=build` (high/critical), `activeBuildId=null`,
  severest/oldest first, up to a **dedicated remediation budget cap** (own knob,
  not the shared `backlogTeeUpDailyCap`).
- Per item (within budget): set `status=open` + `triageOutcome=build`, then
  `promoteBacklogItemToBuildDraft` → Ideate → BS builds the override bump → PR.
  **No auto-merge here** (awaits P2).
- General 14:00 tee-up: no exclusion needed — the triage transition + promote run
  in ONE transaction (rollback on failure) and `promoteBacklogItemToBuildDraft`
  sets `activeBuildId`, which the general tee-up's `activeBuildId: null` filter
  already excludes. So an assurance BI is never visible to the general lane as a
  bare open+build item.
- Tests: selector matrix + off-hours gating. Register in the scheduling catalog.

**Implemented (BI-7C121CCF):** `apps/web/lib/assurance/remediation-teeup.ts`
(`selectAssuranceRemediationCandidates` + `isAssuranceRemediationWindowOpen` +
`resolveRemediationBudget` + `runAssuranceRemediationTeeUp`) + test;
`apps/web/lib/queue/functions/assurance-remediation-teeup.ts` (inngest cron
`assurance/remediation-tee-up-scheduled`, `41 * * * *`, gated to 02:00–06:00 UTC +
quiescence); registered in `queue/functions/index.ts` + the scheduled-jobs catalog
(parity test). Budget: per-run cap `ASSURANCE_REMEDIATION_BUDGET` (default 2);
gated on `governedBacklogEnabled`. A spend-based budget (spend-intelligence) is a
later refinement.

## Phase 2 — WWMD-gated autonomous merge + escalate (BI-204EE70B)

The supply-chain-sensitive far end. Each remediation's merge decision runs through
`decision-service` (principle_decide). Confident + gates pass (CI green +
release-age cooldown + OSV-clean target) → **auto-merge**; uncertain (low margin /
commandment conflict / kernel can't resolve) → **escalate to the responder**
(`escalate-build-to-human`), never auto-merge. Honors the founder's group-only
Dependabot merge posture as the conservative default until WWMD clears a class.

## Phase 3 — close the loop (BI-4D5C702F)

When a later scan no longer reports a finding, mark previously-open findings
**absent from the latest scan** as `resolved` (scoped to the same build+adapter)
and close the linked BI. Makes the loop converge instead of leaving transient BIs.

## Sequencing

Land PR #2290 (the create-side foundation) first; then P1 → P3. P1 is safe
(produces PRs, gated by `governedBacklogEnabled` + off-hours + budget; reversible).
P2 is the one to build most carefully (autonomous merge of dependency changes).
