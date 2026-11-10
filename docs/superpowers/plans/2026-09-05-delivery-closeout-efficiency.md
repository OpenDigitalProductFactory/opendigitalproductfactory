---
status: draft
---

# Delivery closeout efficiency: blocked implementation handoff

**Backlog item:** `BI-154689E7`

Status: unapproved, blocked. Documentation publication only; no implementation
claim or completion evidence is implied. Design:
[delivery closeout and cost efficiency](../specs/2026-09-04-delivery-closeout-cost-efficiency-design.md).
Workroom: WC-375F098A. Direction: DI-619636A684B2.

## Backlog coverage

- Decision: decomposed
- Parent: BI-154689E7
- Receipt: blocked-by: BI-8B8731EE required terminal receipt writer recovery is not verified for this initiative; RESEARCH_REQUIRED remains missing and live plan coverage is not recorded.
- Rationale: delivery observation, host cleanup, capacity safety, release acceptance and metrics have separate owners and independently revertible changes.
- Dependencies: observations -> BI-9FF39058 (none); closeout -> BI-154689E7 (BI-9FF39058); host acknowledgement -> BI-75565393 (BI-154689E7); pause -> BI-33E1E5D7 (none); durable resume -> BI-9A353411 (BI-33E1E5D7); capacity -> BI-9BDF9539 (none); cancellation -> BI-2584792B (BI-9BDF9539); fencing -> BI-2461C0B1 (BI-9BDF9539); evidence reuse -> BI-282AE0BC (none); proportional checks -> BI-8D56F777 (BI-282AE0BC); release acceptance -> BI-E3B918C2 (BI-154689E7); metrics -> BI-69803ACC (BI-154689E7, BI-E3B918C2).

These are proposed mappings to existing backlog work from the design, not a
record_plan_backlog_coverage receipt. Reconcile their live owners and delivered
scope before each implementation claim. PR #5084 permits this named blocker for
document publication; it does not waive initiative readiness.

## Entry conditions and bounded recovery

1. Confirm BI-8B8731EE's repair is present in the canonical served release and
   identifies a supported recovery for the exact exhausted research TaskRun ending
   7E9DAA6EEFB0. Do not blind-replay or create duplicate review identities.
2. Obtain actual required receipts for the revised immutable design, retaining
   the historical baseline and review provenance. Record live deliverable coverage
   and the independent plan review, then claim implementation normally.
3. Resolve the Workroom change-impact contract for each exact edit set. Carry its
   test impact and guard obligations into that slice; unresolved impact is not an
   exemption. Recheck current source because the initial audit predates repairs.

No author task stays open to poll these conditions. Persist the handoff and let
the existing server continuation own wakeup. A repair is proven by a saved receipt
and gate advancement, not prose, an empty inbox or a successful upgrade alone.

## Ordered delivery slices

For agentic workers: implement one independently reviewable backlog item at a
time, with its own governed claim, DCO-signed branch and protected PR. Use dpf-tdd
for behavior changes. The phases below are not permission to implement now.

### 1. Squash-safe delivery observations

Extend apps/web/lib/work-capsules/liveness.ts and work-capsule-reaper.ts. Replace
URL-presence and local ancestry assumptions with authenticated provider state
bound to repository, PR and revision. Reuse inventory and Git intake observations.
Verify AC-DC-1: squash merge, later unmerged head, stale/unknown observations,
duplicate/out-of-order events and a runtime without a source checkout. Unknown
state must neither retain an imaginary open PR nor authorize abandonment.

### 2. Durable closeout and resource acknowledgement

Extend the existing Workroom/TaskRun contracts and work-capsule-reaper.ts; integrate
scripts/worktree-janitor.mjs through its existing host safety checks. Persist the
compact acceptance packet before releasing author ownership. Thread archival and
worktree cleanup each require their own acknowledgement. Retain pending acceptance
without advertising delivered work as a new implementation task.

Verify AC-DC-2 and AC-DC-3 with crashes between every transition, missing hosts,
dirty/pinned/active/unmerged source and a fresh execution reading only the handoff.
Acceptance survives all retries. No full conversation or client heartbeat is
required during the wait; no dirty source is removed.

### 3. Capacity and equivalent evidence

Extend apps/web/lib/build/git-promotion-intake.ts and the existing queue function
apps/web/lib/queue/functions/git-promotion-sandbox-verification.ts. Persist dispatch
intent and reconcile lost sends. Apply the existing cancellation and successor
fencing work rather than a second scheduler. Reuse protected evidence only when
tree, lockfile and check identity match; request only missing verification lanes.

Verify AC-DC-4 and AC-DC-5: cancellation before admission, predecessor/successor
races, duplicate dispatch, crash after persistence, changed lock/tree/check and
equivalent evidence. A waiting task holds no inference worker or shared lease.
Record unavailable infrastructure gates INCONCLUSIVE, never PASS or a diff FAIL;
use only authorized checked-in exceptions and retain protected CI.

### 4. Release-scoped acceptance and operator UI

Reuse self-upgrade/run-store.ts events and TaskRun/RuntimeVerification admission;
extend work-capsules/delivery-task-hub.ts and its existing UI consumers. Confirm
served identity before grouping checks by installation, release, contract, persona,
tenant and fixture conditions. Do not build a second release or acceptance ledger.

Verify AC-DC-6: ten obligations with three equivalent checks execute three checks
and retain ten traceable results. Test tenant isolation, rollback mid-run, duplicate
events and exactly one corrective item per failure fingerprint. A behavior failure
opens fresh corrective work, not the original author conversation.

Exercise the live Task Hub with the developer/operator persona: clear Working,
Waiting and Needs attention states; distinguish delivered from outcome verified;
show the event responsible for progress and genuine exceptions only. Use existing
theme-aware components, keyboard access and narrow-screen layouts. Verify routine
bound reviews through both external MCP and Build Studio create no redundant
approval prompt; preserve explicit human-control policies and independent review.

### 5. Cost, attention and reconciliation

Extend BI-69803ACC's existing scorecard implementation after locating its current
owner and code, rather than creating another metric store. Separate waiting time
from worker time; measure input/output/cache tokens, replay calls, queue latency,
operator prompts and merge-to-acceptance duration. Label unknown external billing
unknown. Do not infer spend from idle conversation storage.

Verify AC-DC-7 and cursor reconciliation with 10,000 obligations. Compare observed
before/after windows and report their timestamps and coverage. The design's 95%
wait-call reduction is a target, not a measured result. Publish prompt-per-review,
receipt-save failure and recovery metrics alongside delivery throughput.

## Refactoring allocation

Reserve 20% of implementation capacity for consolidating PR-state readers,
handoff/closeout transitions, authorization policy and dispatch/retry loops. Delete
obsolete prompt paths only after replacement behavior is proven. Track removed
duplicate checks and calls, not a line-count quota. BI-921B7DC2 / PR #5072 already
owns bounded review authority; BI-8B8731EE owns required-writer enforcement.

## Rollout, rollback and completion

Start with observation-only reconciliation. Enable durable handoffs for new merges,
then release acceptance and finally acknowledged cleanup. Historical closeout needs
verified provenance. Each slice gets affected tests and protected build evidence;
UI/workflow slices also need canonical live happy-path verification. Migrations,
if required after schema audit, must work against existing data.

Rollback disables the new actuator while preserving handoffs, acceptance obligations
and evidence. Never clear a queue to make it appear healthy. Document merge does
not close BI-154689E7: completion requires actual objective reconciliation and
acceptance receipts. Archive author execution after its durable handoff, not after
weeks of polling for a future production release.
