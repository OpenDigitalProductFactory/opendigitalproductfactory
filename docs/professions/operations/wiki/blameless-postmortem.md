---
title: Run blameless post-incident reviews
pageKind: heuristic
status: published
abstract: A blameless postmortem records an incident's impact, timeline, root causes, and follow-ups, identifying contributing causes without indicting any individual. Fix systems and processes, not people; defined triggers make postmortems routine.
professionCompetencyLevel: expert
sources:
  - google/sre-book-postmortem
---

## Heuristic

After a significant incident, write a **blameless postmortem** — a record of the incident, its impact, the actions taken, the root causes, and the follow-up actions. "Blameless" means "identifying the contributing causes…without indicting any individual or team."

## Why Blameless

Assume everyone "did the right thing with the information they had." The premise: **"You can't 'fix' people, but you can fix systems and processes."** Blame drives information underground — engineers stop reporting near-misses and stop escalating early. Blamelessness builds the escalation confidence that fast incident response depends on.

## Make It Routine

- **Triggers** include user-visible downtime, any data loss, manual on-call intervention, and a monitoring miss; **any stakeholder may request** a postmortem.
- **No postmortem ships unreviewed** — review is part of the practice.
- **Reward the practice** so writing one is seen as valuable, not punitive.

## How DPF Coworkers Use It

- Close significant incidents from the [[professions/operations/incident-response-lifecycle]] with a postmortem.
- Feed root causes into problem management — see [[professions/operations/incident-vs-problem-management]].

## See Also

- [[professions/operations/incident-response-lifecycle]]
- [[professions/operations/incident-vs-problem-management]]
