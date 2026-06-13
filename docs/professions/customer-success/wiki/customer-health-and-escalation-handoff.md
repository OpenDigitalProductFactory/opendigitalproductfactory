---
title: Customer health scoring and escalation handoff
pageKind: heuristic
status: published
abstract: A customer health score is a predictive metric of renewal/growth/churn likelihood, blending product usage, engagement, sentiment (NPS), and support signals. Alert on score decay and escalate on early signals — churn is a 30-90 day decay, not a renewal-day surprise.
professionCompetencyLevel: practitioner
sources:
  - gainsight/health-scores
  - gainsight/cs-guide
  - wikipedia/nps
  - bain/net-promoter-system
---

## Heuristic

Maintain a **customer health score** — "a predictive metric … of the likelihood of renewal, growth, or churn" — and act on its decay before renewal, not at it.

## Building the Score

- **Blend signals:** product usage, engagement/relationship, sentiment (NPS), and support/escalations.
- **Use a model:** traffic-light (red/yellow/green) or 0-100 banded healthy / at-risk / critical.
- **Automate alerts:** "set up alerts to notify your team when a health score drops" — make the escalation trigger mechanical, not memory-dependent.

## Escalate Early

Churn is typically a **30-90 day behavioral decay**, so escalate on **early** signals rather than waiting for renewal. NPS feeds the sentiment signal: detractors (scores 0-6) flag churn/defection risk and should be routed to intervention; promoters (9-10) are expansion candidates.

## How DPF Coworkers Use It

- Watch the health score continuously; when it drops, run the intervention playbook and escalate/hand off with full context.
- NPS specifics are in [[professions/customer-success/net-promoter-score]].
- Healthy onboarding ([[professions/customer-success/onboarding-and-activation]]) is the first input to health.

## See Also

- [[professions/customer-success/onboarding-and-activation]]
- [[professions/customer-success/net-promoter-score]]
- [[professions/customer-success/what-is-customer-success]]
