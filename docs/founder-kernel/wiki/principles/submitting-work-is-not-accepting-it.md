---
title: Submitting Work Is Not Accepting It
pageKind: principle
status: published
abstract: Opening a pull request with its evidence ends the delivering thread. Merge and live verification run on a different clock. Delivery evidence closes the item; only a customer who reported the problem is asked, once, whether it is fixed.
principleDirection: End the thread when the pull request is open and its evidence recorded; never hold a session to watch a merge or deploy, and never self-accept your own work. Let delivery close the item; ask a customer submitter one question with a bounded window, and never leave an obligation open without a bound.
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

**Acceptance is not the author's to give.** Self-verifying and then declaring the work accepted usurps a judgement that is not the author's. This is `governance-approves-evidence-not-provenance` applied to the end of the pipeline: evidence is submitted, not self-ratified.

**Delivery closes the item; a customer is asked once.** Founder direction, 2026-10-27, superseding the reading that every delivered item waits for its requester: "getting validation is really only required if there is a customer reported thing, and even then a simple question and response would do it." Delivery evidence (a merge through the gates, a canonical deployment) closes the item. Work a customer reported closes on delivery too, and its submitter gets one question: "is this fixed for you?" A "no" becomes a new corrective item. Silence past a bounded window (14 days) settles it. Anyone else who finds a problem later reports it, and that becomes a new item. A new item costs less than one that stays open.

**Obligations are bounded.** No delivered item holds an open obligation without a bound. Only an automated check declared at filing, or the one customer question with its window, may follow delivery. Each one concludes on the record.

A watcher armed to do this may also simply not work, and a silent watcher looks identical to a passing one — so the practice adds risk on top of the wasted time.

## How to apply

- Open the pull request with its evidence, name what is unproven, end the thread.
- If an outcome is not obvious from the change, declare an automated check for it when the item is filed. Do not leave a manual acceptance step open after delivery.
- Closing a backlog item you shipped is still yours to do, and delivery evidence is enough. Declaring the outcome good on a customer's behalf is not. The platform asks them.

## Related

`governance-approves-evidence-not-provenance` · `report-only-the-verdict-you-reached` · `human-in-the-loop-at-phase-boundaries` · `all-changes-land-via-pr`
