---
title: Submitting Work Is Not Accepting It
pageKind: principle
status: published
abstract: Opening a pull request with its evidence ends the delivering thread. Merge and live verification run on a different clock, and acceptance belongs to whoever asked for the change.
principleDirection: End the thread when the pull request is open and its evidence recorded; never hold a session to watch a merge or deploy, and never self-accept your own work.
principleTier: core
principleDimensionVector: {"governance_compliance": 0.7, "operator_effort": -0.3, "evidence_density": 0.5}
principleWeight: 0.6
principleWeightRationale: Governs where a delivery thread stops and who ratifies the outcome; weighted alongside the other evidence principles it extends.
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters need to know an agent records evidence for review rather than declaring its own work accepted.
---

## Rule

Once a pull request is open with its verification evidence, the delivering thread's job is done. Say what remains unproven and what would prove it, and **end there**.

Do not arm a watcher for the merge. Do not wait for the deploy. Do not chase an install to confirm your own change.

## Why

Founder direction, 2026-09-07, after a thread sat through a continuous-integration watch, a merge, an image publish and a live upgrade to prove one change worked.

Two separate reasons, and each stands alone.

**Merging and verification belong on different clocks.** Verification happens asynchronously, later, in whatever session is running when the change actually reaches an install. Holding a thread open to watch it burns context and wall-clock for no added assurance.

**Acceptance is not the author's to give.** The person who asked for the change says whether it is acceptable. Self-verifying and then declaring the work accepted usurps that judgement. This is `governance-approves-evidence-not-provenance` applied to the end of the pipeline: evidence is submitted, not self-ratified.

A watcher armed to do this may also simply not work, and a silent watcher looks identical to a passing one — so the practice adds risk on top of the wasted time.

## How to apply

- Open the pull request with its evidence, name what is unproven, end the thread.
- If live acceptance genuinely matters, record it on the backlog item as the outstanding step so any later session, or the requester, can pick it up.
- Closing a backlog item you shipped is still yours to do. Declaring the outcome good is not.

## Related

`governance-approves-evidence-not-provenance` · `report-only-the-verdict-you-reached` · `human-in-the-loop-at-phase-boundaries` · `all-changes-land-via-pr`
