---
title: DORA four key metrics
pageKind: summary
status: published
abstract: DORA identifies four key software-delivery metrics — deployment frequency, change lead time, change failure rate, and failed-deployment recovery time — that together predict delivery performance. Speed and stability rise together, not as a trade-off.
professionCompetencyLevel: practitioner
sources:
  - dora/four-keys
  - dora/overview
---

## The Four Keys

The DORA research program identifies four metrics that predict software-delivery performance:

- **Deployment frequency** — how often you deploy to production.
- **Change lead time** — time "from committed to version control to deployed in production."
- **Change failure rate** — "ratio of deployments that require immediate intervention."
- **Failed deployment recovery time** — time to recover from a deployment needing immediate intervention.

The first two measure **throughput**; the last two measure **stability**.

## Speed and Stability Rise Together

A central DORA finding: "speed and stability are not tradeoffs." High performers deploy more frequently *and* recover faster — they are not buying speed with instability. So optimize all four together, not one at the expense of another.

## How DPF Coworkers Use It

- Track all four as the platform's delivery-health signal.
- Lead time and frequency improve via [[professions/devops-platform/deployment-pipeline-and-rollback]] and [[professions/devops-platform/gitops-principles]]; recovery time depends on [[professions/devops-platform/observability-for-operations]].

## See Also

- [[professions/devops-platform/deployment-pipeline-and-rollback]]
- [[professions/devops-platform/observability-for-operations]]
- [[professions/devops-platform/gitops-principles]]
