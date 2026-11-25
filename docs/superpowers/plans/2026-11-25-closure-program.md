---
status: active
---

# Closure program: platform work finishes what it starts

**Epic:** EP-C00F61F4. **First item:** BI-97C56E20 (closure scorecard). **Workroom:** WC-C43DBBC5.
**Decision:** WWMD DI-5732973AE51E scored closure-first 11.87, keep the T3 slice order 7.89, freeze all new capability 5.84. The verdict was withheld because principle retrieval was lexical-only. The owner then directed the work on 2026-11-25.

## Why

On 2026-11-25 the owner asked what had become of the work to make every run more efficient, and why so little happens on its own. Live, read-only SQL that day:

| Stream | Measured |
|---|---|
| Improvement signals | 456 open, none ever closed |
| Improvement proposals | 1,386, 1 verified |
| Build Studio | 534 builds, 1 `complete`; about 5 Build-Studio-authored PRs merged since 2026-09-01 |
| Work Anchor triage queue | depth 1,443, throughput 0 |
| Awaiting acceptance | 394, of which 348 are copies owned by the paired install |
| Held owner escalations | 78, oldest 2026-10-07 |

Detection, filing, sweeps and gates all exist. What is missing is closure: the step that carries a finished item back to every record pointing at it, and a measure that shows whether anything closes.

## Root causes found (2026-11-25)

1. **Nothing measures closure.** Each stall stays invisible until someone reconstructs it by hand.
2. **A finished backlog item closes nothing downstream.** `bridgeBacklogItemToWorkItem` (`apps/web/lib/queue/bridges/backlog-bridge.ts`) runs only from two MCP paths, not from `completeBacklogItemTransition`. The acceptance sweep, the REST route and the portal actions therefore never close the item's WorkItem. 630 anchor WorkItems are `queued` although their backlog item is done. No code writes `ImprovementSignal.status` (95 should be closed). Proposals move only on the skills path (61 should be closed). This extends BI-F4A9BBF4.
3. **Build Studio children wait on siblings that never complete.**
   - The dependency gate accepts only a `complete` sibling (`apps/web/lib/build/feature-build-dependencies.ts`), and the platform has one such build.
   - `reconcileBuildCompletion` runs only from the ship phase, so a review build whose PR merged stays in review.
   - Epic children are exempt from age-out.
   - Together these hold 42 of the 62 plan-phase builds. This extends BI-8129F585, BI-EFA17EC3 and BI-3B580F8F.
4. **A branch behind main is read as a gauntlet crash.** `guard-gauntlet.ts` turns the pregate-preflight "behind main" remedy into `gauntlet-not-run`. That re-runs every 30 minutes: 2,392 events in 30 days and no `ready` finalize this week.
5. **Acceptance closes only on the item's home install.** 348 awaiting items are federated copies; 296 of them are already merged here. Nothing sends delivery evidence back to the home install. This extends BI-BBBE8CB1.
6. **Actuators ship as observe-only and stay that way.** For example the work-capsule reaper reports 498 candidates and reaps none. See BI-D5830561 and BI-BD13E7BA.
7. **WWMD sometimes withholds decisions.** The embedding provider is intermittently unavailable, so principle retrieval falls back to lexical. It happened 42 times in 6 hours, and 120 of 1,438 decisions in the week had no recommendation.

## Slices, in order

| # | Slice | Item | Shape |
|---|---|---|---|
| 1 | Closure scorecard: a daily deterministic measure, trailing week vs the week before | BI-97C56E20 | medium |
| 2 | A terminal backlog transition closes its WorkItems, signals and proposals, plus a one-time reconcile | BI-F4A9BBF4 (extended) | medium |
| 3 | A merged PR completes its build, and a dead sibling releases its dependents | BI-8129F585 / BI-EFA17EC3 | medium |
| 4 | "Behind main" is its own finalize result and triggers a branch refresh | new | small |
| 5 | Delivery evidence goes to the home install so it can close peer-owned acceptance | BI-BBBE8CB1 | medium |
| 6 | Turn on the observe-only actuators whose evidence is in, one at a time | BI-D5830561, BI-BD13E7BA | small each |
| 7 | WWMD principle retrieval stops degrading (embedding provider routing) | new | small |
| 8 | S9 find → file → build → land → learn loop on the current runtime, judged by the scorecard | BI-204C9EE6 | large |

