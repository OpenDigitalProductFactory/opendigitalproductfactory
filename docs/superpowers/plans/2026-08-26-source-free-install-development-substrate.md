---
title: Source-free install development substrate implementation plan
status: draft
backlog_item: BI-357792B1
epic: EP-MFG-DELIVER-INSTALL
spec: docs/superpowers/specs/2026-08-26-source-free-install-development-substrate-design.md
---

# Source-free install development substrate implementation plan

> **For agentic workers:** execute this plan one independently reviewable backlog
> item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
> implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
> before any success claim, and `dpf-pr-with-dco` for handoff.

**Date:** 2026-08-26

**Status:** review-ready; implementation starts only after design and plan approval

**Umbrella:** BI-357792B1

**Architecture decision:** DI-3C5CDA9DAB11 (`release-assets-git-bundle`)

## Outcome

A source-free release install receives the exact release source as a verified
baseline, Build Studio and all impact intelligence operate on one Workroom
snapshot, business and development agents receive the correct contract, dead
Workrooms reconcile without losing work, and Platform updates presents a calm,
state-specific experience.

## Existing substrate to preserve

- Verification-gated GHCR candidate resolution and existing source-free
  self-upgrade orchestration.
- `/dpf-release-assets`, `SHA256SUMS`, `install-release-assets.mjs`, install-state
  migration/transaction helpers, recovery points, and rollback.
- `sandbox_workspace`, Build Studio per-build worktrees, Workroom lease and
  evidence fields, and the shared worktree janitors.
- `CodeGraphIndexState`, `CodeGraphFileHash`, `CodebaseManifest`, graph projection
  registry/reconcilers, and PR #4711's boot invoker work.
- Consumer host profile, MCP instruction builder, minimal agent pointer, external
  operating contract, token-grant intersection, and `decisionScope`.
- Existing `/ops/self-upgrade` action/orchestrator, `OwnerReleaseCard`, trigger,
  history, and delivery IA.

## Delivery map

| Order | Deliverable | Backlog | Dependency |
|---:|---|---|---|
| 0 | Reconcile graph invoker work already in flight | BI-86EF5900 / PR #4711 | None |
| 1 | Publish and transactionally activate verified source baseline | BI-48951394 | Existing consumer release updater |
| 2 | Align Workroom, tools, graph, manifests, and impact to one snapshot | BI-89CD90D4 | Slice 1; PR #4711 merged or explicitly rebased |
| 3 | Route agent instructions by engagement scope | BI-1BA8F46C | Slice 2 projection contract |
| 4 | Complete Workroom liveness/reaping semantics | BI-9A353411 | Slice 2 identity/overlay semantics |
| 5 | Simplify Platform updates UX | BI-705CA714 | Existing updater state projection; may run parallel to 1–4 |
| 6 | Canonical source-free acceptance and rollout | BI-357792B1 | Slices 1–5 |

## Slice 0 — reconcile related graph work

**Goal:** land or account for PR #4711 before touching projection invocation.

1. Re-sweep open PRs and inspect #4711's final files and merge SHA.
2. If merged, branch subsequent graph work from the new `main` and treat its
   `refresh-projections` invoker as the registry entry point.
3. If still open, avoid those files or coordinate the dependent change explicitly;
   do not implement a second boot scheduler.
4. Reproduce BI-86EF5900 against the canonical source-free install and capture
   graph identity, file count, relationship families, and known-symbol queries.

**Verification:** captured baseline distinguishes invocation coverage from source
identity/freshness and names the exact release/worktree snapshot.

## Slice 1 — verified release source baseline (BI-48951394)

**Likely files:**

- `.github/workflows/publish-image.yml` and release/install verification workflows
- `Dockerfile`
- `scripts/installer/install-release-assets.mjs`
- `scripts/installer/install-state*.schema.json`
- install-state migration/transaction helpers and shell/PowerShell lifecycle code
- `docker-entrypoint.sh`, `docker-compose.yml`, platform substrate manifest and
  generated capability catalog if the mount contract changes
- focused tests under `scripts/installer/` and release workflow contract tests
- `docs/install/platform-support-watchlist.md` if a host-specific defect is found

