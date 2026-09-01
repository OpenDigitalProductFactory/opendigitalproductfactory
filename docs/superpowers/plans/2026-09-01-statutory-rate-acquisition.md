---
status: active
---

# Statutory rate acquisition — propose, ratify, resolve

**Backlog item:** BI-8E1FD1BD (delivery path), BI-4EB27955 item 3 (`PayrollTaxRule`)
**Founder direction, 2026-08-27:** authorise the fetch, but route it through the proper AI coworker — *"this is where the very value of the AI Coworkers come into play and why we built this platform in the first place"*. If the coworker cannot do its job, complete the platform so it can.

## The gap this closes

The right coworker existed and could research. It had nowhere to put the answer.

- **AGT-WS-COMPLIANCE** — charter: *"watches recorded review dates, control review cadence, licence renewal and evidence freshness, and raises findings for a human to act on. Does not determine compliance, renew a licence, or submit a filing."*
- **AGT-905 (Licensing & Permit Specialist)** — *"jurisdiction layers… records evidence-backed findings, and raises factual readiness blockers without guessing legal facts."* Already the agent behind the `LicenseRequirementReference` corpus, which is the precedent for an acquired external corpus carrying citations.

Both hold `web_search`. Neither held any grant that could persist a statutory figure: the catalog carried 157 grants and not one wrote tax reference data. The Compliance Officer's entire write surface was `backlog_write` plus `policy_write`, and `policy_write` is honoured by exactly one tool, `propose_leave_policy`. So a researched IRS figure could become a paragraph in a backlog item and nothing more.

Three supporting pieces were missing or inert:

1. `PayrollTaxRule` — specified in BI-4EB27955 item 3, never built.
2. `packages/db/src/reference-freshness.ts` — a 90-day ceiling with a deliberate `unverified` vs `stale` distinction, founder-directed 2026-08-25, exported from the db index and imported by **nothing**. The clock written to stop being decorative was decorative again.
3. No readiness surface: an install with no figures looked exactly like one with fresh figures — both silent.

## The design

**One safety rule, expressed in code rather than convention:** an agent PROPOSES with a citation, a person RATIFIES, and `resolveStatutoryRule` returns only `ratified` rows. A proposal is a research finding, not an input to a filing.

- `PayrollTaxRule` — effective-dated per jurisdiction, tax type, kind, side and start date; carries `sourceUrl`, `sourceExcerpt`, `retrievedAt`, `proposedByAgentId`, `ratifiedByUserId`.
- `checkStatutoryProposal` refuses an uncited or undated figure **before** the write. A row that exists tends to get used, so it must not exist.
- `checkStatutoryRatification` refuses `agent_cannot_ratify` unconditionally. Without that, the split is decorative: an uncited figure computing withholding, with an audit trail that made it look reviewed.
- `assessStatutoryReadiness` separates *never researched* from *waiting on a human*, because those need different actions from a person. It also blocks on a stale or never-verified authority record — a figure confirmed against a page nobody has re-read is not one to file on.
- Two MCP tools behind `statutory_reference_propose`: `list_statutory_rate_gaps` (read the real gaps first) and `propose_statutory_rate` (one figure, one citation). **No ratify tool**, deliberately.

## Rates are still not seeded

Nothing in this plan invents a figure. `PayrollTaxRule` ships empty. A statutory figure is a fact about the world that must be read from the authority and confirmed by a person; seeding one would fabricate the exact evidence a filing depends on. What changes is that the gap is now **visible** and the acquisition path **exists**.

## Backlog coverage

**Blocking condition:** no initiative scope baseline exists for BI-8E1FD1BD, so a
live MCP coverage receipt cannot yet be bound to a governed scope. A baseline is
minted only by a passing `spec-approval` gate recorded by a reviewer independent
of the author. The canonical design is
[2026-09-01-statutory-rate-acquisition-design.md](../specs/2026-09-01-statutory-rate-acquisition-design.md).

Decision: **atomic**. Dependencies: **none**. Parent: **BI-8E1FD1BD**.

Atomic. Every piece here is one indivisible capability — the table, the safety checks, the readiness assessment and the two tools are useless apart, since a proposal with nowhere to land, a gate with nothing to gate, or a tool with no table each deliver nothing on their own. Tracked under BI-8E1FD1BD with BI-4EB27955 item 3 as its schema dependency.

## Known gaps this does NOT close

- **BI-67CAF494** — the `youth-sensitive` detector matches governance vocabulary rather than value-shaped evidence, and `vertical-youth-sensitive@1.0.0` clamps residency on a single inferred match. Until that is decided, a research coworker may still be routed local-only and be unreachable under contention. This plan gives it somewhere to deliver; that BI decides whether it can be reached.
- **BI-4EB27955** — the figures themselves, and the golden-case fixtures against published tables.
- Item 6 of BI-947F8703 — the 941/940/W-2/W-3/1099-NEC generators, which need cited form layouts under the same constraint as the rates.
