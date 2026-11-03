---
title: Submitting Work Is Not Accepting It
pageKind: principle
status: published
abstract: Opening a pull request with its evidence ends the delivering thread. Merge and live verification run on a different clock. Every item carries its own outcome, derived when nobody states one, and its room and measurement use that outcome. Delivery closes the item by default; a separate acceptance by whoever asked is owed only for contractual work, a customer who reported the problem is asked once whether it is fixed, and a regression found in use becomes a new item.
principleDirection: End the thread when the pull request is open and its evidence recorded; never hold a session to watch a merge or deploy. Let the merge close non-contractual work, never self-accept work tagged contractual, ask a customer submitter one question with a bounded window, and never leave an obligation open without a bound.
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

## The outcome is an aspect of the item (founder direction, 2026-10-28)

> "The outcome is an aspect of the BI. No BI should be without a clear outcome. The room also has an outcome for each iteration. It doesn't need to be a separate thing really; it's in context of the work to be done."
> — Mark Bodman, 2026-10-28 (BI-8DE5429B)

The outcome belongs to the work, not to a structure beside it:

- **Every item has an outcome, in one field.** `BacklogItem.outcome` holds it (kernel decision DI-342D45001EF5), not prose in the body. When the person or agent filing it gives none, the platform derives a draft from the item's own context and marks it `derived` (DI-D50BBC916B6D). The draft is visible and anyone can correct it, which marks it `stated`. Intake is never refused for a missing outcome.
- **A room's outcome is its item's outcome.** A Workroom shows the outcome of the item it carries, read live so it never drifts (DI-139981F74A44). Nobody writes a separate room objective for it. An explicit boundary claim can still say otherwise.
- **Measure the item's own outcome.** The platform records it at delivery (achieved), at a reopen from done (regressed), and when failing evidence lands on a done item (not achieved). Each observation names the item and the outcome it measured (DI-19ED69C312FC). A Product or objective roll-up is the mean of those item observations. It is never authored separately.

### One outcome hierarchy (founder direction, 2026-10-28)

> "The mission and vision / outcomes of a DPF instance as a whole are also important. This is the prime definer for the WWMD, WWWD and WSID layers too. They steer towards the broader outcome as a whole. The more detailed workroom outcomes are all hierarchically there to help the organization achieve its outcomes. In other frameworks, Hoshin Kanri planning is sort of like this. We want a more simplified and practical version of it here."
> — Mark Bodman, 2026-10-28

Outcomes form one hierarchy: the instance's mission, vision and top-level outcomes, then epic outcomes, then item outcomes, then each room iteration's outcome. Each level's outcome lives on that level's own record and links to the outcome it serves (DI-DDB4BDE852BB). WWMD, WWWD and WSID steer by the instance outcomes. Progress rolls up from the items, and no level authors a separate aggregate. This keeps the Hoshin Kanri cascade and drops the catchball ceremony. The owner sets what the organization's outcomes are, through WWWD. An agent never invents them. The design is in `docs/superpowers/specs/2026-10-28-outcome-hierarchy-design.md`.

## Nothing waits on a person indefinitely (operator direction, 2026-10-27)

> "We seem to have more process gates than needed, the actual closure is predicated on seeing results, which unless it's automatable, we don't want to have open items hanging out forever. [...] getting validation is really only required if there is a customer reported thing, and even then a simple question and response would do it."
> — Mark Bodman, 2026-10-27 (BI-C899BB40)

- **A customer-reported item gets one question.** It closes on delivery like any other non-contractual item. Its submitter is then asked once whether it is fixed. A "no" (the issue reopened) becomes one corrective item and the delivered item stays done. Confirmation, or silence for 14 days, settles it.
- **Obligations are bounded.** A delivered, non-contractual item carries no open obligation without a bound. Only an automated check declared at filing, or the one customer question with its window, may follow delivery. Each concludes on the record.
- **The sweep never re-selects a closed item for acceptance.** It visits a done item only to take that one bounded step.

A watcher armed to do this may also simply not work, and a silent watcher looks identical to a passing one — so the practice adds risk on top of the wasted time.

## How to apply

- Open the pull request with its evidence, name what is unproven, end the thread.
- State the outcome when you file the item. Add how you will know only when it is not obvious; if it can be checked automatically, declare the check. If the platform derived a draft, correct it when it is wrong.
- Take a room's outcome from the item it carries. Do not invent a separate objective for the room or for a Product.
- Know which parent outcome your work serves: the item's epic, and the instance outcome above it. When a link is missing, show the gap instead of guessing it.
- Let the merge close the item. Do not hold it open for a sign-off nobody asked for.
- Declaring a customer's outcome good on their behalf is not yours to do. The platform asks them, once.
- If acceptance genuinely matters because a customer was promised it, tag the item `contractual` and say what the check is or who accepts. That item waits for its accepter, and declaring its outcome good is not yours to do.

## Related

`governance-approves-evidence-not-provenance` · `report-only-the-verdict-you-reached` · `human-in-the-loop-at-phase-boundaries` · `all-changes-land-via-pr`