**Steps:**

1. Add a release job that creates one `dpf-source.bundle` from the verified commit
   and writes `source-baseline.json`. Verify bundle ref, commit, tree, and bounded
   contents before publication.
2. Pass that single artifact into every platform image build. Add it to
   `/dpf-release-assets/source/` and `SHA256SUMS`; assert identical checksums across
   the multi-architecture image set.
3. Extend install state to v3 with a nullable `sourceBaseline` identity. Implement
   deterministic v2→v3 migration without inventing a baseline for old installs.
4. Extend the release-assets transaction to snapshot, copy, activate, record, and
   restore the baseline as one rollback unit.
5. Add an idempotent baseline materializer for `sandbox_workspace`: import with
   hooks disabled into a temporary path, verify source/tree identity, atomically
   activate, and retain the previous baseline through health verification.
6. On a clean consumer install, initialize the workspace from the verified commit
   instead of creating a synthetic `dpf-upstream`/`my-changes` history. Preserve a
   user-managed checkout and quarantine dirty legacy managed volumes.
7. Mark `dpf-source-code` as compatibility-only. Remove it in a later PR only after
   callers and telemetry prove it unused.

**Tests first:** malformed manifest, wrong bundle checksum, missing commit, wrong
tree, multi-arch mismatch, interrupted copy, install-state migration, rollback,
dirty legacy volume, first install offline, and N-1 upgrade.

**Rollback:** reinstall the prior verified assets and install-state recovery file,
reactivate the prior baseline, and keep the prior image set. Never synthesize or
fetch `main` as recovery.

**Docs impact:** update source-free install, upgrade, recovery, and platform
support docs; retain contributor/source-install guidance unchanged.

## Slice 2 — one Workroom snapshot and truthful projections (BI-89CD90D4)

**Likely files:**

- `apps/web/lib/install/host-profile.ts` and a dependency-light source-baseline
  reader/projection module
- `apps/web/lib/build/sandbox/sandbox-source-strategy.ts`
- `apps/web/lib/build/sandbox/build-branch.ts` and dispatcher workdir callers
- `apps/web/lib/build/codebase-tools.ts`
- `apps/web/lib/build/code-graph/*`, graph reconcile/invoker modules, and trust
  vector adapter
- `apps/web/lib/build/manifest-generator.ts`
- Prisma schema/migration only if existing projection fields cannot carry identity;
  prefer current JSON/projection fields and document any schema proof
- MCP code-intelligence pack and result schemas

**Steps:**

1. Implement pure `SourceBaselineIdentity` and `SourceSnapshotIdentity`
   projections. Resolve contributor checkout or consumer baseline through the host
   profile, then overlay the claimed Workroom's branch/head/worktree.
2. Make Workroom claim precede branch creation. Create the branch from the
   activated baseline, persist existing branch/SHA/path fields, and verify them on
   resume.
3. Thread the resolved Workroom workdir into every ideate/plan/build/verify agent,
   file tool, diff collector, and preview operation. Remove implicit `/workspace`
   defaults from Workroom-scoped paths while preserving safe non-Workroom callers.
4. Register source-derived projections with version, snapshot digest, required
   coverage invariant, invalidation inputs, and reconciler. Reuse #4711's invoker.
5. Tighten `CodeGraphIndexState` and `CodebaseManifest` readiness. A valid DPF
   checkout with zero files/modules or zero registered structural edge families
   is degraded/failed, never ready. Branch/SHA/tree mismatches invalidate.
6. Return snapshot identity and limitation in code search, graph, impact, and
   freshness MCP results. Prevent the agent loop from attributing missing source
   or projection failure to model capability.
7. Add snapshot transitions: release baseline; clean Workroom; dirty Workroom;
   projection pending; projection ready; mismatch; reconciler failure.

**Tests first:** pure identity resolution, contributor/consumer/unknown host,
workdir propagation to all dispatchers, stale branch, zero-edge graph, zero-file
manifest, partial projection, retry, and result qualification.

