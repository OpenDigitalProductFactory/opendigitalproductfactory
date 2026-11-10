---
status: active
---

# Canonical Pre-Human Escalation Gate Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-31-canonical-pre-human-escalation-gate-design.md`  
**Backlog:** BI-51821119  
**Workroom:** WC-499594A8

**Current baseline:** deployed `cc34280ba737347be8b4d9d575f8cdd0b5dc4d19`

This is one atomic fix. None of the steps below is independently shippable: the enforcement boundary, instruction plane, and regression evidence must land together or the platform retains a bypass or contradictory guidance.

## Progress

- [x] Claim the governed Workroom and declare the medium delivery shape.
- [x] Reproduce the current-tree gap against the deployed runtime (`WC-618084CF`) and archive the probe.
- [x] Reconcile the design against current `main`; preserve improvements that landed independently.
- [x] Add failing tests for the incident and Workroom routing disposition.
- [x] Implement the canonical disposition and Workroom blocker gate.
- [x] Align the external guard, coworker prompt, WWMD skill, and doctrine.
- [x] Run affected tests, instruction-plane guards, and preflight.
- [x] Repair independent review finding `cmwaec1ob0ckz01p0ykq07wdn`: a
      consult-required transition now verifies that the supplied `DI-*` exists
      in the DecisionInteraction ledger, rather than accepting format alone.
- [x] Obtain a clean exact-tree integration run. The first admitted run is
      preserved as failed evidence: three unrelated
      `build-flow-state.test.ts` cases timed out under shared-run load, while
      the complete file passed locally (40/40) immediately afterward.
- [x] Record evidence, pass independent semantic review, push, and create PR
      #6940. The first review finding and its repaired-tree pass remain linked.
- [x] Repair the production-build dependency exposed by CI on 2026-11-10:
      `target-binding.test.ts` depended on wall-clock time after its migration
      grace cutoff. The test now supplies its declared fixture time and passes
      9/9 locally; runtime behavior is unchanged.
- [ ] Observe the repaired-tree production build and merge-queue checks, then
      merge PR #6940 and close the Workroom and BI.

## Traceability

- Requirement: `BI-51821119#Acceptance criteria`
- Contract: `canonical-pre-human-escalation-gate-design.md#Decision`
- Flow: ambiguous or blocked decision → classify disposition → consult owning scope when required → proceed or legitimately escalate → persist Workroom status/evidence
- Verification: `decision-routing-guard.test.mjs`, Workroom MCP pack/handler tests, skill corpus guards, `pnpm run pregate:preflight`, `pnpm --filter web build`, exact-tree pregate, `pnpm pr:health`
