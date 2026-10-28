---
status: proposed
backlog: BI-328AE7BE
---

# Worktree estate watch

Workroom: WC-5656DB2E. Architecture decision: [DI-43391D1FA61B](https://localhost/coworker-decisions/decisions/DI-43391D1FA61B). Source inspection: `46f8a5ca9cb75aa871a223b70acc6dcc65d15a67`.

## Scope and measured problem

The current owner request is a standing `worktree-estate-watch@1.0.0` that runs the janitor, branch reaper, fetch/prune and stash census on a cadence and records outcomes. BI-328AE7BE also names substrate, local-CI and merge-flow watches and a 14-day detection comparison. This design specifies the estate delivery first; it does not claim those other watches or that comparison are delivered. Plan coverage must preserve the remaining obligations rather than close the umbrella on an estate-only receipt.

Live DEV mount inspection on October 28 shows `/host-dpf` maps to the installed `D:/DPF`, and `/host-worktrees` to `D:/DPF-worktrees`. The owning source clone is `D:/DPF-source-root`; its canonical worktree base is `D:/DPF-source-root-worktrees`. The existing portal janitor's fallback root therefore cannot establish ownership of this estate. A declared shape alone cannot repair this.

The owner supplied the closeout baseline: 1,851 local branches, 501 reapable, 1,178 remote refs with 979 prunable, and 32 stashes. A later read observed 1,863 branches, 1,186 remote refs and 32 stashes; concurrent growth is not a cleanup result. The reaper still exists only on `fix/thread-gaps-closeout`; its containing protected delivery is a prerequisite.

## Existing substrate and decision

Reuse the shape documents/compiler, standing registry, Workroom drive and evidence writer. Reuse `scripts/lib/worktree-base.mjs`, `scripts/worktree-janitor.mjs`, and the closeout's branch reaper, including their complete-ownership, current-PR, clean/merged, pin, live-session and compare-and-delete checks. Never reproduce their cleanup policy in a second implementation.

The native Edge implementation in `services/edge-node-go/internal/action/` already owns signed machine-bound actions, fixed handlers and durable nonce consumption. `packages/db/src/remote-action-dispatch.ts` owns current scope, node trust and allowed action types. Extend that channel with an exact estate procedure. Do not add a general command tool, a scheduler, a table or a writable portal mount for host Git.

WWMD selected this option with high confidence and autonomy eligibility: estimated composite 13.144 versus 9.719 for portal-mounted source, margin 3.425. Relevant contributions included Architecture Over Shortcuts, Ground New Work In Existing Platform, Single Source of Truth and platform independence. These are design estimates, not performance measurements or a grant. Research receipt: `initiative-0fc25733-18d3-44f8-b479-54ca6643db67`.

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