Each slice is judged by the scorecard line it should move:

- Slice 2 moves `signals.closed`, `proposals.closed` and the anchor queue.
- Slices 3 and 4 move `builds.completed` and `builds.stranded`.
- Slice 5 moves `acceptance.peerOwned`.
- Slice 7 moves `decisions.recommendedShare`.

## Boundary with DPF2 and the T3 absorption

T3 absorption S4–S8 (launch contract, workroom-bound toolset, execution-host routing, device cutover) and the DPF2 OS-layer cutover stay in the DPF2 coordination lane. This program does not touch them.

The meeting point is S9. Its measure (AC-5) is delivered early by slice 1, and its loop by slice 8 on today's dispatch. When S6 lands, only the dispatch step changes route.

## Slice 1 design (BI-97C56E20)

- **Typed task.** A deterministic scheduled task kind `closure-scorecard` (`apps/web/lib/operate/scheduled-jobs/agent-task-kind.ts`), dispatched by `runDeterministicScheduledTaskKind`, seeded daily at 06:29 UTC by `packages/db/src/seed-closure-scorecard.ts`.
- **One read.** `load-closure-counts.ts` runs a fixed set of COUNT aggregates.
  - Flows are counted in the trailing 7 days. Stocks are read as they stand.
  - Peer-owned acceptance is split out by the federated-origin body marker, because only the home install may close those items.
- **Pure measures.** `measures.ts` computes stream state (closing / accumulating / idle) and per-line direction against the run recorded 7 days earlier, with a 5% flat band.
- **One record per day.** One proactive TaskRun per UTC day, the result an artifact of kind `closure-scorecard`. This is the harness-evolution-loop pattern; there is no new table.
- **Verified so far.**
  - Unit tests cover the measures, idempotence and the baseline read-back.
  - The loader's SQL was executed read-only against production on 2026-11-25, giving: builds 20 in / 7 out; signals 34 / 0; proposals 9 / 0; backlog 209 / 60; self-filed 147 / 12; owner asks 52 routed to an agent and 6 reaching the owner; 78 held.

## Review changes to slice 1 (PR #7229, 2026-11-25)

The independent review returned REQUEST_CHANGES. Each finding and its fix:

| Finding | Fix |
|---|---|
| Unbounded scans | Every read now uses an indexed column. State counts use the existing `status` / `phase` indexes. Window events use new indexes: `DecisionInteraction(createdAt)`, `PlatformIssueReport(createdAt)` and `PlatformIssueReport(status, createdAt)`. Self-filed counts use a new `BacklogItem(source, status)` index. |
| `updatedAt` re-counting | Flows are snapshot differences, not `updatedAt` filters. Rejected proposals are counted apart from implemented ones. |
| Partial writes | The run id is a unique day key, `TR-CSC-<yyyymmdd>`. Run and artifact are written in one transaction, and a retry repairs a missing artifact. |
| Double-counted asks | Each owner-attention ask is classified once, keyed by `dedupeKey` (falling back to the report id). The line says "classified for the owner", not "reached the owner". |
| `LIKE` wildcard | The peer-ownership check uses `position()` instead of `LIKE`, so `_` is not a wildcard. |

## Backlog coverage

Each deliverable, its backlog item, its contract and how it is verified:

