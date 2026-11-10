---
status: draft
---

# Complete and truthful MCP efficiency windows

BI-4BB68EB6; Workroom WC-A0A12240. This is the scoped repair of [consolidation design section 3](2026-09-04-mcp-client-contract-consolidation-design.md#3-honest-efficiency-measurement--bi-4bb68eb6), extending the [existing efficiency loop](2026-08-03-mcp-call-efficiency-loop-design.md). Recovery, Workroom pagination and hook presentation remain separate items.

## Objective

**OBJ-MCP-COVERAGE:** Operators and automated consumers can distinguish a complete requested-window assessment from partial diagnostics, without keeping the entire execution ledger in memory or taking corrective action from incomplete evidence.

## Acceptance manifest

| Acceptance | Objectives | Required outcome |
| --- | --- | --- |
| AC-MCP-COVERAGE-1 | OBJ-MCP-COVERAGE | More than 5,000 rows, including the newest failure and tied timestamps, are included exactly once when the scan completes. |
| AC-MCP-COVERAGE-2 | OBJ-MCP-COVERAGE | Requested bounds, observed bounds, included count, snapshot population and complete/partial disposition are explicit; an empty range is complete with zero rows and null observed bounds. |
| AC-MCP-COVERAGE-3 | OBJ-MCP-COVERAGE | Count and pages use one stable database snapshot. Inserts committed after snapshot establishment, including backdated rows, are excluded and eligible on a later scan. |
| AC-MCP-COVERAGE-4 | OBJ-MCP-COVERAGE | Memory, row and elapsed-time budgets are enforced. Exhaustion returns labelled partial diagnostics and a finite narrowing/restart action; database failure is an error, never a successful complete report. |
| AC-MCP-COVERAGE-5 | OBJ-MCP-COVERAGE | Interactive and daily consumers never create corrective BIs or dispatch AI Ops from partial scans. Any partial notification describes the range and gap, not a current full-window defect. |
| AC-MCP-COVERAGE-6 | OBJ-MCP-COVERAGE | Existing correlation, cadence, refusal and finding semantics remain covered through one shared reducer; headline denominators are explicit. Query duration and bounded state are measured. |

## Research and reproduction

At served commit 5f9571f023b043532d1102cd6754d1d701107988 on September 6, a seven-day read-only report returned 5,000 rows ending September 1, while a separate one-hour report returned current September 6 traffic. Evidence cmtqfxba705e501p34h1lhppx records the exact observations. Current source 3e3a1b297590a847488aad46c066351d1bda597b retains the defect in `apps/web/lib/operate/mcp-call-efficiency/report.ts`: ascending `findMany`, default `take: 5000`, no upper bound or population count. The recent-window control rules out an empty recent ledger; no notification or AI Ops dispatch was requested by either probe. Failing automated boundary tests are still required before runtime edits.

The existing pure analyzer copies full event arrays into per-tool and per-correlation groups. Its consumers are the optimization MCP pack and the 06:15 UTC daily scan. No independent report service, ledger, queue or database model is needed.

### Research & Benchmarking

| Existing pattern or standard | Apply | Boundary |
| --- | --- | --- |
| DPF pure efficiency analyzer and existing tests | Retain its public array adapter and finding vocabulary; feed the same reducer from ordered database pages. | Do not invent a second daily policy or rewrite refusal classification. |
| [PostgreSQL Repeatable Read](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-REPEATABLE-READ) | Establish count and page reads in one read-only snapshot, so concurrent inserts cannot change the population mid-scan. | Snapshot visibility is fixed at the first data statement, not merely the wall-clock end bound. A later request cannot resume the same ended transaction. |
| Existing Prisma interactive transactions | Use the installed client's isolation and timeout controls and parameterized queries. | Confirm its actual API and database query plan in tests; do not hold a snapshot across client requests or introduce a materialized result store. |

WWMD consult DI-DF8718070DA0 was recorded but returned `signalQuality.usable: false` due to unavailable embedding retrieval. Its advisory score is not approval. The scoped candidate below follows the user's existing refactoring instruction and the inspected architecture, single-source and governed-scope doctrine; independent review and empirical budget validation remain required.

## Proposed repair

### One bounded reducer

Refactor `analysis.ts` into a reducer accepting events ordered by `(createdAt, id)`. Keep `analyzeCallEfficiency(events, options)` as the sorting compatibility adapter. Retain only counters, first/last timestamps, the first five evidence IDs, first-event attribution and the previous event per correlation. Tool/correlation aggregates retain cadence and dominant-principal information. No aggregate retains raw `parameters` or entire event arrays.

Use a shared finite state-entry budget. A new distinct tool, surface or correlation aggregate that would exceed it stops ingestion before that event. Existing keys may continue only while scanning remains complete; never silently discard a key and continue claiming complete coverage. Bound each input page by both row count and projected scalar payload. Extract only the existing `ownerSessionId` correlation hint from parameters and the governed refusal classification from result; do not carry arbitrary JSON into the reducer. Audit current refusal-code extraction before replacing any projection.

Preserve tie behavior deterministically with `id`; test it explicitly. Keep the current headline success fraction (successful calls / all included calls) for compatibility, label that denominator, and separately expose governed refusals. Per-tool reliability continues excluding governed refusals. Findings remain bounded and ordered as before.

### Fixed-range scan

Freeze `[requestedStart, requestedEnd)` once per invocation. In one read-only RepeatableRead transaction, count eligible ToolExecution rows and read bounded pages ordered by `(createdAt, id)`, advancing strictly after the last processed identity. Feed pages immediately into the reducer and discard page data before fetching the next. Start with a conservative page size and finite elapsed/state budgets; choose production bounds from measured query cost rather than claiming an arbitrary cap is sufficient.

Retire the loader's unadvertised 5,000-row default as a meaning-changing cap. Keep a finite internal row-budget option for controlled diagnostics/tests, exposed as a budget in the result when used. The existing MCP request remains compatible. A normal scan walks the window until exhausted or a declared safety budget is reached.

Report additive `coverage` fields: requested and observed bounds, included count, eligible population count, snapshot establishment time and semantics, completeness, stop reason, scan duration, retained-state count and last processed identity. Existing windowStart/windowEnd remain observed-event fields for compatibility; null observed bounds in coverage disambiguate empty input. `ledgerSufficiency.usable` is false for partial input regardless of sample size.

When a budget stops the scan, return the exact checkpoint as diagnostic provenance and a supported narrowing/restart action. Do not expose it as a resumable same-snapshot cursor: the transaction has ended. A fresh narrowed scan has a new snapshot and is labelled accordingly. This explicitly replaces any suggestion in the parent draft that a cross-request cursor alone preserves the original snapshot. No automatic repeated scan loop is introduced. A database timeout/query failure returns failure and suppresses all actions; it does not fabricate a population count or partial success.

### One side-effect boundary

`runCallEfficiencyReport` owns the completeness check before either notification or AI Ops handoff. Complete scans retain existing behavior. Partial scans can emit one deduplicated coverage diagnostic naming requested/observed ranges, included/population counts and narrowing guidance. They never call the finding-notification loop or `dispatchMcpEfficiencyAiOps`, so no ImprovementSignal, corrective BI or reviewer dispatch is derived from a partial sample. The MCP headline and daily result both display this same coverage contract.

## Ordered fix sequence and backlog coverage

One atomic deliverable `complete-efficiency-window` maps to BI-4BB68EB6, OBJ-MCP-COVERAGE, CT-MCP-COVERAGE, FLOW-MCP-MEASURE and AC-MCP-COVERAGE-1 through AC-MCP-COVERAGE-6. Reducer, loader, action boundary and consumer messaging form one externally visible contract; shipping only a count or only a warning leaves the defect partly active. This design contains the fix plan; validate live coverage through the profile-aware writer before implementation.

1. Claim exact runtime/test paths and consume graph-related test advice. Reproduce >5,000 truncation and partial auto-dispatch at the report boundary with deterministic fixtures before edits.
2. Refactor the pure analyzer to bounded aggregates, retaining all existing tests and adding ordered-page equivalence, tied-time, bounded-state and refusal cases.
3. Replace the loader with fixed-range snapshot traversal and count. Test newest rows, ties, backdated late inserts, empty range, memory/state/row/time limits and query failure. Verify real PostgreSQL snapshot behavior in the shared test environment, not only mocks.
4. Route interactive and scheduled consumers through the same completeness boundary. Assert zero corrective writes and dispatches for each partial/error case, a labelled diagnostic when requested, and unchanged complete-scan actions. Update the existing efficiency guide and tool description.
5. Run affected tests, typecheck, required source guards and protected PR/merge checks. Release through the canonical pipeline, verify the served merge, then compare the live fixed-window count and report while recording query duration/state bounds. Record acceptance and close only this BI after all cases pass.

## Refactoring, risks and rollback

Allocate at least 20% of work to removing duplicate event retention and sharing policy across array, interactive and scheduled entry points. Measure retained aggregate state and definitions removed; formatting does not count. No UI route, auth expansion or migration is proposed. Existing observability consumers must tolerate additive coverage fields. Risks are changed finding order, correlation attribution, prolonged database snapshots and false completeness on a stopped scan; the tests above target each boundary. Revert the scoped reducer/loader/consumer change together through a PR. Never roll back evidence or disable grants.
