---
title: Portfolio
pageKind: entity
status: published
abstract: A curated set of Digital Products grouped for a shared management purpose — investment, governance, or operations.
sources:
  - articles/sibling-portfolios
  - papers/shift-to-digital-product-w205
---

## What it is

A Portfolio is a **curated set of `[[entities/digital-product]]`s grouped for a shared management purpose**. Application Portfolio Management (APM) is a portfolio that groups applications under the Dev lens. Services Portfolio Management (SPM) is a portfolio that groups services under the Ops lens. Digital Portfolio Management (DPM) is the unification — both grouped under a Digital Product spine.

Portfolios are not categories; they are **management surfaces**. The right question to ask of a portfolio isn&#39;t "which products belong to it?" but "what decisions does this grouping enable that the constituent Digital Products couldn&#39;t answer on their own?"

## How DPF uses it

DPF&#39;s `Portfolio` Prisma model groups Digital Products with explicit lifecycle metadata, ownership, and investment context. The portfolio is the **default management surface** for cross-product judgment: which products to consolidate, which to retire, which to invest in next.

Portfolios are also the unit of agent context — a coworker on a portfolio page sees the portfolio&#39;s Digital Products, their value-stream coverage, their lifecycle states, and the portfolio-scoped wiki overlay.

## Relationships

- Contains: `[[entities/digital-product]]`s.
- Sibling concept: `[[entities/digital-product]]` is the unit; Portfolio is the curation.
- `[[entities/csdm]]` represents portfolios via the BusinessApplication / Service hierarchies that DPM unifies.

## Examples

The "Customer-facing experience" portfolio groups the storefront, customer portal, mobile app, and customer-data services together because investment decisions span them. The "Foundational platform" portfolio groups CI/CD, observability, secrets management, and runtime infrastructure together because they share governance posture and SLO discipline.

## See also

- Stance: `[[stances/dont-integrate-ea-platform]]` — why portfolios belong on one platform.
- Stance: `[[stances/digital-product-is-the-unit-of-organization]]` — what fills a portfolio.
