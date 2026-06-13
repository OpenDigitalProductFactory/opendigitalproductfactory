---
title: Incident response lifecycle (NIST SP 800-61)
pageKind: summary
status: published
abstract: NIST's incident-response lifecycle has four cyclical phases — preparation; detection & analysis; containment, eradication & recovery; post-incident activity. Lessons feed back into preparation.
professionCompetencyLevel: practitioner
sources:
  - nist/sp-800-61
  - rapid7/nist-ir-lifecycle
---

## The Four Phases

NIST SP 800-61 frames incident response as a cyclical lifecycle:

1. **Preparation** — reduce incident probability and ready the response team before anything fires.
2. **Detection & Analysis** — analyze symptoms and decide whether an event is truly an incident.
3. **Containment, Eradication & Recovery** — stop the threat, remove it, then restore affected resources, data, and processes.
4. **Post-Incident Activity** — capture lessons and feed them back into Preparation.

The phases are **cyclical, not linear** — each incident improves the next round of preparation.

> Provenance/currency note: the NIST SP 800-61 primary PDF did not text-extract in research, so phase detail is cited via an open secondary explainer. **Rev. 2 was withdrawn (superseded by Rev. 3)** — re-anchor citations to Rev. 3 when authoring against the current spec. The four-phase shape is durable doctrine.

## How DPF Coworkers Use It

- Run incidents through the four phases; never skip Detection & Analysis straight to action.
- Classify impact first — see [[professions/operations/incident-severity-classification]] — and execute via [[professions/operations/runbook-driven-resolution]].
- Close every significant incident with a [[professions/operations/blameless-postmortem]].

## See Also

- [[professions/operations/incident-severity-classification]]
- [[professions/operations/runbook-driven-resolution]]
- [[professions/operations/blameless-postmortem]]
