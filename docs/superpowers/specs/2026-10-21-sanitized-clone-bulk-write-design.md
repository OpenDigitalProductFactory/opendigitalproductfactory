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

## November 2 continuation: observable long-table copy progress

This is a design-only continuation of BI-B47BB1D7 in WC-54651F1C, admitted
by IRD-63778B928D18. The original acceptance obligations above remain verbatim.
No data-policy decision, implementation admission, reviewer verdict or new
preview authorization follows from this document.

### Current evidence and design grounding

On current source 49d845230041e48237968659a5a72d0c41e86322,
`packages/db/src/sanitized-clone.ts` has Git blob
`93ffff98a1105de57b224270d828f9c472f98e6e`. Its `copySanitizedTable` emits
`[sanitized-clone-phase]` in `finally` only. The cursor already counts fetched
rows and batches in `sanitized-clone-batches.ts`; the actual writer lives in
`sanitized-clone.ts`, not a separate writer module. A long table therefore has
no interim progress from the phase metric even while awaited batches complete.
This is source evidence of an observation gap, not a cause for transport timeout.

C108 retained clone start and completion approximately 10m4.931s apart. Its
QueueTelemetryEvent processed count and independent destination count both
were 6,266,206. The 223 instrumented phases and 8,452,558 processed rows are not
an all-table total or original 14.5-million-row scale proof. C108 later lost
controller authority. CDA8 retained only clone start and partial completed
phases before EOF; its controller exited1 without readiness. Both reservations
are terminal. Earlier source/fixture results do not replace those outcomes.
The existing BI-18A74F86 owner handles controller diagnostics and fencing; this
continuation does not change that controller or claim its transport cause known.

Reuse the current counters and normal foreground initializer output. Do not add
a table, service, polling endpoint, progress database or browser refresh timer.
The existing background-operation observation contract remains authoritative
if a future separately scoped renderer consumes these events. This slice makes
the actual long-table operation observable to its current controller/agent;
it does not claim to deliver a new browser progress component.

### Objective and acceptance

**OBJ-PROGRESS:** A contributor observing an admitted confidential table copy can
see bounded aggregate forward progress before the table finishes, and can tell
processed work from estimated remaining work and from durable copy success.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-PROGRESS-1 | OBJ-PROGRESS | Emit a bounded aggregate progress event during a multi-window copy before terminal table completion, at most once per elapsed one-second interval, plus a final completed or failed event. |
| AC-PROGRESS-2 | OBJ-PROGRESS | Progress contains only table identity, elapsed time and scalar counters; it never retains row arrays, values, SQL arguments, credentials or per-row events. |
| AC-PROGRESS-3 | OBJ-PROGRESS | Name fetched, processed and committed semantics explicitly. Existing cursor `rows` counts fetched rows and must not become a claimed durable persisted-row count. |
| AC-PROGRESS-4 | OBJ-PROGRESS | An existing displayed separate-connection table count may be labeled an estimate only. Remaining rows are an estimate with a floor of zero, never snapshot equality or an ETA guarantee; missing estimates remain unknown. |
| AC-PROGRESS-5 | OBJ-PROGRESS | Preserve the final phase event shape and completed flag for existing observers; intermediate events use a distinct marker and cannot create duplicate terminal phases or readiness. |
| AC-PROGRESS-6 | OBJ-PROGRESS | Keep one 50-row fetched window, awaited writes, current statement/transaction ceilings, source read-only snapshot, error propagation, cleanup/publication fences and every existing timeout unchanged. |

### Ordered implementation and verification

This continuation is one atomic progress fix under the existing BI. The
following are internal verification phases, not independently delivered fixes.
No progress-only receipt closes the item's other policy and full-scale criteria.

1. `FLOW-PROGRESS-RED`: add a deterministic test around the actual confidential
   caller seam. With an injected monotonic clock and several awaited windows,
   observe that the current code emits no interim event before table completion.
   Record the failing behavior and the exact bound source before requesting
   implementation admission. Tests must not require a live model or preview.
