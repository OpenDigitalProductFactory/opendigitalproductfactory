# Operating-Model Axes — Accepted Additions (historical sidecar)

> **Authority notice (2026-08-01):** This sidecar preserves an earlier workbook-first
> decision; it is not the current normative source. The V3 workbook has an
> `undetermined` source-use decision (`SUD-PORTFOLIO-WORKBOOK-V3-2026-08-01`) and MUST NOT
> be used as new AI, mapping, conformance, or normative evidence until that decision is
> resolved. Current code and live data establish observed platform state; the
> [Portfolio Aligned Agent and Workforce Operating Standard](../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md)
> governs target semantics.

The historical taxonomy was maintained in
`4_portfolio_Reworked_V3_Definitions_IT4IT.xlsx`; its *Products and Services Sold* sheet
carried the then-current axis columns. This sidecar records additions accepted while that
workbook-first process was in force. Preserve it as decision lineage, and promote or
change current vocabulary only through the governed typed registries and the PAAW
source-use contract.

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
see spec §6.2; lives in `packages/finance-templates` and was not represented in the
historical workbook axis columns.
