---
status: active
---

# Workroom terminal coherence design

**Backlog items:** `BI-AAA13210`, regression `BI-9C018CEB`
**Observed predecessor:** `BI-199F71B6` / `WC-0C842917`  
**Parent contract:** `2026-09-01-completion-readiness-recovery-design.md`

## Problem

The backlog-item and Workroom completion adapters evaluate the same initiative,
but they consume different delivery inputs. A backlog item can therefore reach
`done` through an enforced, allowed initiative-readiness decision while its
linked Workroom recomputes superseded research and objective evidence and
refuses completion. The result is a delivered item with a falsely live room and
scope claims that cannot be released through the normal terminal path.

The live reproduction is `BI-199F71B6`: decision `IRD-8BB862382073` allowed the
item transition with every completion requirement satisfied, while the
immediately following `WC-0C842917` transition returned
`RESEARCH_REQUIRED`, `ACCEPTANCE_EVIDENCE_REQUIRED`, and
`OBJECTIVE_RECONCILIATION_REQUIRED`. Adding Workroom-local test, build, and
verification evidence cleared only `DELIVERY_EVIDENCE_REQUIRED`.

On canonical image `37da678752014212c7713ec7079716454b57284b`,
`BI-78EDA4E7` completed under `IRD-0C12818E74E4`, but `WC-1D9DA55C`
was refused by `IRD-5F649FBC8BEC`. The Workroom already contained successful
canonical verification `RV-BI-78EDA4E7-LIVE-20261002`. Its writer emits
`runtime-verification-passed` with `payload.status = passed`; the terminal
reader selected only `evidence-recorded` and read `payload.result.verdict`.
That incompatible reader silently discarded the Workroom's delivery proof.

## Objectives

- **OBJ-WC-COHERENCE:** A Workroom linked to a `done` backlog item may reuse the
  item's enforced, allowed terminal decision instead of re-deciding stale
  design evidence.
- **OBJ-WC-LOCAL:** Workroom identity and Workroom-local delivery evidence remain
  mandatory and are evaluated for the Workroom transition itself.
- **OBJ-WC-FAIL-CLOSED:** An in-progress item, a malformed or denied terminal
  decision, missing Workroom evidence, or failed identity remains refused.

## Design

Reuse the existing persisted-terminal-decision validator in
`entry-adapter.ts`; it already accepts only a `done` item with an enforced,
allowed completion decision, valid authority snapshot, empty unmet/blocker
sets, and a valid terminal transition. Export that validator for the Workroom
repository rather than adding a second receipt parser.

During Workroom completion, prefer the validated terminal decision only when
the Workroom's lease identity passes and at least one Workroom-local passed
test/build/verification record exists. Rebind the decision to the Workroom
transition and replace its capsule-identity and delivery requirement entries
with the current Workroom evidence. If any prerequisite is absent, retain the
existing full readiness projection and refusal behavior.

Canonical `runtime-verification-passed` activities also satisfy the local
verification requirement when their payload has status `passed` and a
nonempty verification ID. Include that activity kind in the repository query
and cite its activity ID in the rebound decision. Failed, waived, incomplete,
or malformed verification records do not qualify. Generic evidence retains
its existing contract; no duplicate manual evidence entry is required.

Implementation order for BI-9C018CEB:
1. Reproduce the canonical writer payload through a query-aware test double
   and the real readiness projection; confirm completion currently fails.
2. Extend the existing local delivery reader and its query together.
3. Test malformed and unsuccessful verification, existing generic evidence,
   non-done items and identity refusal; run the affected and adjacent suites.
4. Deliver through the protected queue, verify on the canonical install,
   then retry WC-1D9DA55C completion through the governed tool.

No status, receipt, table, migration, bypass, or alternate policy engine is
added. Backlog-item completion remains unchanged.

## Acceptance

- **AC-WC-COHERENCE-001:** A `done` item with a valid allowed completion
  decision and passing Workroom-local identity/evidence permits Workroom
  completion.
- **AC-WC-COHERENCE-002:** The resulting decision names the Workroom transition
  and the Workroom's own evidence references.
- **AC-WC-COHERENCE-003:** A non-done item or invalid prior decision continues
  through the current projection and remains fail-closed.
- **AC-WC-COHERENCE-004:** Missing Workroom-local delivery evidence or failed
  lease identity cannot reuse the item decision.
- **AC-WC-COHERENCE-005:** The canonical runtime writer's passing activity
  survives repository selection and permits reuse; failed, waived and
  malformed payloads remain refused.

## Verification and compatibility

Add focused RED/GREEN tests to
`work-capsule-terminal-transition.test.ts`, run the affected Vitest file, the
style guard, and the web production build. Verify the historical live closeout
after canonical deployment. UX and migration are not applicable.

## Research and alternatives

The live backlog and open-PR sweep found no active owner for this exact split
terminal outcome. The code already contains
`persistedTerminalCompletionDecision` for read projections, so the standard
approach is reuse. Recomputing the old artifact gates was rejected because it
contradicts the already-enforced terminal decision; auto-completing from
`status = done` alone was rejected because it would discard the decision and
Workroom-local evidence checks.

## Rollback

Revert the decision-reuse branch. Workroom completion returns to conservative
recomputation; backlog-item terminal behavior and stored evidence are
unchanged.
