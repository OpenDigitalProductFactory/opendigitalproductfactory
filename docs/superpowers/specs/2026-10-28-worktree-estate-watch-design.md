---
status: draft
backlog: BI-328AE7BE
---

# Delivery substrate watches, starting with the worktree estate

Workroom: WC-5656DB2E. Architecture decision: [DI-43391D1FA61B](https://localhost/coworker-decisions/decisions/DI-43391D1FA61B). Source inspection: `46f8a5ca9cb75aa871a223b70acc6dcc65d15a67`.

## Scope and measured problem

The current owner request is a standing `worktree-estate-watch@1.0.0` that runs the janitor, branch reaper, fetch/prune and stash census on a cadence and records outcomes. BI-328AE7BE also names substrate, local-CI and merge-flow watches and a 14-day detection comparison. This design retains all four watches and the comparison, with the estate delivery first. None is claimed as delivered. Plan coverage must preserve the remaining obligations rather than close the umbrella on an estate-only receipt.

Live DEV mount inspection on October 28 shows `/host-dpf` maps to the installed `D:/DPF`, and `/host-worktrees` to `D:/DPF-worktrees`. The owning source clone is `D:/DPF-source-root`; its canonical worktree base is `D:/DPF-source-root-worktrees`. The existing portal janitor's fallback root therefore cannot establish ownership of this estate. A declared shape alone cannot repair this.

The owner supplied the closeout baseline: 1,851 local branches, 501 reapable, 1,178 remote refs with 979 prunable, and 32 stashes. A later read observed 1,863 branches, 1,186 remote refs and 32 stashes; concurrent growth is not a cleanup result. The reaper still exists only on `fix/thread-gaps-closeout`; its containing protected delivery is a prerequisite.

## Existing substrate and decision

Reuse the shape documents/compiler, standing registry, Workroom drive and evidence writer. Reuse `scripts/lib/worktree-base.mjs`, `scripts/worktree-janitor.mjs`, and the closeout's branch reaper, including their complete-ownership, current-PR, clean/merged, pin, live-session and compare-and-delete checks. Never reproduce their cleanup policy in a second implementation.

The native Edge implementation in `services/edge-node-go/internal/action/` already owns signed machine-bound actions, fixed handlers and durable nonce consumption. `packages/db/src/remote-action-dispatch.ts` owns current scope, node trust and allowed action types. Extend that channel with an exact estate procedure. Do not add a general command tool, a scheduler, a table or a writable portal mount for host Git.

For estate host execution, WWMD selected this option with high confidence and autonomy eligibility: estimated composite 13.144 versus 9.719 for portal-mounted source, margin 3.425. Relevant contributions included Architecture Over Shortcuts, Ground New Work In Existing Platform, Single Source of Truth and platform independence. These are design estimates, not performance measurements or a grant. Research receipt: `initiative-0fc25733-18d3-44f8-b479-54ca6643db67`.

## Objectives

**OBJ-ESTATE-1:** Address the actual registered source estate through current machine, repository, stage and authority bindings.

**OBJ-ESTATE-2:** Execute bounded deterministic upkeep on cadence without reaping active or unpublished work or deleting stashes.

**OBJ-ESTATE-3:** Retain observable, idempotent cycle outcomes and explicit unavailable, failed and uncertain states.

## Enforcement contracts

**CT-ESTATE-1 — host binding.** A native installed host configuration registers the owning clone and repository identity. Resolve the canonical base through the existing owning-clone resolver. The action references that binding, not a caller-supplied executable, command, path, environment, Git remote or script body. At execution, revalidate the real clone/common directory, repository, host identity and published procedure version. Reject a changed binding, symlink escape or installed directory with no Git ownership. A source checkout and a runtime install remain different resources.

**CT-ESTATE-2 — shape and cadence.** The compiled standing shape declares observe, repair and report stages, its bounded cadence, measures and failure exits. The existing drive owns each cycle and its stage state. A stage-bound platform adapter enqueues the fixed native action through the normal governed boundary; merely naming tools or adding binding metadata does not activate it. Dispatch, claim and effects retain current user/agent grants, tenant, node allowlist, GPP stage authority and budget checks. Expired, revoked, unrelated or unavailable authority starts no repair. An unknown binding creates a coverage finding rather than a fabricated permit or a generic approval card.

**CT-ESTATE-3 — deterministic procedure.** Observe the complete Workroom/PR ownership and current estate first. An unavailable or incomplete observation stops cleanup as inconclusive. Repair invokes the existing janitor in its permitted Tier-A-only mode and the published branch reaper against the bound root. Fetch/prune runs once through the existing reaper; its result is distinct from branch deletion. The stash census runs before and after and reports entries and age; there is no drop, clear, pop or stash command in the procedure. No Tier B, forced dirty-tree removal, unpublished branch deletion, hook disabling or credential substitution is admitted.

**CT-ESTATE-4 — repeat and uncertainty.** One current cycle/action identity is retained on the existing Workroom/RemoteAction records before dispatch. Concurrent ticks join it. Native nonce consumption occurs before host effects; a lost response does not authorize a new nonce or duplicate repair. Preserve the original action's failed or uncertain result and reconcile it through its existing channel. Revalidate authority at claim and before launching repair. Use the existing compare-and-delete checks for moved refs. A partial host operation records each completed step; do not claim a transaction across Git, files and the database.

**CT-ESTATE-5 — credentials and binaries.** The host action uses its own explicitly authorized installation-wide ownership reader; an OAuth client-scoped view cannot masquerade as a complete estate census. Reuse the established credential resolver, endpoint validation and installed CA trust. No secret appears in a signed action, report or tracked file. Use canonical released procedure bytes and a supported native Edge version; do not execute arbitrary scripts from an active feature worktree. Missing compatible host configuration or binaries is unrun, not success. Installation must converge the same boundary for existing hosts before enabling repair.

**CT-ESTATE-6 — outcomes and rollout.** Persist action/cycle, host/repository/procedure identity, observation completeness, times, pre/post counts, janitor decisions/removals, branch compare-and-delete results, fetch/prune status and stash census in existing evidence. Advance a stage only through its authorized completing writer with matching current cycle and action proof. Preserve source, merge, deployed-image and host-binary identities separately. Start in observe mode; enable only the bounded, recorded repair scope after independent review and live failure fixtures. Rollback disables new dispatch while preserving in-flight actions, replay records and all evidence. The scheduled drive's current funding hold is not waived.

## Acceptance

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-ESTATE-1 | OBJ-ESTATE-1 | The registered compiled shape resolves its stages, tools/grants and stop exits; current authority and the actual owning clone/host binding are checked before a repair can launch. |
| AC-ESTATE-2 | OBJ-ESTATE-1, OBJ-ESTATE-2 | Wrong node, changed clone, unsupported procedure, installed non-repository root, missing current consent, revoked permit and incomplete ownership fixtures launch zero cleanup commands and report the precise blocked or inconclusive state. |
| AC-ESTATE-3 | OBJ-ESTATE-2 | A disposable estate with 50 merged clean worktrees produces the expected unique decisions and bounded repair through the existing janitor; live, pinned, dirty, unpublished, open-PR and moved-ref fixtures are retained. |
| AC-ESTATE-4 | OBJ-ESTATE-2 | The bound procedure runs janitor, branch reaper, one fetch/prune and pre/post stash census; no stash mutation command is reachable and every stash identity remains present. |
| AC-ESTATE-5 | OBJ-ESTATE-3 | Duplicate ticks and delivery join one cycle/action; a crash or lost response preserves uncertainty without executing repair again under another nonce. Partial completion and remote-prune failure cannot become a whole-cycle success. |
| AC-ESTATE-6 | OBJ-ESTATE-1, OBJ-ESTATE-3 | The served DEV shape wakes on its declared cadence, invokes the compatible released native host procedure against the registered source estate, and records a verified cycle with measured before/after counts and elapsed time. |
| AC-ESTATE-7 | OBJ-ESTATE-3 | The outcome report distinguishes executed, retained, failed, unavailable and uncertain operations; broader watch obligations and the unelapsed 14-day cohort remain explicit until independently proven. |

## Delivery and review

This changes a host execution boundary, installation convergence and GPP/runtime adapters. Scope and effort must be reassessed from that actual surface before implementation. Independent architecture/security review must cover signed parameters, clone registration, current permission revalidation, secret handling, replay/uncertain effects and source-to-host convergence. A passing design is not a plan-coverage receipt, deployed watch or approval to change funding. Record the proportional implementation plan and live backlog coverage before enforcement edits. Any changed operational projection composes the existing Workroom/report primitives and is verified on the served target in light/dark and wide/narrow layouts.


## Remaining watch contracts in BI-328AE7BE

**OBJ-SUBSTRATE:** Detect and reconcile stopped required services and VM/share/socket faults through the existing substrate owner.

**OBJ-POOL:** Detect a closed or stalled local-CI pool, queue growth and orphan leases without taking ownership from a live executor.

**OBJ-MERGE:** Detect merge-flow failures and retain the existing protected-merge and change-approval authority.

**CT-WATCH-1 — one standing contract.** Register `substrate-health-watch@1.0.0`, `local-ci-pool-watch@1.0.0`, `merge-flow-watch@1.0.0` and `worktree-estate-watch@1.0.0` through the existing compiler/standing registry. Each uses observe, bounded act and report stages, a daily watch cycle, an accountable existing principal, declared tools/grants and explicit failure/budget exits. Existing faster deterministic jobs remain primary; a watch must consume their correlated observations and invoke their owned repair boundary rather than start a competing polling or recovery loop. Use the existing UTC-day cycle boundary in `work-management/work-shapes.ts`: the 15-minute drive tick is polling, not a new cycle every 15 minutes. Bind the deterministic scheduled-task cadence to the same daily cycle identity, joining repeated deliveries rather than reopening a completed cycle. Existing five-minute substrate observations remain available between watch cycles. Do not reinterpret an old shape version or silently rebind an existing room.

**CT-WATCH-2 — deterministic execution.** The platform already has typed deterministic scheduled-agent tasks, including `acceptance-sweep` in `operate/scheduled-jobs/agent-task-kind.ts` and its adapter in `backlog/acceptance-sweep/acceptance-sweep-task.ts`. Extend that established task/dispatch boundary for the watch coordinator. It must enter the pinned GPP shape and current stage authority, execute fixed adapters and publish completing evidence without requiring an LLM or a connected client. Optional coworker interpretation remains separately budgeted. A stage/tool declaration or an unused binding draft is not an executable adapter. Keep one TaskRun/cycle/action identity and the same current user, agent, tenant, permission, budget and quiescence checks; no system-context shortcut or generic shell dispatcher is introduced.

| Watch | Existing owner and observations | Permitted act and retained boundary |
| --- | --- | --- |
| Substrate health | `platform-runtime/substrate-reconciler.ts` and `queue/functions/substrate-reconciler.ts` own required-service, restart-policy and stuck-process observations. | Reuse `reconcileSubstrate` and its current required-service allowlist and quiescence gate. Never convert unreadable project/container state into a restart. A Docker-VM restart retains its explicit approved ChangeRequest and signed native action; the watch cannot reboot the host or shut down WSL directly. |
| Local-CI pool | `nonprod/local-ci-pool-liveness.ts` owns admissions-without-results; existing lease/pool policy and registry own capacity, waits and release. | Consume `assessLocalCiPoolLiveness` and invoke existing lease reconciliation/reaping through its locked owner, including `reapExpiredNonprodEnvironmentLeases` where its contract applies. Do not add age-only process deletion, release a live lease, raise capacity, reset a breaker or turn uncertain execution into an orphan. |
| Merge flow | `standing-operations-shapes.ts` already defines `pull-request-flow-watch@1.1.0`; `scripts/pr-health.mjs` and existing merge-queue/check observations provide mechanical state. | Reuse the current PR-flow collector and protected-check interpretation. The new watch adds merge-group/dequeue, semantic-conflict and time-to-merge outcomes; it must not duplicate the existing open-PR sweep or acquire permission to merge, rewrite history, bypass checks or requeue unknown effects. |
| Worktree estate | CT-ESTATE-1 through CT-ESTATE-6 define the owning-clone/native-action path and existing deterministic janitor/reaper. | Complete ownership reads precede bounded Tier-A repair; moved refs, active/pinned/dirty/unpublished work and every stash remain protected by their existing owners. |

**CT-WATCH-3 — findings and cases.** Known conditions retain their existing canonical issue keys and lifecycle. `observability/monitor-issue-writer.ts` owns monitor-cleared PortfolioQualityIssue upsert/resolve; it is distinct from the discovery-to-portfolio writer and its required inventory scope. Reuse those boundaries and declared issue types. One stable domain/subject/condition key links a finding, its repair attempt and any corrective backlog item; duplicate ticks, retry events and repeated observations must not create another case. An unrecognized anomaly creates one deduplicated corrective item through the existing governed writer. Never suppress a real failure by resolving its case merely because an action was requested.

**CT-WATCH-4 — measurement.** Retain first verified observation, detector identity, source record, case key, shape/version, cycle, action and actual outcome on existing evidence/case records. Compare two explicit 14-day cohorts by unique fault: watch first, session first, simultaneous/ambiguous and unknown provenance. Legacy missing capture is unknown, not proof that no watch detected a fault. Publish sample size, capture coverage, elapsed observation window and the case-level evidence behind numerator/denominator. A 14-day after result cannot be claimed before that window ends. Existing cadence owns later capture/reporting; the author's chat is not a scheduler. Any persistent projection or new metadata contract receives its required data-impact and retention review; there is no parallel event ledger.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-WATCH-1 | OBJ-ESTATE-1, OBJ-SUBSTRATE, OBJ-POOL, OBJ-MERGE | All four compiled shape references resolve their current role/tool grants, fixed runtime adapters, stages, budgets and stop exits; all four are observed waking on their declared DEV cadence. |
| AC-WATCH-2 | OBJ-SUBSTRATE | An isolated stopped required-container fixture produces one correlated finding and invokes the existing permitted restart; unreadable state starts no restart, and a VM restart retains its approved-change boundary. |
| AC-WATCH-3 | OBJ-POOL | An isolated orphan-lease fixture produces one finding and invokes the existing eligible reconciliation; live, disputed and unknown owner/process fixtures retain their lease and report the precise hold. |
| AC-WATCH-4 | OBJ-MERGE | A merge-group failure, dequeue and semantic-conflict fixture each has one correlated mechanical outcome and a named next permitted action; protected checks and merge/change authority are unchanged. |
| AC-WATCH-5 | OBJ-ESTATE-2, OBJ-SUBSTRATE, OBJ-POOL, OBJ-MERGE | The stopped-container, orphan-lease and 50-merged-worktree fixtures each invoke their bound repairer exactly as permitted or route an actually consequential act to its existing accountable authority; repeated cycles create no duplicate finding or corrective item. |
| AC-WATCH-6 | OBJ-ESTATE-3, OBJ-SUBSTRATE, OBJ-POOL, OBJ-MERGE | The DEV 14-day report compares unique substrate faults first detected by a watch with those first reported by a session, with case evidence, sample sizes and unknown/ambiguous capture disclosed. |

## Plan boundary

The four watches are independently shippable deliverables. The implementation plan must record decomposed live coverage against existing covering items or explicitly filed children, preserving BI-328AE7BE as the umbrella. The shared authority/evidence adapter is a dependency, not a fifth independent framework. Existing related repair items retain their own scope and completion evidence. Do not record an atomic estate-only plan as coverage of all four watches, infer a parent baseline before independent approval or close the umbrella on a source-only definition.