| Key | Deliverable | Item | Contract | Verification |
|---|---|---|---|---|
| S1-closure-scorecard | Closure scorecard | BI-97C56E20 | `apps/web/lib/operate/scheduled-jobs/agent-task-kind.ts` | `apps/web/lib/continual-improvement/closure-scorecard/measures.test.ts` |
| S2-terminal-downstream | Finished item closes downstream records | BI-F4A9BBF4 | `apps/web/lib/queue/bridges/backlog-bridge.ts` | `apps/web/lib/queue/bridges/terminal-backlog-downstream.test.ts` |
| S3-merged-build-completes | Merged PR completes its build | BI-8129F585 | `apps/web/lib/build/feature-build-dependencies.ts` | closure-scorecard:builds.completed |
| S4-behind-main | Behind-main refresh | BI-9E32CC27 | `apps/web/lib/build/guard-gauntlet.ts` | closure-scorecard:builds.stranded |
| S5-peer-delivery-evidence | Peer delivery evidence | BI-BBBE8CB1 | `apps/web/lib/federation` | closure-scorecard:acceptance.peerOwned |
| S6-actuators | Observe-only actuators enabled | BI-D5830561 | `apps/web/lib/operate/taskrun-watchdog.ts` | closure-scorecard:builds.stranded |
| S7-wwmd-retrieval | WWMD retrieval | BI-DCFF13C7 | `apps/web/lib/wiki/embeddings.ts` | closure-scorecard:decisions.recommendedShare |
| S8-rung0-loop | Rung-0 loop | BI-204C9EE6 | `docs/superpowers/specs/2026-11-13-t3-code-absorption-design.md` | closure-scorecard:selfFiled.done |

Flows: scheduled-agent-task:closure-scorecard · cron:ops/terminal-backlog-downstream-reconcile · build-pr-delivery-reconcile · build-studio:finalize · work-sync · work-capsule-reaper · principle_decide · rung-0. S8-rung0-loop depends on S1-closure-scorecard and S2-terminal-downstream.

### BI-97C56E20 acceptance (quoted)

- AC-1: A scheduled task kind `closure-scorecard` exists in SCHEDULED_AGENT_TASK_KINDS and is dispatched by runDeterministicScheduledTaskKind off the LLM path.
- AC-2: Each run snapshots state counts from indexed status or phase columns:
  - builds;
  - improvement signals;
  - improvement proposals, with implemented and rejected counted apart;
  - backlog items;
  - self-filed items;
  - awaiting acceptance, split into locally owned and peer-owned;
  - held owner-attention reports.

  It also counts two kinds of window events by an indexed createdAt: owner-attention asks, each classified once, and decisions with a recommendation.
- AC-3: Weekly flows are the difference between this snapshot and the one recorded seven days earlier; no flow is counted by updatedAt. Each line carries the prior value and a direction.
- AC-4: A run is idempotent per UTC day under a unique day key, and a retry after a partial write repairs the missing artifact.
- AC-5: Tests cover the SQL classifications, the flow derivation and the partial-write retry. The loader is exercised against Postgres, and the first artifact is produced on the live install.
- AC-6: The task is seeded daily through the existing scheduled-task seed path, not by hand.

### BI-F4A9BBF4 acceptance (quoted)

- AC-1: For a WorkItem live in any queue whose backlog item (matched by itemId or row id) is done or retired, one reconcile pass sets status completed or cancelled and sets completedAt.
- AC-2: Each WorkItem closed by the reconcile records exactly one finished or cancelled queue transition under `cwq:<its queueId>`, so queue throughput reflects closures.
- AC-3: Open ImprovementSignals linked to a done or retired item become resolved or dismissed. Open-lifecycle ImprovementProposals linked to one become implemented or rejected (with reason).
- AC-4: The reconcile is idempotent and bounded per pass. A second pass over the same state changes nothing and records no telemetry.
- AC-5: It runs on a cron through the existing jobs registry, and its first production pass closes the backlog measured above. The closure scorecard (BI-97C56E20) shows signals.closed and proposals.closed move off zero.
