---
title: Service catalogue management
pageKind: entity
status: published
abstract: The service catalogue is the active, customer-facing slice of the broader service portfolio (pipeline / catalogue / retired). Released units enter live operation as catalogued, supportable services, linking release output to consumable offerings.
professionCompetencyLevel: practitioner
sources:
  - itsm-wiki/service-portfolio
  - itsm-wiki/release-deployment
---

## Definition

The **service catalogue** is the **active, customer-facing slice** of the broader **service portfolio**. The portfolio has three parts:

- **Pipeline** — services in development / proposed.
- **Catalogue** — services currently available to customers.
- **Retired** — discontinued services.

The catalogue lists what customers can actually consume now; the portfolio holds the full lifecycle.

## Link to Release

Release management is what moves a unit into the catalogue: released units "enter live operation as catalogued, supportable services," connecting release output to consumable offerings. A release that ships but is not catalogued and supportable is incomplete.

> Licensing note: ITIL concepts here are sourced from an open CC explainer; ITIL® is a PeopleCert trademark, not reproduced from ITIL publications.

## How DPF Coworkers Use It

- Treat the catalogue as the source of truth for what customers can consume; keep it in sync with what releases actually ship.
- An accepted release ([[professions/release-service-management/subscription-release-acceptance]]) maps to its catalogued service so consumers see what changed.

## See Also

- [[professions/release-service-management/release-gate-package]]
- [[professions/release-service-management/subscription-release-acceptance]]