2. `CLONE-PROGRESS`: extend the existing copy instrumentation with an optional
   scalar-only observer at an awaited window boundary. Compose the callback at
   the caller, after a successful awaited write, and throttle by the injected
   monotonic clock without an interval/timer. Do not retain payload windows or
   fetch ahead. A synchronous logging failure must not masquerade as completed
   clone publication; specify and test its error behavior explicitly.
3. `CLONE-COUNT-SEMANTICS`: pass the already obtained displayed count as an
   optional estimate; do not add source COUNT queries or touch the held cursor
   snapshot. For audit tables use the selected limit as an estimate. Report
   observed processed rows separately from approximate remaining rows; allow
   observed work to exceed the estimate without hiding rows or moving backwards.
   Do not report committed counts until a real transaction-commit observation
   exists; this slice may omit that field instead of guessing.
4. `VC-PROGRESS-UNIT`: prove pre-completion emission, one-second throttling,
   finite/nondecreasing counters, empty/small copies, unknown and stale estimates,
   final success/failure, distinct marker compatibility, no payload retention,
   and no extra reads/writes. Extend existing clone/cursor tests rather than
   creating a duplicate copy implementation. Run the full related clone corpus
   and both DB typechecks once compile readiness is established.
5. `VC-PROGRESS-PG`: on normally admitted shared PostgreSQL, exercise the actual
   writer and compare identical persisted ordered values, duplicate winners and
   query/transaction bounds with observation enabled and disabled. Inject a
   later fetch/write/commit failure and prove the existing owner resets the
   destination and publishes no partial ready target. Retain the existing cold,
   warm and positive-control memory checks; no ceiling is raised.
6. `VC-PROGRESS-LIVE`: after protected delivery and a containing canonical
   release, coordinate one normally admitted next attempt with the sole preview
   owner. Retain interim aggregate progress, final phase/raw hashes, actual
   source/image/module/lease identities, elapsed time, separately measured
   memory, initializer/controller outcomes and actual readiness. An unchanged
   terminal failure does not permit replay. Browser-route acceptance remains
   separately owned and requires actual served evidence, not log success.

### Scope, prerequisites and rollback

Proposed runtime paths are the existing clone caller, cursor/writer seam and
colocated tests; any helper must first be checked against existing substrate.
The current claim admits editing this design only. Expand exact path claims,
consume the resulting impact contract, record immutable coverage and satisfy
current native research/implementation admission before code changes. The
present worktree is source-only: no pnpm, Prisma, typecheck or Vitest result is
claimed. Node-only design checks are not runtime qualification.

Doc impact currently names the derived doc index: check
`node scripts/gen-doc-index.mjs --check`, and claim its exact generated path
before any regeneration. All source impact tests and guards belong in the
updated contract before Red. Runtime shared gates, release and preview admission
remain under the canonical coordinator; this design starts none of them.

Rollback is a normal source revert of the progress extension and governed
release. No migration, source-data deletion, retention change, heap increase,
new credential, lease bypass, provider activation or longer timeout exists.
The original data-owner policy, original-scale time/memory and complete served
acceptance remain open until their own evidence and decisions exist.

### Existing peer-demand overlap

Exact native read of BI-8F70BBA5 confirms the same original preview-progress
and expected-remaining-work obligations and the peer-demand/federated origin.
It has no active Workroom on this read. It is a read-only peer-origin demand,
not a second implementation assignment or permission to modify that record.
Keep local implementation/evidence on BI-B47BB1D7 and reconcile delivery through
the existing same-organization work synchronization. This is a bounded exact
record check, not a claim that all backlog work was searched. The existing
`2026-10-11-external-client-verification.md` plan remains the served-route and
fixture verification context; its browser coverage is not replaced by progress
log observations.


### November 2 source implementation checkpoint

The earlier source-only checkpoint is superseded: managed dependency bootstrap
is complete. Research receipt `initiative-c78447ab-908a-4264-bc90-4addd4bc3858`
records the current caller reproduction. Medium implementation admission
`IRD-B02D1549DBEB` and atomic coverage `cmw04uhd81n0a01n2pqwl2hnb` bind this
continuation to BI-B47BB1D7 and the published design at `dc203d4046c3883ad2f0fb97a0120d16d955b292`.

