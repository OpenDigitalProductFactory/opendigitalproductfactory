---
status: active
---

# Preserve sanitized-clone data while batching destination writes

BI-B47BB1D7 · WC-C95D3767 · `codex/sanitized-clone-batching`.
Source baseline: `d091a1f4da672fb77c170a7de1e80c782bc025d3`.

## Objective and supported scope

Remove serial destination INSERT round trips and repeated table metadata reads
from the existing confidential clone path. Keep the full existing dataset and
one clone/publication owner. This implements the item's preservation-only
proposal before any consideration of sampling, retention or fixture policy.
No data policy, authority, lease fairness, source data or runtime changes belong
to this repair. Representative setup time and served acceptance remain unrun
until observed on the governed target; fewer statements are not a timed result.

## Original acceptance obligations

The existing item records these obligations verbatim; this source slice does
not claim its later policy, scale, progress or served criteria completed:

- Establish a recorded, data-owner-approved preview sampling/retention or fixture policy for high-volume telemetry, preserving required relational integrity and representative UI evidence.
- Prove bounded setup time and memory with a source dataset including at least this scale; publish timing and selected/copied counts without confidential values.
- Preserve restricted-table exclusion, deterministic sanitization, source read-only behavior, disposable destination isolation, admitted source/lease binding, owner cleanup and failed-clone fencing.
- A failed/interrupted initialization never serves a partial clone as ready.
- Show progress and expected remaining work in the existing governed preview flow; no silent wall-clock wait or duplicate claim loop.
- Do not solve by increasing heap, deleting source telemetry, bypassing lease approval or silently treating fixture assertions as live provider health.

## Research and design grounding

Current `sanitized-clone.ts` fetches 50 confidential rows per cursor callback,
then opens a bounded transaction, queries destination column types and executes
one INSERT per row. The 500-row transaction policy does not combine independent
50-row callbacks. Public/internal tables already use binary COPY. The four named
audit-table limits, restricted exclusions, user ranking and native-vector/search
omission retain their existing owners and behavior.

Reuse the July 20 transaction-scaling and atomicity plans, October 11
external-client-verification plan and current `sanitized-clone-batches.ts` /
`sanitized-clone-cleanup.ts`. PostgreSQL's documented query-parameter ceiling is
65,535: <https://www.postgresql.org/docs/current/limits.html>. Retain parameterized
SQL, existing casts and quoted identifiers. Do not switch to a new COPY encoder,
grow the read window, create a data service or cache schema metadata globally.

The existing preview initializes from the running canonical image, not candidate
clone source. A source PR cannot accelerate that path until normal canonical
release contains it. The 20-minute contended preview yield remains unchanged.
Renderer/auth/route fixtures are not a supported smaller-data initializer.

## Contract and ordered implementation plan

This is one atomic delivery under BI-B47BB1D7. `CLONE-ROWS` requires exact ordered
row/type/null/default/conflict behavior. `CLONE-BOUNDS` requires finite statement
rows and parameters, with a prepared-parameter payload target and an oversized
single-row exception rather than a hard wire-packet or total-memory ceiling.
`CLONE-ATTEMPT` requires destination metadata reused only inside one clone attempt.
`CLONE-PUBLISH` retains transactional replica posture and cleanup/failure fencing.

1. `FLOW-REPRO`: observe the 50-row/50-statement regression before changing the
   writer; retain existing cast, cleanup and cursor tests. Record research.
2. Move the existing parameter/identifier helpers unchanged to one internal
   `sanitized-clone-sql.ts` home and preserve their incumbent exports. Add a
   bounded multi-row statement iterator, splitting contiguous differing column
   sets without reordering rows or replacing omitted defaults with nulls.
   Keep `ON CONFLICT DO NOTHING`. A single row larger than the payload target
   still uses its own statement; the bound must not silently omit or reject
   data previously accepted. Enforce the parameter ceiling before SQL execution.
   Defaults are 50 rows, 65,535 parameters and a 1 MiB prepared-parameter target.
   Statement-level trigger boundaries intentionally become batch boundaries;
   ordinary trigger suppression remains pinned to each bounded transaction.
