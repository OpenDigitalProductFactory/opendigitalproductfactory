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
   Defaults are 50 rows, 65,535 parameters and a 128 KiB prepared-parameter target.
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

Initial source-local verification on Node 24.16.0 observed 87 passing tests across the
SQL, clone, cursor/memory and source-integrity suites. The 10 PostgreSQL cases
were skipped because this worktree had no assigned database; their persisted
value, real PrismaPg transaction and cleanup proof remained unrun at that
checkpoint pending normal shared local-CI admission. Both DB TypeScript 7 programs passed. The SQL helper
had an earlier first-red run with 21 failures and 15 passes, then 42 passes.
The moved identifier/value conversion helpers retain their original bodies.
Canonical gate, independent review and publication evidence belong to the
Workroom and exact-commit PR record. No representative scale timing or served
two-route acceptance is claimed by these source-local checks.

**Owned PostgreSQL failure and bounded diagnosis.**

On 2026-10-21, owned lease `NPEL-D7FBEFA692` executed all 10 PostgreSQL cases
against source `a0c345d52e7e4855fdb8393e4a5706e0fb9850b9` on Node 24.16.0:
9 passed, 1 failed and none skipped. The real-writer retained-heap case observed
39,441,424 bytes against the unchanged 16,777,216-byte assertion. The preceding
canonical commands passed, but the supplemental failure made the outer result
inconclusive; evidence `cmvhxnjje0rot01o8vfrr5sp2` is not passing gate proof.
The original durable resumer automatically began another canonical attempt
before it was gracefully stopped. That attempt was interrupted before a second
PostgreSQL execution. Its mutable log is distinct from the first observed
PostgreSQL failure and must not be cited as the first run's report.

Installed Prisma 7.10.1 initializes its compiler during `$connect()`, but its
bounded diagnostic history also retains recent raw-query parameter strings and
query plans even when output is disabled. This is a concrete potential payload
retainer, not proof that it explains the entire observed increase. Diagnosis
therefore records connected, cold, every-batch and post-copy retained heap;
repeats the same 2,001-row real-writer path after it is warm; and deliberately
retains independent containers for 1,001 payload rows as a positive control.
The original cold baseline and raw 16 MiB assertion remain unchanged. A 20-second
test timeout permits the three measured passes. At the diagnostic checkpoint,
production transaction timeouts, copy policy, client history, dependencies and
memory limits were unchanged.

Separately coordinated owned experiments collect these controls before a product
payload-budget adjustment is considered. The private wrapper fences
each explicit experiment before canonical work and retains immutable canonical
and PostgreSQL reports on failure as well as success. An automatic repeat may
perform no new canonical or PostgreSQL work. The diagnostic checkpoint remains
distinct from a repair: its original cold assertion stays red until a product
change passes the same owned test. No throughput, representative setup-time or
served-route acceptance is claimed from the diagnostic controls.

**Measured retention and payload-budget repair.** The controlled experiment at
`24bce3d53a678f40ace68fcdf636f52397a061ac` executed 10 PostgreSQL cases: 9 passed,
1 failed and none skipped. Evidence `cmvhziopf09sk01lfyyeq80zv` is inconclusive,
not passing gate proof. Its retained-heap growth rose from 5,474,472 bytes after
50 rows to 39,380,232 after 700, then increased only 85,240 across the next 1,300
rows. The original cold peak was 39,465,472 bytes. The warmed 2,001-row pass grew
by at most 4,408,096 bytes, while deliberate retention grew by 33,092,760 and
fell to 53,168 after release. These measurements support a bounded payload-history
hypothesis rather than table-wide accumulation; they do not attribute every byte
to one internal client structure or make the cold 16 MiB failure pass.

At `b7a898600480e147991e1ad8c41e94450effbea2`, reducing the target from 1 MiB
to 256 KiB lowered the cold peak to 20,673,384 bytes, but the same 16 MiB
assertion still failed. The same-path warm peak was 3,647,488 bytes; the positive
control retained 33,092,968 and fell to 52,496 after release. All 10 PostgreSQL
cases executed: 9 passed, 1 failed and none skipped. Canonical checks passed,
but evidence `cmvhzvpv90fzd01lfs807455u` is inconclusive and is not final gate
qualification. Preserve this failed experiment separately from any later result.