The implementation extracts existing terminal instrumentation into
`observeSanitizedTableCopy` in the same module and connects its throttled observer
to the existing writer after awaited insertion and payload-window release.
Processed rows count attempted rows whose inserts returned, including conflict
skips, and do not claim durable committed rows. The existing count is an estimate;
unknown totals remain null and stale remaining estimates stop at zero. Observer
errors propagate through the transaction and whole-clone cleanup path. No timer,
extra query, retained payload, timeout change or new service is introduced.

The first writer regression failed with zero notifications where one was expected.
After the repair, all 116 tests in the five source-local clone suites passed.
Both DB TypeScript programs passed. The PostgreSQL cases now compare observer
enabled and disabled using identical values and duplicate winners, exercise
failed-copy terminal reporting, and retain the original memory and positive
controls with observation enabled. Those PostgreSQL cases are not yet executed
for this change. The earlier Windows host guard result remains INCONCLUSIVE;
no exact-source integration, protected delivery or live acceptance is claimed.

## November 3 bounded scale qualification plan

Existing item BI-B47BB1D7; Workroom WC-54651F1C. Plan admission IRD-999518F97C46. Preparation only: not an admitted heavy execution or completed acceptance.

Literal original scale criterion:
> Prove bounded setup time and memory with a source dataset including at least this scale; publish timing and selected/copied counts without confidential values.

The criterion does not require identical historic bytes. Use an explicitly synthetic 14,523,204-row PostgreSQL cohort; retain original NPEL-DD3E51BE41 source provenance UNKNOWN. Synthetic copy throughput cannot establish full installation startup or real-data UI fidelity. The current-source served preview remains separately required.

Grounding: existing packages/db/src/sanitized-clone.postgres.test.ts provides random owned schema/public fixture names, actual copyRowsForSanitization/createSanitizedCloneWriter/observeSanitizedTableCopy, read-only source transaction and finally cleanup. QueueTelemetryEvent schema is packages/db/prisma/schema/work-coordination.prisma:947. It has eleven scalar/date columns, primary key and four secondary indexes; the existing three-column narrow JSON fixture is not identical.

Plan:
1. Extend the existing design with this bounded verification phase, keeping all six original criteria verbatim. Refresh immutable coverage and normal native admission before test implementation.
2. Extend the existing PostgreSQL corpus with an opt-in scale case, never a default 14.5-million-row CI burden. Reuse actual QueueTelemetryEvent column/index shape via disposable fixture DDL and synthetic deterministic values. Never use or alter the installed table. Match source and destination metadata under unique owned names. Generate input server-side; retain no source-sized client array.
3. Actual cursor 50; writer transaction ceiling 500; statement target128KiB; acquisition10s; transaction30s; original 20-minute clone ceiling unchanged. Source begins REPEATABLE READ READ ONLY after fixture preparation. Time fixture preparation separately, and include schema/index/copy/validation times explicitly. Do not label one-table elapsed as full-preview startup.
4. Observe real-clock progress and scalar counts through existing observer. Compare independent source and destination COUNT, payload mismatch count and deterministic sanitization checks without string_agg of the cohort or row output. Exact 14,523,204 source/persisted rows required. Keep existing failures/duplicates/vector/wide-payload tests as separate behavioral proofs.
5. Retained-heap measurement uses existing GC methodology with explicitly named sampling cadence and unchanged16MiB bound. Retain RSS/peak and runner resource identity separately. Existing per-window wide-payload controls remain authoritative for intra-transaction retention; sparse scale sampling cannot replace them. Record measurements and actual result even on timeout.
6. Execute only on an ordinarily admitted existing qualification environment, one bounded run and cleanup of exact owned fixture names in finally. No new provider, production runner, live restore, retention/sampling/heap/timeout change, or competing preview. Resource admission must account for source/destination/index/WAL storage before setup.
7. Changed test/design bytes need new exact-head qualification, independent assessment, normal protected PR and containing canonical delivery. Previous302e receipts are historical proof only for their bytes. After delivery, sole preview owner runs current-data full clone and served-route checks with identities, progress, readiness/failure fencing and cleanup evidence.

Impact contract resolved on existing design and PostgreSQL test paths. It additionally retains related clone suites/both DB typechecks, doc-index check, preflight, exact-tree integration and PR health. No new application runtime path or UI surface. Rollback is normal source revert plus governed fixture cleanup. Any resource admission refusal stops the heavy run.

