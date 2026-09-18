---
status: draft
---

# Enumerating Workrooms through MCP

`list_workrooms` returns a fixed observation in bounded pages. The legacy
`list_work_capsules` alias follows the same contract. This contract applies after
the typed pagination change is installed; an older response without `page` does
not prove that a complete population was enumerated.

Legacy names resolve to their canonical Workroom name before token scope,
quiescence, governance and dispatch checks. `load_tools` accepts a legacy name
and returns its authorized canonical definition. Listings and execution audit
names remain canonical; aliases do not add grants or extra advertised tools.

Start with your filters and an optional `limit`. The default is five rows and the
maximum request is 100. The actual page may contain fewer rows because the full
serialized result must fit 4,000 UTF-16 units and 4,000 UTF-8 bytes. Long summaries
identify shortened fields; `get_workroom` supplies their current details.

Read `page.nextCursor` and repeat the request with that cursor and the same
filters. Continue until it is null. `page.populationCount` describes the matching
observation, while `page.pageCount` and liveness row counts describe this page.
The `heavyLane` and `progressSlo` fields retain installation-wide measurements at
the observation time; `environmentSummaryScope` makes that denominator explicit.

Membership, ordering and projected state are fixed for the traversal. A newer
detail read may differ. Replaying a valid cursor returns the same page. Changing
`limit` during continuation does not resize an existing observation.

An observation expires after five minutes. Expiry, eviction, process replacement
or a request reaching a different worker returns a typed restart error. Start a
new traversal without a cursor and discard the incomplete old traversal; do not
concatenate two observations. The supported single-portal process can retain
observations locally. Multi-worker deployments need request affinity for seamless
continuation; this implementation does not promise distributed snapshot storage.

The process retains at most two observations per principal, 256 overall, 8 MiB
per observation and 32 MiB overall. At most two captures run concurrently. A
read-only Repeatable Read transaction has a five-second timeout and a one-second
admission wait. Populations above 10,000 rows or exhausted construction capacity
fail explicitly; use narrower filters. A capacity failure never advertises a
partial population as complete.

Every request passes the existing tool authorization checks. Continuation binds
the principal, effective caller context and filters; a cursor grants no access.
Cursor signing shares the existing delivery-hub primitive, while each domain
keeps its own payload and key policy. Recovery and liveness projection remain
owned by their existing shared modules.
