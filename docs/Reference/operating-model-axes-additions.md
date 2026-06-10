# Operating-Model Axes — Accepted Additions (sidecar to the 4-portfolio workbook)

The canonical taxonomy lives in `4_portfolio_Reworked_V3_Definitions_IT4IT.xlsx`
(Products and Services Sold sheet carries the axis columns). Per the workbook-first
contract (2026-05-22 archetype capability spec §3.6), axis-vocabulary changes are
proposed against the workbook and promoted into platform enums once accepted. This
sidecar records accepted additions until the taxonomy team's next workbook pass folds
them in; the workbook + this file together are the source of truth in the interim.

## Accepted 2026-06-09 — civic & member-governed archetypes

Operator-approved via `docs/superpowers/specs/2026-06-09-civic-and-member-governed-archetypes-design.md`
(review pass applied 2026-06-09; delivery under EP-ARCH-8D4F2A, BI-938D1B71).

### New column: *Governance Model* (`governance` axis)

| Value | Meaning |
| --- | --- |
| `investor-owned` | Default. Privately/investor-owned business; every pre-existing archetype normalizes here. |
| `member-owned` | Member-owners govern: one member one vote, elected board, annual meeting (credit unions, cooperatives). |
| `public-body` | Council/elected board under open-meetings and public-records law; fund accounting (towns, municipal utilities, law enforcement). |

### Column *Primary External Consumer* (`primaryConsumer`) — new values

| Value | Meaning |
| --- | --- |
| `member` | Owner-patron with governance rights; eligibility precedes account creation. |
| `resident` | Served party defined by jurisdiction: statutory rights, universal-service obligation, cannot be refused or churned. |

### Column *Commercial Model* (`commercialModel`) — new value

| Value | Meaning |
| --- | --- |
| `statutory-fees-and-levies` | Revenue arrives by levy/assessment/fee schedule set by ordinance or statute, not by sale. Billing derivation: obligation-driven ad-hoc invoice, prepared-not-prescribed. |

### Related (not an axis): `ledgerModel` on the finance profile

`commercial` (default) | `fund-accounting` | `financial-institution` | `cooperative-equity` —
see spec §6.2; lives in `packages/finance-templates`, not in the workbook axis columns.
