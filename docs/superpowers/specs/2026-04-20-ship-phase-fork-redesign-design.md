# Ship Phase Fork Redesign

**Status:** Draft — spec-first per the C1 follow-up from the 2026-04-20 Build Studio cleanup session. No code changes in this document; it exists to reach alignment before anyone touches `PhaseIndicator`, `feature-build-types.ts`, or `ship.prompt.md`.

**Owner:** TBD (route to whoever ends up scheduling the build)
**Date:** 2026-04-20
**Related:** [2026-03-29-sandbox-preview-ship-phase-fixes.md](2026-03-29-sandbox-preview-ship-phase-fixes.md), [2026-03-26-build-studio-it4it-value-stream-alignment-design.md](2026-03-26-build-studio-it4it-value-stream-alignment-design.md), [2026-03-29-autonomous-promotion-pipeline-design.md](2026-03-29-autonomous-promotion-pipeline-design.md)

---

## 1. Problem Statement

### 1.1 "Ship" is three concepts wearing one label

Today, a single phase named `ship` ([apps/web/lib/explore/feature-build-types.ts:187](../../../apps/web/lib/explore/feature-build-types.ts#L187)) spans three distinct business outcomes:

1. **Extraction** — `deploy_feature` extracts the sandbox diff and registers the DigitalProduct version via `register_digital_product_from_build`. No external system is touched yet; the feature is *ready* to leave the sandbox.
2. **Upstream contribution** — `assess_contribution` + `contribute_to_hive` create a GitHub pull request against the upstream Hive repo. This is a **community-visible** outcome; once it lands, the feature exists outside this install.
3. **Production promotion** — `execute_promotion` (or its operator-handoff equivalent) runs the autonomous promotion pipeline: DB backup, image build, portal swap, health check. This is a **production-visible** outcome; once it lands, real customers hit the new code.

See [prompts/build-phase/ship.prompt.md](../../../prompts/build-phase/ship.prompt.md) for the current "MANDATORY SHIP SEQUENCE" that sequences all three through a single prompt.

### 1.2 Why the overload hurts

- **The user can't tell what "done" means.** The PhaseIndicator ([apps/web/components/build/PhaseIndicator.tsx:33](../../../apps/web/components/build/PhaseIndicator.tsx#L33)) shows a checkmark on "Ship" the moment the phase column flips to `ship`. But deployment might still be queued (closed window), the upstream PR might not have landed (DCO missing), and registration might have succeeded without either. One checkmark, three different truths.
- **The two forks are not mutually dependent.** `fork_only` mode skips the contribution fork entirely; `contribute_all` runs both. Some installs will never have a configured promotion pipeline (see [A1 in the 2026-04-20 cleanup session](../../../apps/web/lib/mcp-tools.ts#L4393) — promoter image missing). Rendering them as one sequential phase misrepresents the actual data flow.
- **Per-phase progress is invisible.** Build has `buildPlan.tasks[]` with a task count, review has `uxTestResults[]` + `planReview.issues[]`, but the PhaseIndicator currently has no concept of "Build 3 of 5 tasks done." Users see only the binary phase bubble.
- **"Complete" is ambiguous.** `complete` today means "the agentic loop finished the ship sequence without errors" — not "PR merged" or "production deployed." Callers ([agent-coworker.ts:722](../../../apps/web/lib/actions/agent-coworker.ts#L722) looks for builds with `phase: "ship"`) can't use the phase column to distinguish queued-for-deployment from actually-live.

### 1.3 Evidence from recent runs

- **FB-21EEA510** (subnet-scoped graph filtering, 2026-04-19 → 2026-04-20) reached `ship` with `register_digital_product_from_build` succeeding and `ChangePromotion CP-D3E8BD0C` queued. `execute_promotion` never ran (promoter image missing; fixed to operator-handoff in A1 `fff37941`). UI showed "Ship complete" — misleading. A1's CTA improvement is a band-aid; the structural problem is the phase label itself.
- **FP-A5AF6245 + FP-26F0EF2A** (same build) both had `manifest.prUrl = null` even though PR #149 landed (fixed in A2 `d78e43df`). During the failure window, PhaseIndicator still showed ship-active; the user had no visual signal that the contribution fork was stuck.

---

## 2. Non-Goals

- **Not** renaming or removing any `BuildPhase` enum value. That would touch every seed, migration, MCP tool definition, test fixture, and DB row. Changes are restricted to adding new labels and rendering forks; the underlying `"ideate" | "plan" | "build" | "review" | "ship" | "complete" | "failed"` DB column stays.
- **Not** merging the upstream PR flow and promote-to-prod flow into one button. They are genuinely independent — one produces a commit on a public repo, one produces a container swap on this install's Docker host.
- **Not** building a new task-tracking UI. Substep counts are computed from already-persisted data (`buildPlan.tasks`, `reviewAttempts`, `ChangePromotion.status`, `FeaturePack.manifest.prUrl`). No new DB columns for progress.
- **Not** changing the ship-phase MCP tool sequence (`deploy_feature` → `register` → `epic` → `contribute` → `deploy`). The spec tightens how the UI REPRESENTS that sequence; the sequence itself stays as-is until a separate spec proposes otherwise.
- **Not** adding visualization for `failed` or `complete` as first-class terminal nodes. They stay as the existing scalar states.

---

## 3. Proposed Design

### 3.1 Terminology

| Today | After |
| ----- | ----- |
| Ship (binary phase) | **Ready to Ship** (phase label) — the build has produced a viable artifact and is eligible for one or both forks. |
| `complete` (ambiguous) | `complete` (unchanged DB-side) — but the UI reports per-fork status separately; see §3.3. |
| `ship` DB column value | unchanged — still `"ship"`. Label-only change in `PHASE_LABELS`. |

The DB phase stays `ship`. The USER-FACING LABEL becomes "Ready to Ship" to set the expectation that two independent outcomes may follow.

### 3.2 Two-fork render model

```
┌───────────┐    ┌───────┐    ┌───────┐    ┌───────┐    ┌───────────────┐
│  Ideate   │ →  │ Plan  │ →  │ Build │ →  │Review │ →  │ Ready to Ship │
│   0/3     │    │  0/N  │    │  0/M  │    │  0/K  │    │               │
└───────────┘    └───────┘    └───────┘    └───────┘    └───────┬───────┘
                                                                │
                                                                │ forks
                                                    ┌───────────┴────────────┐
                                                    ▼                        ▼
                                            ┌───────────────┐      ┌────────────────┐
                                            │  Upstream PR  │      │ Promote to Prod│
                                            │   assess  →   │      │   window  →    │
                                            │   contribute  │      │   execute      │
                                            └───────┬───────┘      └────────┬───────┘
                                                    │                       │
                                                    ▼                       ▼
                                            ┌────────────────┐      ┌───────────────┐
                                            │ PR #N opened   │      │ Deployed vX.Y │
                                            │   or skipped   │      │   or scheduled│
                                            └────────────────┘      └───────────────┘
```

**Key rendering rules:**

1. Each of the five main-track nodes shows a substep count (§3.4).
2. The two forks render **in parallel** below the "Ready to Ship" node — not as a sixth/seventh sequential node.
3. Each fork has its own state machine derived from already-persisted data (§3.5).
4. Each fork can land in one of three terminal states: **shipped**, **scheduled/queued**, **skipped** (mode doesn't apply or user chose local-only).
5. A fork that errored shows an error pill with the failure message (currently rendered as plain text; this spec proposes a dedicated pill).

### 3.3 Terminal state per fork

**Upstream PR fork:**

| State | Source of truth | Display |
| ----- | --------------- | ------- |
| `skipped` | `devConfig.contributionMode === "fork_only"`, OR user chose Keep Local | "Kept local" (gray) |
| `in_progress` | `assess_contribution` called, `contribute_to_hive` not yet returned | "Assessing…" / "Opening PR…" |
| `shipped` | `FeaturePack.manifest.prUrl` is non-null | "PR #N open" (linked) |
| `errored` | `logBuildActivity` recorded a `contribute_to_hive` failure | "PR failed: `{reason}`" with retry affordance |

**Promote-to-Prod fork:**

| State | Source of truth | Display |
| ----- | --------------- | ------- |
| `awaiting_operator` | `execute_promotion` returned `{status: "awaiting_operator"}` (A1 path) | "Operator action required" with link to Operations > Promotions |
| `scheduled` | `ChangePromotion.status === "scheduled"` (from `schedule_promotion`) | "Scheduled for `{windowDesc}`" |
| `in_progress` | `ChangePromotion.status === "in_progress"` | "Deploying…" |
| `shipped` | `ChangePromotion.status === "deployed"` AND health check passed | "Deployed `{versionTag}` at `{timestamp}`" |
| `errored` / `rolled_back` | `ChangePromotion.status === "rolled_back"` | "Rolled back: `{rollbackReason}`" |

### 3.4 Per-phase substep counts

Counts are **read-computed** from existing data each render; no new persistence.

| Phase | Numerator | Denominator | Source |
| ----- | --------- | ----------- | ------ |
| Ideate | 1 if scoutFindings saved + 1 if designDoc saved + 1 if designReview passed | 3 | `FeatureBuild.scoutFindings`, `.designDoc`, `.designReview.decision` |
| Plan | 1 if buildPlan.tasks present + 1 if planReview passed | 2 | `FeatureBuild.buildPlan`, `.planReview.decision` |
| Build | tasks with a recorded completion | `buildPlan.tasks.length` | `FeatureBuild.buildPlan.tasks[*].status` (existing) |
| Review | 1 per passed check | typecheck + tests + UX steps | `FeatureBuild.verificationOut`, `.uxTestResults[]` |
| Ready to Ship | 1 if diff extracted + 1 if productVersion registered | 2 | `.diffPatch`, `productVersionId` |

Each node's ring renders a progress arc proportional to `numerator / denominator`. Zero means the ring is unfilled; full means it's checked.

### 3.5 Data flow

No schema changes. The spec derives every displayed state from:

- `FeatureBuild` columns that already exist: `phase`, `buildPlan`, `planReview`, `designDoc`, `designReview`, `scoutFindings`, `verificationOut`, `uxTestResults`, `diffPatch`, `productVersionId`.
- `FeaturePack.manifest.prUrl` (fixed in A2 `d78e43df` to be reliable post-fix).
- `ChangePromotion.status`, `.rollbackReason`, `.deploymentLog` (existing).
- `PlatformDevConfig.contributionMode` (for fork-skipped detection).
- `BuildActivity` records for error display (already written by every MCP tool).

A new server action `getBuildFlowState(buildId): BuildFlowState` bundles the above into a single typed result. The `BuildFlowState` type is declared in a new file `apps/web/lib/build-flow-state.ts`; no existing types change.

### 3.6 MCP tool signal changes

**A1 (`execute_promotion`)** already returns `data: { status: "awaiting_operator" }` when the promoter image is missing. The fork renderer consumes this.

**A2 (`contribute_to_hive`)** now upserts `FeaturePack.manifest.prUrl` idempotently. The fork renderer polls this column.

No other tool-level changes are needed for this spec. If a future decomposition wants to stream per-fork progress via SSE, that's a follow-up.

---

## 4. Research & Benchmarking

Per AGENTS.md §"Design Research," this section documents what's been learned from existing best-of-breed solutions.

### 4.1 Open source

- **GitLab CI pipeline UI** ([gitlab.com/gitlab-org/gitlab](https://gitlab.com/gitlab-org/gitlab)) — Uses a DAG view where parallel stages render side-by-side. The "stage has jobs" pattern (a stage like "deploy" fans out into "deploy-staging" + "deploy-prod" + "post-deploy-smoke") is exactly the model we want for the Ready-to-Ship fork. **Adopted:** the parallel-under-a-single-stage-label concept. **Rejected:** GitLab's full DAG cannot be rendered in our current linear PhaseIndicator without a layout rewrite — not in scope.
- **Argo Workflows** ([argoproj/argo-workflows](https://github.com/argoproj/argo-workflows)) — DAG with explicit `dependencies:` between nodes. Each node has its own status pill (Pending/Running/Succeeded/Failed/Skipped). **Adopted:** the five-state status vocabulary (skipped vs. failed distinct from not-run) for our fork state machines.
- **Drone CI** — Linear pipeline with parallel steps inside a stage. Too simple for our case — no fork/join semantics.

### 4.2 Commercial

- **GitHub Actions workflow view** — Jobs run in parallel under a single workflow. Each job has its own status. The "matrix of failed jobs" surface inspired our "one fork may be stuck while the other succeeded" rendering.
- **CircleCI workflow UI** — Similar fork/join visual to GitLab. CircleCI uses colored edges (green for success, red for failed, grey for skipped) connecting nodes. **Adopted:** edge-color signal for fork terminal state; makes skipped vs. failed visually distinct without reading labels.
- **Harness CD** — Distinguishes "Approval" stages from "Deployment" stages. Our operator-handoff state (A1) is analogous to Harness's manual approval gate. **Adopted:** the pattern of "waiting on human" being a first-class state, not an error.

### 4.3 Patterns adopted

- Five-state fork vocabulary: `skipped | scheduled | in_progress | shipped | errored` (plus `awaiting_operator` for the promote fork).
- Per-node substep count rendered as a progress arc.
- Parallel render of the two forks below a single parent node.
- Edge-color signal for fork state.

### 4.4 Patterns rejected

- Full DAG rendering with arbitrary edges (too much UI surface to build).
- Timeline view with absolute timestamps (would need to persist `phaseStartedAt`, out of scope).
- Visual regression diff or "pipeline history" (Argo has it, we don't need it yet).

### 4.5 Anti-patterns avoided

- **Silent completion** — the current code flips `phase: "ship"` and shows a checkmark even when the upstream PR didn't land. Fixed by making fork terminal states first-class (`shipped` vs. `errored` vs. `scheduled`).
- **Phase bubble as boolean** — the current PhaseIndicator uses checked/unchecked; the proposed ring arc preserves the coarse signal while adding progress detail.
- **Coupling forks** — some pipeline UIs gate deployment on contribution PR merge. Ours doesn't (the forks are genuinely independent); the spec preserves that independence.

---

## 5. Data Model Audit

Per AGENTS.md §"Data Model Stewardship," auditing existing models before proposing new ones.

### 5.1 What already exists and is reused

- `FeatureBuild.phase` — stays as-is.
- `FeatureBuild.buildPlan.tasks[*].status` — already persists per-task completion.
- `FeatureBuild.verificationOut`, `.uxTestResults` — already persist review-phase pass/fail.
- `FeaturePack.manifest.prUrl` — idempotent after A2 `d78e43df`.
- `ChangePromotion.status` + `.rollbackReason` + `.deploymentLog` — already the authoritative source for the promote fork.
- `PlatformDevConfig.contributionMode` — already tells us whether the upstream fork is applicable.
- `BuildActivity` records — already written on every tool call; error display reads from here.

### 5.2 What is NOT being added

- No new `FeatureBuild.phaseSubstepCount` column — computed on render.
- No new `FeatureBuild.contributionStatus` column — derived from `FeaturePack.manifest.prUrl`.
- No new `FeatureBuild.deploymentStatus` column — derived from the latest `ChangePromotion` linked via `productVersion.featureBuild`.

### 5.3 Refactor opportunity flagged (not done here)

`FeatureBuild.phase === "complete"` is currently ambiguous — it could mean "agent loop finished" or "both forks shipped" or "contribution skipped, deployment succeeded." A future spec could consider a terminal-phase cleanup that defines `complete` as "at least one fork reached its `shipped` terminal state, OR both forks reached their applicable terminal states." Out of scope for C1.

---

## 6. Task Decomposition

Listed in implementation order; each task is ~1 subagent-hour or less.

### Chunk A — Data shape and derivation (no UI)

- **A.1** Create `apps/web/lib/build-flow-state.ts` with `BuildFlowState` type (main-track nodes + two fork states) and `getBuildFlowState(buildId)` server action. Pure derivation from existing columns.
- **A.2** Unit test `getBuildFlowState` — fixtures for each fork terminal state (shipped / errored / scheduled / awaiting_operator / skipped / in_progress) and each combination of `contributionMode × fork outcomes`.
- **A.3** Unit test per-phase substep counts — fixtures for half-complete builds in each main-track phase.

### Chunk B — Rendering

- **B.1** Extract `PhaseIndicator.tsx` into a composition: main-track row + fork row. Keep props back-compatible (accepts a `buildId` or a `flowState` prop).
- **B.2** Add a `ForkNode` sub-component rendering a single fork's state and terminal label.
- **B.3** Add substep arc rendering — SVG ring or CSS conic-gradient, no new dependencies.
- **B.4** Update `PHASE_LABELS.ship` display string: "Ship" → "Ready to Ship" (label-only; DB value stays `"ship"`).
- **B.5** Playwright visual test fixtures for each fork-state matrix.

### Chunk C — Prompt alignment

- **C.1** Update [prompts/build-phase/ship.prompt.md](../../../prompts/build-phase/ship.prompt.md) intro to say "Ready to Ship — two forks follow" so the coworker's narration to the user matches the UI.
- **C.2** After each fork completes, the coworker should summarize which fork landed and link the evidence (PR URL / ChangePromotion ID), rather than saying "shipped" generically.

### Chunk D — Cleanup

- **D.1** Replace `PHASE_LABELS.ship = "Ship"` string everywhere it's hardcoded in tests and fixtures. Test-only churn.
- **D.2** Remove any "Ship complete" assertions in e2e specs that conflate fork completion with phase completion.

---

## 7. Alignment Questions

Before implementation, these need Mark's call:

1. **Label wording.** "Ready to Ship" feels right to me but could also be "Deployable" or "Ship-ready." Pick one.
2. **Fork order / position.** Upstream PR on the left, Promote-to-Prod on the right? Or prioritize by mode (Promote first for fork-only, Upstream first for contribute_all)?
3. **Awaiting-operator state styling.** Amber (action required) or blue (informational)? Amber matches A1's Platform Development CTA pattern.
4. **Completion semantics.** When does `phase: "complete"` get written to the DB? Options: (a) both applicable forks in terminal state, (b) at least one fork in `shipped`, (c) drop the status change from auto-advance logic entirely and only flip `complete` when user confirms. I recommend (a) — deterministic, no user gate, matches the existing "agentic loop decides" pattern.
5. **Scope of this spec.** Current draft covers rendering + derivation + prompt alignment but leaves refactoring `phase: "complete"` semantics for a later spec. Keep the split, or bundle the semantics rework in here?

---

## 8. Out of Scope (tracked for later)

- Post-shipment monitoring ("PR merged upstream? Deployment still healthy 24h later?") — separate spec; needs new async probes.
- Visual-regression pipeline history — not needed until we have enough builds to justify it.
- Per-fork rollback UI — today we rely on `ChangePromotion.rollbackReason`; a rollback re-trigger from the UI is a future add.
- Multiple concurrent deployments — currently one `ChangePromotion` per build; if we add stacked deployments, the fork model generalizes cleanly (the fork becomes an array of promotion records).
