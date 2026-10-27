---
title: Submitting Work Is Not Accepting It
pageKind: principle
status: published
abstract: Opening a pull request with its evidence ends the delivering thread. Merge and live verification run on a different clock. Delivery closes the item by default; a separate acceptance by whoever asked is owed only for contractual (or genuinely non-obvious) work, and a regression found in use becomes a new item.
principleDirection: End the thread when the pull request is open and its evidence recorded; never hold a session to watch a merge or deploy. Let the merge close non-contractual work, and never self-accept work that is tagged contractual.
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

**Acceptance is not the author's to give.** Where a separate acceptance is owed, the person who asked for the change says whether it is acceptable. Self-verifying and then declaring the work accepted usurps that judgement. This is `governance-approves-evidence-not-provenance` applied to the end of the pipeline: evidence is submitted, not self-ratified.

## Outcomes define done (founder direction, 2026-10-27)

> "Outcomes is the way to know [...] Only when not obvious, we need to ask for how to know. The default is, someone who uses a change, will complain and we open a new BI. [...] not worry so much about the acceptance unless its a contractual thing. This is rare, so not the norm."
> — Mark Bodman, approved in thread 2026-10-27 (BI-B1B44777)

A separate acceptance step had turned into an administrative black hole. On 2026-10-27, 352 items sat awaiting acceptance, 318 of them for more than a week. Coding a new fix is faster than holding an old item open. So:

- **The outcome is stated at intake.** Every new item says what will be true, and for whom, once it is done. Intake asks "how will we know?" only when the change does not make it obvious.
- **Delivery closes the item by default.** A merge through CI and the merge queue satisfies acceptance and objective reconciliation. No design-time gate is owed retroactively, and nobody chases proof.
- **A regression is a new item.** Whoever uses the change and finds it wrong reports it, and that becomes a new item. A newest recorded `ux` or `manual` failure on the item itself still blocks closure.
- **Acceptance by whoever asked is the exception.** It applies to contractual commitments, marked with the `contractual` lifecycle tag (kernel decision DI-1263D968DC26), and to the rare item whose outcome cannot be judged from the change. Only those items wait in awaiting-acceptance.

The authorised acceptance sweep reads the same completion gate, so it closes merged non-contractual items without any further step.

A watcher armed to do this may also simply not work, and a silent watcher looks identical to a passing one — so the practice adds risk on top of the wasted time.

## How to apply

- Open the pull request with its evidence, name what is unproven, end the thread.
- State the outcome when you file the item. Add how you will know only when it is not obvious.
- Let the merge close the item. Do not hold it open for a sign-off nobody asked for.
- If acceptance genuinely matters because a customer was promised it, tag the item `contractual` and say what the check is or who accepts. That item waits for its accepter, and declaring its outcome good is not yours to do.

## Related

`governance-approves-evidence-not-provenance` · `report-only-the-verdict-you-reached` · `human-in-the-loop-at-phase-boundaries` · `all-changes-land-via-pr`