Reduce only the current default prepared-payload target from 256 KiB to 128 KiB. Keep the
50-row and 65,535-parameter limits, ordered casts/defaults/conflicts, transaction
owner and oversized-single-row exception. Smaller values still permit 50-row
statements. In the measured fixture, JSON serialization and other columns make
each 32 KiB payload row approximately 32,810–32,820 prepared bytes. The target
change permits three rows per statement instead of seven: 17 statements per
50-row callback instead of eight (681 instead of 321 across 2,001 rows).
This trades more large-payload round trips for a smaller
per-statement prepared payload. Whether this keeps the unchanged cold retained-heap
bound must be established by the final owned run. It is not a wire or total-heap
ceiling and does not guarantee any representative clone time. The measured
256 KiB result establishes no safe memory margin for 128 KiB. The literal
128 KiB boundary regression first observed `[3, 2]` instead of `[2, 1, 1, 1]`,
with 41 incumbent SQL tests passing. Preserve the cold 16 MiB assertion, all measured
controls and the real PrismaPg writer. Final owned qualification requires the
complete exact-source experiment to pass this changed default; its actual outcome
belongs in the Workroom and PR record, separately from source-local checks.


**October 28 follow-up: stream the incumbent cursor order (BI-B47BB1D7).**
The bulk writer is already deployed. A read-only, five-second-bounded EXPLAIN
on the canonical database found a top-level Sort over an estimated 14,541,988
telemetry rows, sorting solely on the generated row-number expression. The
native preview stopped before serving after 20m33s; the collapsed terminal
category does not prove which liveness check fired. No full-copy timing or
repair success is inferred from planner estimates.

The bounded repair is to expose the same original ordering keys at the outer
join, followed by the existing ordinal as the final tie breaker. This is
lexicographically equivalent to the incumbent ordinal order, including tied
keys. For the observed ID-ordered table, PostgreSQL instead plans an Incremental
Sort with id as its presorted key; estimated startup cost changes from6580321.35
to1.76 in planner units, not milliseconds. The remaining transaction overhead
still needs real measurement. Physical ctid fallback, audit LIMIT/direction,
User ranking/COALESCE, all source rows, sanitization, native omissions and the
50-row read window stay unchanged. No classification, data policy, source or
runtime mutation, timeout, privacy or lease-fence change belongs to this repair.

Ordered loop: exercise the actual cursor-query builder; observe the old outer
sort fail the original-key regression; add the ordering prefix and retain the
ordinal tie breaker; compare actual PostgreSQL legacy/repaired ordered values,
audit cohort, user aliases and cursor batches; run all clone, source-integrity,
cleanup/memory tests and DB typecheck. Run the PostgreSQL proof only through
the governed shared test database, then normal exact-tree integration, review,
DCO and protected publication. After normal canonical release, measure one
full-cohort startup with unchanged bounds before resuming approval-screen QA.
The existing six acceptance obligations above remain obligations; this targeted
source repair does not claim sampling policy, scale timing or served acceptance.
PostgreSQL documents explicit multi-key ordering and planner startup costs at
https://www.postgresql.org/docs/current/queries-order.html and
https://www.postgresql.org/docs/current/using-explain.html.

## October 28 continuation: measure the remaining copy cost

The operator explicitly authorized the bounded test-environment repair in the
paired approval chat, followed by one repaired full-size screen-verification
attempt. The direct human reply was independently retrieved before resuming.
This does not authorize a third unchanged preview, sampling, larger read windows,
longer timeouts, more memory, new grants or an alternative deployment route.

The ordering repair is installed. The next admitted full-cohort attempt,
`NPEL-DD3E51BE41`, still stopped before serving after 20m33s. Its telemetry phase
began with 14,523,204 source rows; read-only destination counts progressed from
1,220,000 to 10,937,800. The reservation was released and no owned containers
remained. Native activity `cmvst8r8h08ph01k0xctzucck` and skipped verification
`RV-APPROVAL-PREVIEW-5EAA-20261029` retain this infrastructure-inconclusive result.
Neither failure is evidence that the approval UI failed.

The caller still supplies 50 rows to each writer invocation. The writer's
500-row ceiling does not combine invocations. Database-wide observations over
43.368 seconds counted 9,746 committed transactions and 485,706 inserted tuples.
These observations support measuring transaction cost; they do not isolate it
from source fetch, transformation, statements or other database work.

**OBJ-COPY-COST:** Make the existing full-cohort clone usable within its unchanged
startup budget without changing data, privacy, memory or publication semantics.
The original six acceptance obligations above remain verbatim and unresolved
where not evidenced. This preservation-only source slice does not introduce
the separately owed data-owner sampling policy.

`CLONE-PHASES` records aggregate row/batch counts and elapsed source-fetch,
sanitization and destination-write phases, never row values, SQL arguments,
credentials or per-row events. `CLONE-STREAM` retains one fetched 50-row array,
awaited destination backpressure, the existing 128 KiB statement target and
native omissions. `CLONE-TRANSACTION` retains the current 500-row transaction
ceiling, 10-second acquisition and 30-second transaction timeout. Existing
`CLONE-ROWS`, `CLONE-ATTEMPT` and `CLONE-PUBLISH` remain authoritative.

Ordered internal phases, one atomic BI-B47BB1D7 delivery:

1. `FLOW-MEASURE`: add bounded, aggregate phase measurements through the actual
   confidential-copy caller. Extend the existing governed PostgreSQL fixture
   with telemetry-shaped rows and the existing wide JSON/vector positive
   controls. Record source fetch, transform, write and transaction counts plus
   total elapsed time. No production benchmark or new full clone is needed to
   choose a source change. A first-failing diagnostic-contract test precedes
   implementation; measurements must not retain row payloads.
2. Select a repair only from those measurements. If destination transaction
   round trips dominate, compare the current per-50-row transaction path with
   bounded streamed groups inside the existing 500-row ceiling. Fetch the first
   batch before acquiring a destination transaction; do not put cold source
   startup inside its timeout. Await every write and release its array before
   fetching again. Never aggregate ten raw batches, increase the cursor window,
   carry a transaction between tables or retain it after failure. Keep trigger
   suppression on its transaction connection and metadata local to the attempt.
   If measurements do not support this candidate, record the result and revise
   the selected repair before changing behavior.
3. `FLOW-STREAM-COST`: prove exact ordered persisted values and duplicate winners,
   audit cohort, aliases, type/default/null behavior, statement limits and
   bounded transaction size with the real caller. Keep existing memory and
   deliberately retained-payload controls. Inject fetch/write/commit failures
   and prove source read-only snapshot, rollback, destination cleanup and no
   partial publication. The failure of any group aborts the whole clone.
4. `VC-PHASES`, `VC-STREAM-PG` and `VC-COPY-FAILURE` cover the diagnostics and
   behavior above. Run all clone, batching, SQL, cleanup, source-integrity and
   memory suites and both DB typechecks, then the normal exact-tree integration
   gate, independent review and protected DCO publication. Compare real elapsed
   phases; fewer mocked transactions alone are not a performance result.
5. Only after normal canonical release contains the verified repair, execute
   `VC-FULL-STARTUP`: one full-cohort preview with unchanged limits and actual
   counts, elapsed time, memory and readiness identity. A terminal failure is
   inconclusive for UI, never permission for another unchanged attempt. If
   ready, continue the separately owned approval-screen baseline, fixtures,
   accessibility, narrow viewport, disclosures, live acceptance and delivery.

The diagnostic and selected source change are internal sequencing: neither is
accepted as a separately completed performance repair. Rollback is a normal
source revert and governed release; no migration or source-data edit exists.
The Workroom records the immutable coverage receipt and actual measurements.

The continuation's immutable coverage is `cmvswfuh91d7j01k0zzhnfz4n`, bound to
`ea28f3a4c91b53b4db03d171ef591d9937a0c16c`. Governed PostgreSQL measurement on
diagnostic source `d0cc35d6baf71c7e3779e7f59999687d153469f5` copied 50,001
narrow fixture rows in 4,763.97 ms: 678.61 ms fetching, 23.90 ms sanitizing,
4,048.30 ms across 1,001 destination transactions, and 2,048.58 ms inside their
callbacks. About 1,999.72 ms (42% of total elapsed) lay outside the callbacks.
This includes acquisition, framing and commit; it is not isolated server WAL
latency or a full-cohort performance result. An earlier unmatched sample has
different timing and is not a speedup comparison. Evidence:
`cmvswyrgx1h1g01k0itoukm9x`.

These measurements select the planned streamed-transaction candidate. The
existing direct writer keeps its original behavior. The actual confidential
caller uses a shared attempt-local writer and scoped cursor reader; a reader
cannot fetch ahead of an unreleased array or finish before EOF. Consecutive
50-row writes share at most a 500-row destination transaction. A one-second
group-age check includes source fetch, transformation and inserts and ends
groups only between batches. An already fetched but unwritten window can carry
across that commit; no second window is retained. A blocked in-flight operation
is still subject to the existing transaction/runtime fences: the age check is
not a promise to interrupt PostgreSQL mid-query. Cold first fetches happen
before transaction acquisition. Errors abort the attempt and retain whole-clone
cleanup and publication isolation, including after earlier groups committed.

Diagnostics now name nested transaction/callback and insert time explicitly;
these axes overlap fetch and transformation inside a streamed group and must
not be summed. Qualification compares identical source/order/value/cohort under
50 and 500 transaction ceilings in both execution orders, with actual persisted
duplicate winners and omitted vectors. Original cold/warm/retained-payload
controls stay ordered; an additional fresh-client streamed wide-payload case
keeps the same 16 MiB bound, measured after each awaited 50-row window of inserts inside the
real destination transaction as well as after COMMIT. A paired positive
control deliberately retains more than that bound during the callback and
clears it before COMMIT: the inner probe must detect it while the old
post-transaction probe misses it. Source-only counters do not declare this repair
qualified. Its PostgreSQL, gate, review, canonical release and one full-size
startup outcomes remain to be recorded.