**Functional proof:** from one source-free Workroom, query a known source file by
file search and graph search, generate impact, inspect manifest counts, change the
file in the overlay, reconcile, and prove all identities move together while the
running production image remains unchanged.

**Rollback:** projection schema/version feature flag falls back to qualified
read-only results. Do not restore the old unqualified `ready` state.

## Slice 3 — engagement-scoped agent contract (BI-1BA8F46C)

**Likely files:**

- MCP initialization/instruction builder and token context
- `apps/web/lib/install/host-profile.ts`
- external-agent operating profile/Work Packet projections
- Workroom claim/dispatch context
- `config/consumer-install/agent-pointer.md`
- `packages/dpf-skill-pack` only if an existing skill needs a pointer update

**Steps:**

1. Define one pure `AgentEngagementProfile` projection over principal, effective
   grants, host profile, `decisionScope`, work type, and claimed Workroom.
2. For organization operation, serve the external operating contract, org context,
   Work Case/Packet, and authorized surfaces without contributor doctrine.
3. For platform development, serve repository governance pointers, MCP coordination,
   Workroom identity, and the resolved snapshot/worktree. Never imply that runtime
   asset directories are editable source.
4. Fail closed for missing or contradictory scope. Keep the release `AGENTS.md` a
   minimal pointer and the repository root rulebook developer-specific.
5. Apply the same projection to MCP clients, Build Studio, in-platform coworkers,
   and federation adapters through the exposure catalog; do not fork copy per
   surface.

**Verification:** golden instruction snapshots for both engagement types and
unknown scope; grant-intersection tests; a headless business agent completes a
governed business action without source instructions; a development agent sees
only its claimed Workroom.

**Rollback:** revert projection selection while preserving the existing MCP-first
consumer pointer; never copy the root developer rulebook into release assets.

## Slice 4 — Workroom liveness and overlay reaping (BI-9A353411)

**Likely files:** existing Workroom liveness query/reconciler, lease reaper,
inert-build reaper, sandbox GC, unified WIP query, status projections, metrics,
and their tests.

**Steps:**

1. Convert existing liveness observations into a closed transition policy for
   active, durable wait, expired mid-flight, finished, merged, abandoned, and
   identity-invalid Workrooms.
2. Record a durable-wait reason/deadline/owner in existing Workroom state; age
   alone cannot reap it.
3. Auto-close merged/terminal Workrooms after required evidence is durable.
4. Surface finished-but-stranded work for promotion rather than deleting it.
5. Reap only the derived worktree/branch/cache after transition safety checks.
   Preserve baseline, canonical evidence, and dirty or identity-invalid overlays.
6. Emit counts and age for each liveness class and alert on stranded finished work.

**Verification:** clock-driven transition tests, killed-session recovery, durable
wait beyond normal TTL, merged close, dirty quarantine, and cross-surface WIP view.

**Rollback:** return the reconciler to observe-only; never perform an inverse
destructive sweep.

## Slice 5 — calm Platform updates UX (BI-705CA714)

**Likely files:**

- `/ops/self-upgrade` page and delivery navigation projection
- `OwnerReleaseCard.tsx`, `SelfUpgradeTriggerControl.tsx`, `owner-summary.ts`
- existing run history/log/diagnostic and confirmation primitives
- state/view-model tests, copy tests, accessibility tests
- `docs/ux-fit/2026-08-26-platform-updates.ux-fit.json`

**Steps:**

1. Create a closed, server-derived update view model: checking, current,
   available, confirmation, in-flight, success, actual failure with recovery
   outcome, conflict, and unavailable.
2. Make Simple and Full render the same calm first viewport and primary action.
   Full adds compact operational facts below it, not a separate mental model.
3. Remove speculative failure/recovery sections, ordinary emergency override,
   raw identifiers, open logs, and historical failures from arrival.
4. Open confirmation only after `Install now`. State consequence, expected
   duration, automatic recovery, and `Install` / `Not now`.
5. Make progress, success, failure, rollback, and conflict copy state-specific.
   Put diagnostics/history behind explicit disclosure in both modes. Show an
   override only when the authoritative state says it is relevant and allowed.
