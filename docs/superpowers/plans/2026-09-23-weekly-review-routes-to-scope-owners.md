---
title: "The weekly review routes each finding to the scope that owns it"
status: active
backlog: BI-19CEC4B4
date: 2026-09-23
---

# The weekly review routes each finding to the scope that owns it

> **BI-19CEC4B4, Phase 3.** Phase 1 shipped the measures, Phase 2 ran them
> weekly. Neither presented anything to anybody.

## The gap

The founder's framing was explicit: *"the platform needs to continuously be
responsible for optimizing itself and **presenting to the right human what may /
should be changed**."*

Phase 2 writes its digest with `console.info`. A run-log line presents nothing
to anyone, and nothing in the platform knows a finding exists. The review could
measure a craft starving for material every Monday for a year and no owner would
ever see a card.

## No new substrate

`DecisionResolutionProposal` already exists for exactly this shape and has been
empty since it shipped:

- `scopeKind: gap-cluster` is documented as *"every unanswered decision in a
  domain, which is the unit the review queue already groups by"* — which is what
  a review line is.
- It carries a `lifecycle`, a `status` an owner rules on, `draftPayload` for the
  artifact and `consequences` / `dissent` for how it was reached.
- `resolution-proposal-store.ts` already refuses to duplicate an open proposal
  and refuses to reopen one a human has ruled on.

The weekly review becomes its first writer. Per
`dpf-verify-substrate-first`, adding a table here would have been inventing a
second home for a record the schema already models.

## Routing is by scope, not by convenience

`decisions-belong-to-their-scope` forbids one scope answering another's
question. It equally forbids handing one scope's *findings* to another owner: a
starved craft corpus is the craft's problem, and a missing business stance is the
organization's. So the owning profile derives from the line's scope and nothing
else.

| Line scope | Owner profile |
|---|---|
| `wsid` | `wsid-<professionKey>` |
| `wwmd` | `mark-dpf-platform` |
| `wwwd` | `dpf-organizational-principles` |

A `wsid` line that names no craft is **unroutable** and counted as such. Picking
a fallback owner would hide a measure defect behind a card addressed to somebody
who cannot act on it.

## One card per finding, not one per week

The proposal's unique key is `(profileId, domainClass)`, and the domain class is
namespaced — `review:<measureKey>[:<professionKey>]` — so it can never collide
with a real decision's class such as `architecture-tradeoff`.

That gives weekly idempotence for free: an unresolved finding stays **one** open
proposal rather than accumulating a card every Monday.

The tradeoff is deliberate and stated here because it is not obvious: a finding
whose numbers worsen does **not** rewrite the open proposal. The owner has not
ruled on the first one yet, and silently editing the card underneath them is
worse than leaving it — the evidence in `draftPayload` records the period it was
drafted from, so nobody mistakes it for this week's numbers.

## What is deliberately not automated

**`file-defect` lines are not auto-filed.** A defect is engineering work, and
filing one from a weekly measure would drop a duplicate in the pool every week
the defect stayed open — exactly the failure the filing duplicate advisory
(BI-3722E9A1) exists to prevent. Those lines are counted and reported so they
cannot be silently dropped, and a human files them.

**Nothing is applied.** A proposal is a draft an owner rules on. The review
never changes a weight, releases material or amends a stance.

**Routing never fails the run.** A review that measured correctly but could not
draft a proposal is still worth recording, and the summary says what happened.

## Dissent is not empty

The schema is explicit that *"nobody dissented" and "nobody asked" must never
read the same on the card*. A deterministic measure convenes no panel, so an
empty array would claim an agreement that was never sought. These proposals
carry a single `none-convened` entry saying the finding is a measurement rather
than a verdict, and that the judgement belongs to the owner ruling on it.

## Verification

`route-review-findings.test.ts` covers each scope routing to its own profile, the
refusal to invent an owner, namespacing against a real domain class, the
already-open and already-ruled paths, `file-defect` not being filed, the
non-empty dissent, and the evidence carried into the draft.

Not proven by test: that a real weekly tick writes proposals on this install.
That needs the Monday 06:00 UTC run (or a `rerun_scheduled_agent_task`), and is
the acceptance step — after it fires, `DecisionResolutionProposal` should hold
rows whose `domainClass` starts `review:` and whose `profileId` is the owning
scope, and the log line should report the routing counts.
