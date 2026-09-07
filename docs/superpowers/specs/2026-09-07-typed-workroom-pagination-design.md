---
status: draft
---

# Typed Workroom traversal

BI-3CE72645; WC-15C18FED. Extends CT-MCP-PAGE in
[MCP client contract consolidation](2026-09-04-mcp-client-contract-consolidation-design.md).
Delivery shape: delivery-medium@1.0.0. This is a candidate design, not an approval receipt.

## Problem and outcome

`list_workrooms` currently takes at most 100 rows ordered by mutable `updatedAt`.
Its handler applies `staleOnly` after that cut. Larger model-facing results can
be replaced by a text preview, losing both typed records and a usable next step.
An agent cannot tell whether it has enumerated the requested population.

The existing tool will return bounded typed summaries over a fixed observation.
Each page states its own count, the observed population count, and whether more
pages remain. The same snapshot yields each matching ID exactly once during a
successful traversal, even if Workrooms change while the client reads. A lost
or expired observation produces a typed restart instruction, never a silently
different population under the old cursor.

## Research & Benchmarking

- [Kubernetes consistent lists](https://kubernetes.io/docs/reference/using-api/api-concepts/)
  preserve one resource version across chunks and require a fresh listing when
  the retained version expires. Adopt fixed observation and explicit restart;
  reject adding etcd or a watch protocol merely to paginate DPF Workrooms.
- [Elasticsearch pagination](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results)
  combines point-in-time state with continuation to avoid changes between pages.
  Adopt bounded observation lifetime and deterministic ties; reject adding a
  search index or retaining backend search contexts for this relational listing.
- [MCP pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination)
  establishes opaque continuation and explicit end-of-list. It applies directly
  to protocol list methods; the custom Workroom tool needs its own domain contract.
  Cursor persistence across sessions is not a portable client guarantee.
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
  provides a consistent observation within Repeatable Read. It does not preserve
  that observation across independent HTTP requests after the transaction ends.
- `delivery-task-hub-store.ts` already has canonical JSON, HMAC, expiry checking,
  and constant-time signature comparison. Its mutable `updatedAt` keyset cannot
  supply fixed membership for status or liveness filters.
- `liveness-inventory.ts` owns liveness classification and the shared recovery
  projection. Retain these definitions. `api/pagination.ts` provides ordinary
  limit-plus-one REST slicing but does not solve snapshot membership.
- `tak/tool-result-budget.ts` owns model-facing caps. Retain bounded transport;
  remove the unsupported inference that its cap guarantees host persistence.

No new dependency, database model, service, tool name, or governance ledger is
proposed. The existing ContributorInventorySnapshot is specific to repository
assets and is not a general-purpose cache for Workroom reads.

## Options and decision status

1. Candidate: bounded, expiring in-process snapshots of compact summary rows.
   One short consistent read fixes membership and projection. Continuations are
   cheap; restart or eviction is explicit. Multiple workers may require a restart
   rather than seamless continuation; this limitation must be tested and exposed.
2. Persist snapshots as TaskArtifacts. This survives process replacement but adds
   durable writes, retention and cleanup to a read operation without an established
   artifact lifecycle for this use. Reconsider only if multi-worker routing makes
   the candidate unusable in the supported deployment.
3. Stateless keyset over current rows. Cheap and durable cursor transport, but
   mutable filters and liveness cause omissions or changed membership. Does not
   meet the agreed fixed-population acceptance and is unsuitable for this contract.

Kernel consultations DI-90923EEC9641 and DI-A26FAB3EF03E are unusable because
principle retrieval failed. The latter's favorable narrative conflicts with
`signalQuality.usable=false`; no directional approval is inferred. Retry after
the observed transport/runtime state changes. The candidate may be reviewed
without representing the degraded consultation as an approved decision.

## Contract

Keep `list_workrooms` and its legacy alias. Existing filters remain optional.
Add optional `cursor`; `limit` becomes a requested upper bound, never a promise
that all requested rows fit. Default page size and supported minimum transport
budget must be selected from serialized fixtures before implementation approval.

Preserve `capsules` and the existing summary keys where callers rely on them.
Add a versioned `page` object containing observation ID/time, expiry, page count,
population count, next cursor or null, and traversal disposition. Clearly scope
`livenessSummary` to the page; expose a separately named population summary only
when the whole observation was measured. Empty final results are complete.

Each summary retains capsuleId, bounded title, status, liveness, backlog identity,
bounded recovery state and the exact `get_workroom({capsuleId})` detail route.
Mark shortened fields explicitly. Never embed unlimited scope claims, activity,
objective text, arbitrary outcome JSON or repair payloads in every list row.
Recovery summaries consume the existing projector, not a second diagnosis.
Exact full repair fields remain available through the detail route.

The page builder measures actual serialized content, including escaping,
metadata and continuation overhead. It selects whole rows that fit. An oversized
row becomes a typed minimal ID/detail record; it cannot disappear from traversal.
The minimum supported cap must hold that record plus the continuation envelope.
A smaller cap returns a typed budget error with a supported adjustment, never a
malformed preview advertised as a successful page.

Text and structured MCP forms describe the same page and cursor. Generic native
tool execution uses the same projection under its smaller context budget. Do
not increase a global cap or claim local disk persistence to avoid this work.

## Observation and authority

Capture a single observation time and use one read-only Repeatable Read
transaction for Workrooms and the linked state used by liveness/recovery.
Apply semantic filters to the complete bounded observation before pagination.
Sort ties deterministically by unique ID. Close the transaction before responding;
never hold a transaction open while an agent thinks.

Apply finite population, retained-byte, total-cache, per-principal snapshot and
construction-time budgets. Proposed starting limits: 10,000 rows, 8 MiB per
observation, 32 MiB per process, two observations per principal, five-minute TTL,
and five-second construction deadline. Validate these against real population
and fixtures; record any change. Budget exhaustion must refuse an incomplete
snapshot with `snapshot_capacity_exceeded` and narrower-filter guidance. It
must not label a prefix as the population. Evict deterministically and bound
expired-state cleanup without a background service.

An opaque signed cursor binds version, observation ID, offset, normalized filters,
principal and applicable authority context. Reuse existing signing primitives
where their contract fits; do not reuse the hub's incompatible cursor payload.
Bound cursor input size before decoding and fail closed on malformed signatures,
offsets, versions, filter changes or authority mismatch. Do not include tokens,
raw grant material or row data in the cursor.

Normal tool grant checks run on every page. The handler must receive the trusted
principal/context; currently the pack drops them for this read handler. A cursor
cannot grant access. If authorization narrows, refuse or invalidate the whole
observation rather than returning cached rows under stale authority. Bind any
existing row-level authority epoch/fingerprint that the actual access path uses;
do not invent an independent authorization policy.

Expiry, eviction, process replacement and invalid cursor have distinct internal
diagnostics but a safe public restart contract. A retry of a valid page cursor
returns the same page; replay is read-only. Fresh detail reads may differ from
the observation and must carry their own observation time.

## Architecture and refactoring

Separate the existing inventory loader's database selection, projection, and
page-summary aggregation so both existing consumers and snapshot construction
reuse liveness/recovery rules. Keep the MCP handler thin. Centralize typed page
budgeting at the transport boundary; do not add one truncation implementation
per client. Allocate approximately one fifth of this slice to these removals of
duplicate selection/projection/serialization behavior, with affected consumers
covered by tests. Formatting does not count as refactoring evidence.

## Acceptance and verification

1. Enumerate at least 251 matching rooms with tied ordering values through pages
   below 100. Compare exact IDs with the captured observation: no gaps/duplicates.
2. Concurrent insert, status change, lease expiry and deletion do not alter an
   existing observation. A fresh observation reflects them.
3. A stale room outside the first 100 current rows is found by `staleOnly`.
   Page counts and population counts retain their distinct denominators.
4. Escaped Unicode, long strings and one oversized row retain valid typed IDs,
   detail routes and continuation under every supported transport budget.
5. Modified/expired/foreign/filter-mismatched cursors fail safely. Revoking access
   between pages prevents the next page from revealing cached data.
6. Construction/retention/population budgets fail explicitly; cache eviction and
   process replacement return finite restart guidance. Test multi-worker routing
   before calling this candidate suitable for the supported install.
7. Actual MCP text and structured consumers traverse equivalent results. Record
   client/version, negotiated revision, source SHA and tier for Codex, Claude and
   generic-client acceptance. Unavailable client verification remains incomplete.
8. Protect existing detail, legacy alias, liveness, recovery and native-agent
   consumer behavior with relevant integration tests; do not rely only on mocks
   of the final handler or serialize a fabricated success packet as acceptance.

Delivery requires immutable design review, plan coverage, protected checks,
canonical image publication, normal upgrade and actual served acceptance.
No acceptance is satisfied by this document alone.