3. `FLOW-COPY`: have the existing transaction writer consume those statements;
   retain the 50-row source window, current transaction row ceiling, timeout,
   `SET LOCAL session_replication_role = replica` and backpressure. A writer
   factory created once per clone owns only destination table-type metadata;
   a new attempt gets a fresh map. Failed metadata reads cannot poison a retry.
4. `FLOW-FAILURE`: prove first/middle write failure propagates and the existing
   clone owner resets the destination; do not swallow errors or serve partial data.
5. `VC-UNIT`: run related/colocated sanitization, source-integrity, cursor,
   payload-memory and SQL boundary tests plus DB typecheck and source guards.
   Graph advice names the existing clone unit/PostgreSQL tests; empty advice
   for new SQL/memory files expands to the complete scoped clone corpus.
6. `VC-PG`: through an owned governed nonproduction PostgreSQL target, compare
   real persisted values against fixed expectations for incumbent conversions and mixed
   column sets/defaults, JSON/arrays/enums/numerics/dates/bytes/nulls, duplicate
   conflict winners and failures. Exercise the actual transaction writer;
   the old PostgreSQL fixture's handwritten row loop cannot qualify the repair.
   If no owned target is available, record this proof unrun and request normal
   shared admission; do not start an unmanaged database.
7. `VC-SCALE`: after normal release, measure a governed representative clone's
   copied counts, setup phases, memory and elapsed time. Original 14.5-million-row
   scale and two-route served verification are outstanding until actually run.
   Use normal exact-tree verification, independent review, DCO and ready-PR
   publication. No merge, install or production mutation is authorized here.

## Scope, risks and rollback

Source scope is the clone writer, new internal SQL helper, their unit tests,
existing PostgreSQL/memory fixtures and this ordered design. No schema,
classification, retention, lease, preview/auth or deployment file changes.
The claimed impact contract is resolved; doc-index freshness is a derived
obligation and requires its own normal scope coordination if bytes change.

Risks are changed duplicate winners, omitted-column defaults, incorrect casts,
placeholder offsets, statement-size retention, stale cross-attempt metadata and
swallowed failures. Tests pair normal/adverse persisted values and bounded
statement counts; no performance promise follows from mocks. Revert the source
repair as one commit through the ordinary release path; no data migration exists.

## Backlog coverage and verification state

Atomic owner: BI-B47BB1D7. Requirement refs: CLONE-ROWS, CLONE-BOUNDS,
CLONE-ATTEMPT, CLONE-PUBLISH. Contract refs are the same named contracts above.
Flow refs: FLOW-REPRO, FLOW-COPY, FLOW-FAILURE. Verification refs: VC-UNIT,
VC-PG, VC-SCALE. Native research receipt:
`initiative-3e8b610f-4327-417c-8e48-a488d105b6bf`. The first regression observed
50 INSERTs against expected one, with 34 existing tests passing. Native atomic
coverage `cmvhuil3jkrsv01ldse9s057q` binds the initial immutable plan at
`fcc04d128fa6cdbaa1950d7ddef9b9faa9e33d38`; implementation admission
`IRD-90A56FE3E9C1` allowed this scoped source work.

Source-local verification on Node 24.16.0 observed 87 passing tests across the
SQL, clone, cursor/memory and source-integrity suites. The 10 PostgreSQL cases
were skipped because this worktree has no assigned database; their persisted
value, real PrismaPg transaction and cleanup proof remains unrun pending normal
shared local-CI admission. Both DB TypeScript 7 programs passed. The SQL helper
had an earlier first-red run with 21 failures and 15 passes, then 42 passes.
The moved identifier/value conversion helpers retain their original bodies.
Canonical gate, independent review and publication evidence belong to the
Workroom and exact-commit PR record. No representative scale timing or served
two-route acceptance is claimed by these source-local checks.
