---
title: Expertise Compounds in Profession Coworkers
slug: expertise-compounds-in-profession-coworkers
pageKind: principle
status: published
abstract: A decision inside a profession's domain is made by that profession's coworker, working from its own corpus and its own decision profile, and the reviewed outcome is fed back so the expertise grows. Knowledge captured this way is shared and durable; memory in one model or one session is not. Making this loop self-sustaining on the platform comes before expanding to archetypes.
principleTier: core
principleDirection: Route each decision to the profession coworker that owns its domain, have it decide from its own corpus and decision profile, review the outcome, and feed the result back into that profession's knowledge; make this loop self-sustaining on the platform before extending it to archetypes.
principleDimensionVector: {"long_term_maintainability": 0.9, "reusability": 0.9, "evidence_density": 0.8, "governance_compliance": 0.6, "mission_fit": 0.8, "human_cognitive_load": -0.6, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters need to know that DPF's AI coworkers are built to get better at their jobs, from their own profession's knowledge and the reviewed results of their own decisions, rather than relying on whatever a general model happens to know.
authoredAt: 2026-11-04
authoredBy: mark-bodman
---

# Expertise Compounds in Profession Coworkers

## Rule

1. **The owning expert decides.** A decision inside a profession's domain is routed to that profession's coworker: architecture, portfolio and budget, data, UX, security, coordination, finance, and so on. A generalist coworker or an outside coding agent does not settle it alone.
2. **The expert decides from what its profession knows.** It works from its own profession corpus (WSID) and scores the decision with its own decision profile (JSI vectors), not the platform-wide profile. Platform-wide (WWMD) scoring is kept for choices that genuinely cut across every profession.
3. **Every decision is reviewed and fed back.** The decision is recorded against the work it served, and its outcome is reviewed. What the review teaches is written back into that profession's corpus and weightings. A decision with no reviewed outcome teaches nothing.
4. **Knowledge, not memory.** What a coworker learns lives in the governed commons, where every coworker, every executor and every install can retrieve it. It does not live in a model's training, a chat thread or one client's private notes. Those disappear, or stay with one agent.
5. **Platform first, then archetypes.** The goal is to run any kind of company through archetypes. That only works once the loop above runs on the platform's own work, orchestrated and self-sustaining. Work that makes the loop run comes before work that extends archetypes.

## Why

General models are trained to do general work, and some are more capable than others. None of them knows how this organization decides, what it has already ruled, or what went wrong last time. An engine of AI coworkers that evolve has to keep that knowledge itself, held by the expert whose job it is, and improve it with every reviewed decision.

The owner said on 2026-11-04: "we are not building stronger expertise and accumulating critical knowledge, not memory, that we can pull from … Our whole premise is to build this as an engine of AI coworker that evolve … The archetypes are the real objective. We cannot achieve the later until this first self improvement and JSI work can be properly orchestrated and it becomes self sustaining and improving." The same day: "We need robust experts working together. Not one overarching coworker that knows all."

An earlier owner ruling says the same for business work. The platform's purpose is "to earn trust and incrementally establish the JSI corpus and vectors that make AI coworkers perform accordingly" (DI-2212A75710).

## Observed gap (production, week to 2026-11-04)

- 318 of 367 recorded decisions were scored on the single platform profile, and only 49 on profession profiles.
- Specialist reviewers were given three pages of their profession's corpus to read, but none scored its verdict with its own profile. No decision record came from any review.
- Delivery work shapes name generic roles such as "author" and "acceptance reviewer", never the expert whose concern a change touches.
- So the experts exist and their knowledge exists, but the work rarely routes through them, and their decisions do not feed back. This is tracked as BI-4E32AD28 and BI-C6007CB0.

## How to apply

1. **Before deciding,** name the profession that owns the question. Unless it is a genuinely cross-cutting platform choice, route it to that profession's coworker, or score it with that profession's profile.
2. **Link each decision record to the work it served** (room, review or backlog item), so its outcome can be reviewed.
3. **Once the outcome is known,** record whether the decision held, and route the lesson to that profession's corpus through the commons ([[principles/learnings-belong-in-the-shared-commons]]).
4. **When prioritizing,** prefer work that makes this loop run and sustain itself over work that adds archetype breadth.

## Related principles

- [[principles/decisions-belong-to-their-scope]] says which scope owns a decision. This principle adds which expert within that scope decides, and how its expertise grows.
- [[principles/learnings-belong-in-the-shared-commons]] says where a learning goes. This principle makes the reviewed outcome of each expert decision the main source of those learnings.
- [[principles/propose-acknowledge-reassign]] covers how experts hand work to each other inside a scope.
