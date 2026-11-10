---
status: draft
---

# Squash-safe delivery observation

**Backlog item:** `BI-9FF39058`  
**Workroom:** `WC-162C6AAD`  
**Readiness profile:** `feature`  
**Parent design:** [Delivery closeout and cost efficiency](2026-09-04-delivery-closeout-cost-efficiency-design.md)

## Problem and evidence

The Workroom liveness projector currently treats a stored pull-request URL or
number as proof that the PR is open. The reaper separately asks a local Git
checkout whether the authored head is reachable from the trunk. Neither fact is
portable: an installed runtime has no source checkout, a stored PR identity says
nothing about its current state, and a squash merge deliberately does not make the
authored head an ancestor of the merge commit.

The existing contributor-inventory job already performs authenticated GitHub
reads and keeps the latest successful snapshot through provider outages. It is
the right observation source; adding another provider client or persistence model
would duplicate authority.

## Decision

Extend the existing GitHub PR snapshot with repository, authored head, merge
commit, provider timestamps, API version, and a deterministic observation
fingerprint. The inventory reader requests open and terminal PRs. The Workroom
reaper reads the latest successful provider snapshot and accepts it only when
repository, PR number, and authored head all match the Workroom.

A matching `merged` observation is monotonic delivery evidence and remains valid
when the latest sync later fails. A matching `open` observation is liveness only
while the successful sync is fresh. `closed`, stale-open, malformed, mismatched,
and unavailable observations are explicit unknowns for liveness: they neither
keep a room alive nor authorize abandonment by themselves. Local Git ancestry
remains a positive fallback for non-squash delivery when available; it is not the
portable source of PR state.

No schema migration is required. Contributor inventory payloads are JSON and new
fields are additive; old snapshots remain readable but cannot prove provider
state because they lack the immutable head binding.

## Objectives

- **OBJ-9FF-1:** A provider observation identifies repository, PR, authored head,
  state, merge commit, provider timestamps/version, and a deterministic
  fingerprint.
- **OBJ-9FF-2:** A squash-merged PR closes only the Workroom whose immutable head
  it observed; a later unmerged head cannot inherit delivery.
- **OBJ-9FF-3:** Provider outage, stale open state, malformed legacy payloads, and
  a source-free install remain honest unknowns rather than imaginary open or
  abandoned states.
- **OBJ-9FF-4:** Provider and local-git observations share the existing liveness
  classifier and reaper, without a second closeout controller.

## Acceptance criteria

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-9FF-1 | OBJ-9FF-1 | Authenticated inventory stores `state=all` observations with the exact repository, head SHA, merge SHA/time, provider update time/API version, and a stable fingerprint. |
| AC-9FF-2 | OBJ-9FF-2 | A merged provider observation whose repository, PR number, and head all match produces `delivered`, including on a runtime without Git. |
| AC-9FF-3 | OBJ-9FF-2, OBJ-9FF-3 | A newer Workroom head, mismatched repository/PR, closed PR, stale open PR, malformed legacy payload, or missing provider snapshot does not produce delivered or open-PR liveness. |
| AC-9FF-4 | OBJ-9FF-3 | A prior matching merge remains usable from the latest successful snapshot when a later provider sync fails; an authenticated not-modified response renews the prior open observation, and an unconfirmed open observation expires after the freshness window. |
| AC-9FF-5 | OBJ-9FF-4 | Existing local positive ancestry remains a fallback, dry-run remains the default, and no filesystem mutation is added to the reaper. |

## Failure and compatibility behavior

Parsing is fail closed. Missing or non-string repository/head fields, invalid PR
numbers/states, or invalid timestamps do not become observations. Duplicate rows
for one PR resolve deterministically by provider update time and then fingerprint;
an older/out-of-order row cannot replace a newer fact. Existing payloads lacking
the new fields continue to drive the contributor UI but cannot drive closeout.

The reaper still needs its existing independent stale/dead signal before acting.
Provider `closed` is not abandonment authority. Rollback removes provider
annotation and returns to local positive ancestry; all inventory data remains
readable.

## Research and alternatives

- GitHub's pull-request API exposes authored head, state, merge commit and
  provider timestamps. DPF adopts those authenticated facts and rejects URL
  presence as state.
- Kubernetes controllers distinguish observed state from desired state and keep
  last-known durable facts across transient read failures. DPF adopts that
  reconciliation shape rather than making provider availability a correctness
  dependency.
- Event-sourced consumers reject stale/out-of-order observations by version or
  timestamp. DPF applies the same monotonic selection locally and rejects a new
  event bus because contributor inventory already owns polling and persistence.

## Ordered implementation sequence

1. Extend and test the GitHub inventory payload and `state=all` read.
2. Add exact-bound, monotonic provider-observation selection to Workroom
   reconciliation.
3. Make explicit fresh-open state the only PR liveness signal and preserve local
   positive ancestry fallback.
4. Run affected tests, typecheck, policy guards, DCO, and protected PR checks;
   record unavailable local capacity as inconclusive rather than a product PASS.
