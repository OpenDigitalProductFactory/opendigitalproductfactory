---
status: active
---

# Closure program: platform work finishes what it starts

**Epic:** EP-C00F61F4. **First item:** BI-97C56E20 (closure scorecard). **Workrooms:** WC-C43DBBC5 (slice 1 code, PR #7229), WC-93241455 (this plan, PR #7230).
**Decision:** WWMD DI-5732973AE51E (recorded in the DecisionInteraction ledger). It scored closure-first 11.87, keep the T3 slice order 7.89 and freeze all new capability 5.84, but withheld a verdict because principle retrieval was lexical-only. The owner directed the work on 2026-11-25.

This plan orders work; it does not execute any of it. Each slice ships through its own PR with its own gate, review and failure analysis. The sections below state what each slice must carry to be safe, so those PRs are reviewed against it.

## Why

On 2026-11-25 the owner asked what had become of the work to make every run more efficient, and why so little happens on its own.

**Evidence status of these numbers.** They are point-in-time observations from read-only SQL run by the planning session on 2026-11-25. They were not captured as a recorded query artifact, and they are not acceptance evidence. The DPF convergence coordinator has since ruled that this program does not query the live install database at all. Live state is read only through governed MCP tools, and verification uses the isolated dev database or throwaway containers. The closure scorecard (slice 1) exists to replace hand-run counts like these with a recorded daily artifact.

| Stream | Observed |
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
2. **A finished backlog item closes nothing downstream.** `bridgeBacklogItemToWorkItem` (`apps/web/lib/queue/bridges/backlog-bridge.ts`) runs only from two MCP paths, not from `completeBacklogItemTransition`. The acceptance sweep, the REST route and the portal actions therefore never close the item's WorkItem. No code writes `ImprovementSignal.status`, and proposals move only on the skills path.
3. **Build Studio children wait on siblings that never complete.** The dependency gate accepts only a `complete` sibling (`apps/web/lib/build/feature-build-dependencies.ts`). `reconcileBuildCompletion` runs only from the ship phase, so a review build whose PR merged stays in review. Epic children are exempt from age-out.
4. **A branch behind main is read as a gauntlet crash.** `guard-gauntlet.ts` turns the pregate-preflight "behind main" remedy into `gauntlet-not-run`, which re-runs every 30 minutes.
5. **Acceptance closes only on the item's home install.** Most awaiting items are federated copies. Nothing sends delivery evidence back to the home install.
6. **Actuators ship as observe-only and stay that way.** For example, the work-capsule reaper reports candidates and reaps none.
7. **WWMD sometimes withholds decisions.** The embedding provider is intermittently unavailable, so principle retrieval falls back to lexical.

## Slices, in order

Every item below already exists in the live backlog. "Filed" items were created on 2026-11-25 for this program; "extended" items existed before and had their scope widened.

| # | Slice | Item | Status | Shape |
|---|---|---|---|---|
| 1 | Closure scorecard: a daily deterministic measure, net change in stock against the run seven days earlier | BI-97C56E20 | filed 2026-11-25; PR #7229 | medium |
| 2 | A finished backlog item closes its WorkItems, signals and proposals | BI-F4A9BBF4 | extended 2026-11-25 | medium |
| 3 | A merged PR completes its build, and a dead sibling releases its dependents | BI-8129F585 / BI-EFA17EC3 | existing | medium |
| 4 | "Behind main" is its own finalize result and triggers a branch refresh | BI-9E32CC27 | filed 2026-11-25 | small |
| 5 | Delivery evidence goes to the home install so it can close peer-owned acceptance | BI-BBBE8CB1 | existing | medium |
| 6 | Turn on the observe-only actuators whose evidence is in, one at a time | BI-D5830561, BI-BD13E7BA | existing | small each |
| 7 | WWMD principle retrieval stops degrading (embedding provider routing) | BI-DCFF13C7 | filed 2026-11-25 | small |
| 8 | S9 find → file → build → land → learn loop on the current runtime, judged by the scorecard | BI-204C9EE6 | existing, resequenced | large |

## What counts as closure

A scorecard line may only be moved by a real change of state. Real changes are:

- an item reaching `done` or `retired` through a governed transition;
- a WorkItem, signal or proposal following its item's terminal state (slice 2);
- a build reaching `complete` through provider-confirmed merge evidence (slice 3).

Rows deleted from a table, and bulk status edits outside these paths, are not closure. The scorecard enforces this two ways:

- It reports **net change in stock** between daily snapshots, never event counts.
- It marks a stream `indeterminate` in any week its total stock fell, so deletion can never read as closure.

Slice 2's one-time catch-up is a real change of state, because each row follows its own item's recorded terminal state. Its effect will show as one large step in the week it ships, and that step is attributed to the catch-up in the run summary.

## Rollout, rollback and failure modes per slice

Each slice's PR must carry the following, and its failure analysis must cover these scenarios.

**Slice 1 — scorecard (read-only measurement).**
- **Writes:** only its own TaskRun and artifact.
- **Failure modes:**
  - a misleading count, contained by raw counts kept in the artifact;
  - database load, contained by indexed reads, one run a day and a 15-second statement timeout;
  - a partial write, contained by the unique day key and a locked repair.
- **Rollback:** pause the task from the scheduled-jobs surface. The index migration is additive and can stay.

**Slice 2 — downstream closure, including the one-time catch-up of rows that piled up.** This is the riskiest slice: a bulk status change in production.
- **Only through the governed actuator.** The catch-up runs only as the flagged, catalogued reconcile job, shipped in a reviewed PR and run by the canonical runtime. No one ever runs it, or any part of it, as direct SQL against the live install's database.
- **Dry run first.** The exact statements run on the isolated dev database inside BEGIN … ROLLBACK, with row counts recorded, before merge.
- **Bounded.** At most 500 rows per record type per pass, so the catch-up spreads over several passes.
- **Idempotent.** Each statement re-checks the live/open status in its WHERE, so a second pass changes nothing.
- **Scoped.** Only rows whose own backlog item is `done` or `retired` are touched, and each takes the documented terminal status for that state.
- **Kill switch.** The cron is catalogued `honorsEnabledGate: true`, so disabling `terminal-backlog-downstream-reconcile` on the scheduled-jobs surface stops it.
- **Auditable and reversible.** Each pass logs its counts. Each closed WorkItem records a `finished` or `cancelled` queue transition, giving the exact set of changed rows. Because the change follows each row's own item, a wrongly closed row can be reopened by reopening the item.
- **Failure scenarios to analyse:** a WorkItem whose `sourceId` matches the wrong item; a retired item whose signals should stay open; a concurrent writer racing the reconcile.

**Slice 3 — merged PR completes its build.**
- Completion only on provider-confirmed merge evidence, through the existing terminal transition.
- **Failure scenario:** completing a build whose PR merged a different head. Prevent it with an exact-head check.
- **Rollback:** the existing reopen path.

**Slice 4 — behind-main refresh.**
- One refresh per head. A failed refresh falls back to today's behaviour, so it is no worse than now.
- **Failure scenario:** a refresh that silently drops build work. Prevent it with the existing refresh-keeps-snapshot path.

**Slice 5 — cross-install delivery evidence.** It sends a claim, never a close: the home install's own sweep and close gate decide.
- **Failure scenarios:** misclassifying peer ownership, which the existing federated-origin marker and `BI-C5794F1D` ownership rule prevent; an unreachable peer, where the claim is retried and nothing closes.
- **Rollback:** stop sending; no local state changes.

**Slice 6 — enabling observe-only actuators.** This one can destroy live work if wrong.
- One actuator per PR.
- Each actuator first runs observe-only with its candidate list reviewed, then is enabled behind its existing environment flag (for example `DPF_WORKCAPSULE_REAPER_AUTO_REAP`). Unsetting the flag is the kill switch.
- Start with the narrowest candidate class. For the reaper, that is merged-and-clean rooms only.
- Each PR's failure analysis must cover reaping live or unmerged work.

**Slice 7 — WWMD retrieval.** Configuration and routing only; decisions already withhold on degraded evidence, so failure is no worse than today.

**Slice 8 — rung-0 loop.** It inherits the absorption design's rails: it cannot widen its own authority, works within budgets and WIP limits, and has a kill switch (BI-204C9EE6 AC-3/AC-4).

## Boundary with DPF2 and the T3 absorption

T3 absorption S4–S8 (launch contract, workroom-bound toolset, execution-host routing, device cutover) and the DPF2 OS-layer cutover stay in the DPF2 coordination lane. The DPF2 coordinator confirmed on 2026-11-25 that DPF2 holds neither S9 nor any rung-0 measure.

The meeting point is S9. Slice 1 delivers its measure early, and slice 8 its loop, on today's dispatch. When S6 lands, only the dispatch step changes route: it goes through FB-2c's receiving-seam launch contract.

## Slice 1 design (BI-97C56E20, PR #7229)

- **Typed task.** A deterministic scheduled task kind `closure-scorecard` (`apps/web/lib/operate/scheduled-jobs/agent-task-kind.ts`), dispatched by `runDeterministicScheduledTaskKind`, seeded daily at 06:29 UTC by `packages/db/src/seed-closure-scorecard.ts`.
- **Indexed reads.** `load-closure-counts.ts` snapshots counts by state through the status/phase indexes, and counts window events (owner-attention asks, decisions) through indexed `createdAt`. A migration adds the four missing indexes. All reads share one transaction with a 15-second statement timeout.
- **Net change, not events.** `measures.ts` reports net change in stock against the run recorded seven days earlier. A stream reads accumulating, reducing or steady from its open stock, and `indeterminate` when its total fell.
- **One ask identity.** Owner-attention asks are merged through `askIdentityFromDedupeKey`, exported beside the producer that files `K` / `K:routed`.
- **One record per day.** One proactive TaskRun per UTC day, keyed `TR-CSC-<yyyymmdd>`. The run and its artifact are written in one transaction, and a missing artifact is repaired under a run-row lock.
- **Recorded evidence:**
  - local-CI evidence `cmwwmwuz10s6d0eo247ddw0cv` for the first head, `93da998d`;
  - two independent reviews, whose findings shaped the current design;
  - the final head's gate and review are recorded on WC-C43DBBC5 when they run.
- **Pending:** AC-5's first artifact on the live install, after deploy.

## Backlog coverage

| Key | Deliverable | Item | Contract | Verification |
|---|---|---|---|---|
| S1-closure-scorecard | Closure scorecard | BI-97C56E20 | `apps/web/lib/operate/scheduled-jobs/agent-task-kind.ts` | `apps/web/lib/continual-improvement/closure-scorecard/measures.test.ts` |
| S2-terminal-downstream | Finished item closes downstream records | BI-F4A9BBF4 | `apps/web/lib/queue/bridges/backlog-bridge.ts` | `apps/web/lib/queue/bridges/terminal-backlog-downstream.test.ts` (on branch `fix/terminal-backlog-downstream`) |
| S3-merged-build-completes | Merged PR completes its build | BI-8129F585 | `apps/web/lib/build/feature-build-dependencies.ts` | test named in the slice's PR; outcome line `builds.completeNetChange` |
| S4-behind-main | Behind-main refresh | BI-9E32CC27 | `apps/web/lib/build/sandbox/guard-gauntlet.ts` | reproduction test per BI-9E32CC27 AC-3; outcome line `builds.stranded` |
| S5-peer-delivery-evidence | Peer delivery evidence | BI-BBBE8CB1 | `apps/web/lib/federation/work-sync.ts` | test named in the slice's PR; outcome line `acceptance.peerOwned` |
| S6-actuators | Observe-only actuators enabled | BI-D5830561 | `apps/web/lib/work-capsules/work-capsule-reaper.ts` | candidate review per actuator; outcome line `builds.stranded` |
| S7-wwmd-retrieval | WWMD retrieval | BI-DCFF13C7 | `apps/web/lib/wiki/embeddings.ts` | 24-hour log check per BI-DCFF13C7 AC-2; outcome line `decisions.recommendedShare` |
| S8-rung0-loop | Rung-0 loop | BI-204C9EE6 | `docs/superpowers/specs/2026-11-13-t3-code-absorption-design.md` | outcome line `selfFiled.doneNetChange` |

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
- AC-3: Weekly figures are the net change in stock between this snapshot and the one recorded seven days earlier, labelled as net change and never as started/ended counts; no figure is counted by updatedAt, and a stream whose total stock fell is indeterminate. Each line carries the prior value and a direction.
- AC-4: A run is idempotent per UTC day under a unique day key, and a retry after a partial write repairs the missing artifact.
- AC-5: Tests cover the SQL classifications, the flow derivation and the partial-write retry. The loader is exercised against Postgres, and the first artifact is produced on the live install.
- AC-6: The task is seeded daily through the existing scheduled-task seed path, not by hand.

### BI-F4A9BBF4 acceptance (quoted)

- AC-1: For a WorkItem live in any queue whose backlog item (matched by itemId or row id) is done or retired, one reconcile pass sets status completed or cancelled and sets completedAt.
- AC-2: Each WorkItem closed by the reconcile records exactly one finished or cancelled queue transition under `cwq:<its queueId>`, so queue throughput reflects closures.
- AC-3: Open ImprovementSignals linked to a done or retired item become resolved or dismissed. Open-lifecycle ImprovementProposals linked to one become implemented or rejected (with reason).
- AC-4: The reconcile is idempotent and bounded per pass. A second pass over the same state changes nothing and records no telemetry.
- AC-5: It runs on a cron through the existing jobs registry, and its first production pass closes the backlog measured above. The closure scorecard (BI-97C56E20) shows signals.closed and proposals.closed move off zero.