Open decisions for implementation preparation: existing shared qualification command must support explicit opt-in without modifying unrelated CI selection. If no supported invocation exists, claim the minimal existing runner path and update impact/admission first. No test or environment run was started by this proposal.



### November 4 scale qualification preparation

Atomic coverage `cmw31t5q00cij01qqf4rntmek` binds this plan at published
`6a190082ddc2f32e4efc56460d512bcd727f5d78`; implementation admission is
`IRD-C62274A8DA8A`. The single mapped delivery remains BI-B47BB1D7.
The opt-in PostgreSQL case uses the actual telemetry table shape and indexes
through disposable fixture names and the existing cursor/writer/observer.
`DPF_CLONE_SCALE_QUALIFICATION=14523204` selects the case; it is not resource
admission. Source generation, copy and aggregate comparison are separately
identified, and the report explicitly denies full-preview-startup equivalence.
The source snapshot ends before reading destination commits. Memory probes
sample after 10,000 processed rows and completion; the existing per-window
wide-payload controls remain required. The case records ordinary cleanup
completion, while forced termination still needs the owning runner's fencing
and cleanup evidence. Its 20-minute timeout does not itself prove that fencing.

Both DB TypeScript programs passed after the test addition. Discovery without
a database or scale selector skipped all 19 PostgreSQL cases; none passed or
executed in that check. The new scale case remains UNRUN. Independent review,
actual resource admission, PostgreSQL execution, qualification of the changed
source, protected publication and served acceptance remain outstanding.

### November 5 qualification runner continuation

Plan admission `IRD-5AEB35C12599` retains BI-B47BB1D7 as one atomic repair.
The existing CI Calibration workflow supplies an ephemeral PostgreSQL 16
service and applies the current migrations. Extend
`.github/workflows/ci-calibration.yml` with a default-false boolean manual
input `clone_scale_qualification`. Only a manual dispatch with that input true
runs the exact synthetic scale test after migrations, with a 20-minute step
limit and the selector environment variable scoped to that step. Scheduled
and ordinary dispatch behavior remain unchanged. Reuse the existing artifact
upload and 30-day retention for scalar logs and the Vitest JSON report; retain
the real exit status and reject a report with zero executed target tests.
The runner service lifetime provides isolation; ordinary fixture cleanup and
runner termination are distinct evidence obligations.

Extend `scripts/ci-coverage-config.test.mjs` to protect the dispatch-only
selection, disabled default, bounded timeout, step-local selector, exact test
selection and evidence retention. Run its failing case before implementation,
then the full observation contract tests after the change. Preserve all six
original acceptance criteria, the existing PostgreSQL behavioral controls,
both DB typechecks, document-index validation and exact-head integration.
The resolved claim impact still names the existing related clone tests;
the application implementation is unchanged by this runner continuation.

Both runner paths are now normally claimed after verified canonical upgrade
SUR-482991BD. Prior coverage cannot bind the changed declared scope; renew it
against this published immutable plan and the real Workroom head before
workflow implementation. No source binding may be moved backward to make a
receipt valid. The workflow is internal qualification sequencing, not a
separate deliverable or a new provider. Actual cloud execution still requires
resource admission and independent review of its final delta. A failure or
missing artifact is not a pass; report selected/copied counts, timing,
retained-heap samples, cleanup and runner termination from the actual run.
Rollback is a normal revert of the opt-in workflow and contract-test changes.


The module-size guard found that the combined PostgreSQL suite reached 940
lines. Native repair admission `IRD-4D67D344FBDC` covers a cohesive split:
`packages/db/src/sanitized-clone-scale.postgres.test.ts` owns the opt-in scale
case, isolated schema and connections; the original suite retains its 18
behavioral cases. The scale body and its assertions are unchanged. Default
discovery does not connect the scale suite even when DATABASE_URL is present.
The calibration runner must select the new scale module. Verify both modules
with DB typechecks and safe skipped discovery, and rerun the module-size guard.
The independent Windows job-drain failure remains separately unresolved; no
unchanged full-gate retry or passing integration claim follows this refactor.
