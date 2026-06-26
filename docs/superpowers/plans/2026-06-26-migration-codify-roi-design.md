# Self-driving migration signal (2) — cost ROI ranking (design note)

- **BI:** BI-A028AA14 (the keystone) — signal (2) of the nomination set
- **Epic:** EP-COST-001
- **Date:** 2026-06-26
- **Status:** stats core shipped with this note; companion to signal (1) (see 2026-06-26-self-driving-migration-nomination-signals-design.md)

## Why

Signal (1) (`tool-reasoning-stability`) finds WHICH agent-reasoning patterns are
codifiable (recur with low output variance + high success). On its own it can
nominate dozens of candidates with no priority. Signal (2) adds the ROI axis:
**which codifiable patterns are worth codifying first** — the ones burning the
most capacity. Codifying a high-cost stabilized pattern into deterministic code
saves the most inference spend (responsible-capacity-utilization), so it ranks
first.

## What shipped

`apps/web/lib/observability/migration-codify-roi.ts` — pure, deterministic:

- `summarizeCostPerPattern(samples)` — rolls per-call cost into a
  per-(agent x tool x input-shape) summary `{invocations, totalCostUsd,
  avgCostUsd, totalTokens}`. Non-finite/negative cost or tokens count as 0.
- `rankByCodifyRoi(candidates, costByKey)` — joins signal (1)'s "stabilized"
  candidates with their cost rollup and ranks by total cost burned (desc;
  no-cost candidates last; deterministic tie-break by recurrence then key).

Fully unit-tested. It declares its own minimal `CodifyCandidate` shape rather
than importing signal (1), so the two signals compose without coupling.

## Cost source

v1 uses `ToolExecution.costUsd` / `inputTokens+outputTokens` (per tool call —
composes 1:1 with signal (1)'s grouping). `AdapterRunTelemetry` (per inference
run, finer-grained) is the future refinement noted in the BI; the function is
source-agnostic (caller extracts the samples), so swapping the source needs no
change here.

## Boundaries (unchanged from the keystone design)

Detection only — it never files anything. Turning a ranked candidate into a
`triaging` "codify X" BI is the **founder-gated** auto-nomination wiring; until
that review, the output is report-only.

## Next

With signals (1) + (2) in place, the keystone's core detection foundation is
ready: a report that lists codifiable patterns ranked by ROI. Remaining signals
— (4) surface friction (EP-HX-LOOP), (5) work-tier descent trend — and the
report-only surfacing + the founder-gated auto-nomination loop are the follow-ups.
