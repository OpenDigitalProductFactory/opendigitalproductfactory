---
status: active
---

# Workroom terminal coherence design

**Backlog item:** `BI-AAA13210`  
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