6. Use **Platform updates** in navigation. Preserve `/ops/self-upgrade`; add a
   `/delivery/updates` compatibility/convergence path only through the existing IA
   decision, without duplicating page logic.
7. Render and measure every state at desktop/narrow widths, light/dark themes,
   keyboard focus, and screen reader. Record the UX-fit artifact before handoff.

**Verification:** component/view-model tests prove forbidden arrival content is
absent, controls are state-gated, and confirmation follows invocation. Governed
browser evidence covers every state and a real N-1 update.

**Rollback:** retain the prior route and orchestrator; revert only the projection
and presentation. No migration or upgrade-run data is removed.

## Slice 6 — canonical acceptance and rollout (BI-357792B1)

1. Build the release through the canonical workflow; verify one source baseline
   artifact is byte-identical across target images.
2. Install clean consumer instances on Windows and one Unix target from images
   only. Remove network access after pulls and prove baseline initialization.
3. Exercise Build Studio through claim → plan → overlay edit → graph/manifest
   reconcile → verify → review evidence. Confirm the production runtime did not
   advance from Workroom bytes.
4. Exercise external organization-operation and platform-development agents and
   compare their served profiles and effective tools.
5. Kill sessions in active, durable-wait, finished, and merged states; prove the
   liveness policy and overlay preservation/removal.
6. Publish N+1 and execute Platform updates: available → confirmation → progress
   → success. Inject baseline activation and health failures and prove rollback
   plus actual-failure UX. Exercise a dirty overlay conflict.
7. Record image, source, tree, bundle, Workroom, projection, and upgrade-run
   identities as canonical acceptance evidence. Reconcile every umbrella
   acceptance criterion before marking any BI done.

## Gate matrix

| Change | Fast local gate | Canonical/runtime gate |
|---|---|---|
| Release workflow/assets | workflow contract tests, installer tests, shell/PowerShell syntax | multi-arch publish + clean install + N-1 rollback |
| Snapshot/projections | affected Vitest, typecheck, graph/manifest fixtures | live source-free Build Studio exercise |
| Agent contract | instruction/grant snapshot tests, typecheck | MCP sessions in both engagement scopes |
| Workroom liveness | clock/state tests, janitor safety tests | killed-session and durable-wait exercise |
| Platform updates UI | component/copy/a11y tests, typecheck, measured UX artifact | governed browser state matrix + real upgrade |
| Docs only | documentation/reference guards | none until implementation |

Full production build remains the cloud merge-queue safety net. Any migration must
apply to populated v2 install state and arbitrary supported database state.

## Risks and controls

| Risk | Control |
|---|---|
| Bundle and image identities drift across architectures | Generate once, checksum in every image, assert at publication. |
| Old managed volume contains user work | Detect dirty/unknown identity and quarantine; never overwrite. |
| Large baseline increases image/storage cost | Exclude generated/dependency/LFS payloads; measure compressed size; retain only active/rollback baselines. |
| Portal boot waits on indexing | Activate identity first; reconcile asynchronously; surface pending truthfully. |
| Workdir threading misses a dispatcher | Registry/contract test enumerates every engine and tool consumer. |
| Projection invokers race or duplicate PR #4711 | Rebase after slice 0 and reuse the one registry/invoker. |
| Agent scope leaks developer authority | Closed engagement projection plus token-grant intersection and unknown fail-closed. |
| Reaper destroys useful work | Transition evidence before deletion; dirty/finished/waiting states are non-destructive. |
| UX simplification hides actionable failure | State-specific message plus explicit diagnostics; only hypothetical content is removed. |

## Documentation impact

Each implementation PR updates the user, agent, install, operations, architecture,
and route documentation it changes. The final rollout reconciles the retired
synthetic-source comments and superseded source-lifecycle draft so no supported
surface still promises `my-changes`, an auto-advancing source volume, or developer
`AGENTS.md` semantics to business agents.

## Backlog coverage

Pending governed `record_plan_backlog_coverage` after this file is finalized.

## Approval boundary

Approval authorizes this sequencing, not a monolithic implementation. Every slice
must claim its own Workroom, recheck live overlap, pass its proportional gates,
and land through a signed PR and merge queue.
