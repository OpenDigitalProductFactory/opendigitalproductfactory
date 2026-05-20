# Build Studio Single Status Command Spine Design

## Problem

The 2026-05-19 portal validation of `FB-71FB3A53` showed that Build Studio now has two primary status narrators for the same build. The top `Studio Control` card derives action and failure-axis text from the `FeatureBuild` row and task summaries. The Progress tab derives `Operational status` from the newer progress projection, including dispatch history and scoped verification. In the observed build, the Progress projection correctly classified the failure axis as `usage-limit`, while the top card reported `unknown`.

That split is a product problem, not a copy bug. Operators should not have to decide which status card is more authoritative. The UI should expose one command surface and make every supporting signal evidence underneath it.

Backlog reference: `BI-0B41B4E3`.

## Observed Evidence

- `BuildStudio.tsx` renders `BuildStudioWorkflowActionCard` above the tabs and separately renders `BuildProgressOperationalPanel` inside the Progress tab.
- `build-studio-workflow-actions.ts` classifies implementation recovery from non-clean task summaries and `verificationOut`.
- `progress-visibility.ts` classifies the status heading from `BuildDispatchAttempt` and scoped verification.
- Live DB fallback for `FB-71FB3A53` showed repeated `usage-limit` dispatch attempts whose `rootCauseSummary` was `Reading prompt from stdin...`, so the dispatch classifier had the right axis but the wrong root-cause display line.
- Live DB fallback also showed source-currency activity rows at `2026-05-19T17:23:40Z` and `2026-05-19T17:23:48Z`; direct sandbox inspection later resolved the target ref. The UI needs to show source-currency age and stale risk, not imply the persisted snapshot is live truth.

## Research And Benchmarking

GitHub Actions separates a run-level status from job/step details and failed-step logs. The summary answers whether the run is in progress or complete and what the result was, while expanded logs provide the diagnostic detail and failed steps can be rerun. See GitHub's workflow log and check-status docs:
- https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs
- https://docs.github.com/en/pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks

Argo CD separates sync status from health status and supports a compact badge that contains both. That pattern is useful here: Build Studio should keep the top command compact, but it should not collapse different truth sources into one unlabeled number.
- https://argo-cd.readthedocs.io/en/release-2.12/getting_started/
- https://argo-cd.readthedocs.io/en/stable/user-guide/status-badge/

OpenTelemetry's log data model distinguishes event time from observed time, and its event conventions push named, attributed events instead of free-form bodies as the primary machine signal. Build Studio should mirror that by using typed `BuildDispatchAttempt`, source-currency snapshots, and progress projection fields as the status source, with chat text only as audit evidence.
- https://opentelemetry.io/docs/specs/otel/logs/data-model/
- https://opentelemetry.io/docs/specs/semconv/general/events/

### Rejected alternatives

- **Two large status cards.** Recreates the stale-chat failure in a different layer; forces operators to arbitrate between sources.
- **Delete the top command card and promote the Progress tab.** The top card holds the WWMD gate-capture buttons and is always visible; demoting it would hide the action surface behind a tab and weaken governance capture.
- **Server-render `workflowAction` with the projection pre-baked.** Increases server payload duplication, ties the action shape to the server-action contract, and prevents the client from refining the action after a client-side projection refresh. The projection is already fetched alongside the build; deriving the action client-side keeps a single round of action recomputation per refresh.
- **Make `WorkflowStageInspector` derive from the build row only.** Leaves an inconsistent third narrator inside the stage-detail panel and re-opens the exact split this design closes.

## Design

Build Studio gets one primary command/status surface: the existing `BuildStudioWorkflowActionCard`, relabeled as `Build Status`. It remains above the tabs because it contains the actionable buttons and WWMD gate capture. Its action and failure-axis copy must use the progress projection when available. The legacy build-row-only derivation remains only as an early-loading fallback.

The Progress tab becomes evidence-only. It starts with `Task progress`, showing the DB task count, source badge, conflict chips, and quiet-agent warning. It no longer repeats the operator action or failure-axis heading. Task rows, sandbox branch, dispatch history, and scoped verification remain there as supporting evidence.

`WorkflowStageInspector` is the third surface that also derives stage title and next-approval copy from workflow actions. It must consume the same projection — otherwise the "second status narrator" simply relocates from the Progress tab into the inspector. `deriveWorkflowStageGuidance` therefore accepts the same optional `progressVisibility`, threads it into `deriveBuildStudioWorkflowAction`, and `WorkflowStageInspector` is given the projection by its parent.

### Failure-axis precedence and degradation

The command/status derivation order is, in strict precedence:

1. **Projection present, `statusHeading.failureAxis` non-null** → projection wins for both `failureAxis` and `operatorAction` copy.
2. **Projection present, `statusHeading.failureAxis` null** → fall back to build-row task/verification derivation for axis; keep `statusHeading.operatorAction` if non-null.
3. **Projection absent** (initial load, fetch rejected, or backend returned null) → full build-row derivation. The card must not show a loading skeleton in place of an action; an action is always derivable from the build row.
4. **No chat self-report** may drive the primary command surface at any precedence level.

Graceful degradation is intentional: a transient projection fetch failure must not strip the operator of a recovery action. The card silently falls through to (3) and a follow-up refresh re-promotes the projection signal when it returns.

### Source-currency staleness

Source currency is still persisted from sandbox setup, but the sandbox card must display `checkedAt` age and mark stale snapshots.

**Definition of stale:** `Date.now() - checkedAt > 5 minutes` for the snapshot displayed in `BuildSandboxCard`. Rationale: dispatch attempts and sandbox writes typically complete inside that window; beyond it the persisted ref is more likely than not to have drifted from the live branch HEAD. The threshold is a single constant in `BuildSandboxCard` so it can be tuned without a spec rev. A live refresh action is out of scope for this slice; the stale badge tells the operator to open the sandbox view directly or wait for the next dispatch-driven refresh.

### Dispatch root-cause line selection

Dispatch root-cause extraction must prefer the classified failure line over CLI prologue lines. For `usage-limit`, the UI should surface the actual limit text, not `Reading prompt from stdin...`.

Matcher rules per axis must be tight enough to avoid greedy false positives:

- `test-failure`: line contains `test` AND one of `fail`, `error`, or ` × ` markers — not bare `fail`.
- `typecheck-failure`: line contains `error TS` or `typecheck` (case-insensitive) — not bare `typescript`.
- `usage-limit` / `rate-limit` / `auth` / `timeout` / `provider-unavailable`: existing substring rules are acceptable; revisit if false positives appear in the prologue corpus.
- `out-of-scope-noise`: drop the bare `workspace` substring (too generic); keep `out-of-scope`.
- Prologue suppression list (`Reading prompt from stdin`, `OpenAI Codex`, `codex `) must run first and is normative — adding a new CLI prologue prefix is a one-line change but must be code-reviewed against this section.

## Components And Data Flow

- `apps/web/lib/build/progress-visibility.ts` remains the primary server projection.
- `apps/web/components/build/build-studio-workflow-actions.ts` accepts an optional progress projection in **both** `deriveBuildStudioWorkflowAction` and `deriveWorkflowStageGuidance` (the latter forwards to the former).
- `apps/web/components/build/BuildStudio.tsx` passes `progressVisibility` into workflow action derivation and into any child that re-derives stage guidance (today: `WorkflowStageInspector`).
- `apps/web/components/build/WorkflowStageInspector.tsx` accepts `progressVisibility` and forwards it to `deriveWorkflowStageGuidance` so its title/next-approval copy matches the top card.
- `apps/web/components/build/BuildStudioWorkflowActionCard.tsx` renders the single `Build Status` command surface and source badges.
- `apps/web/components/build/BuildProgressOperationalPanel.tsx` renders evidence only.
- `apps/web/components/build/BuildSandboxCard.tsx` renders source-currency checked age and stale warning (5-minute threshold; see Design).
- `apps/web/lib/build/dispatch-attempts.ts` extracts a meaningful root cause from stdout/stderr using the tightened axis-matcher rules.

## Acceptance Criteria

- **Invariant (machine-checkable):** when `progressVisibility != null` and `statusHeading.failureAxis != null`, the action returned by `deriveBuildStudioWorkflowAction` and the action returned by `deriveWorkflowStageGuidance(...).workflowAction` both carry `failureAxis === progressVisibility.statusHeading.failureAxis`. Covered by a unit test that exercises both functions with the same fixture.
- The top command surface, the stage inspector, and the MCP/progress projection report the same `failureAxis` for a build when projection data is available.
- The Progress tab no longer contains a second operator-action heading.
- Every task count remains source-labeled.
- Source-currency snapshots show `checkedAt` age and stale state past the 5-minute threshold.
- Dispatch root-cause summary skips Codex CLI prologue lines and prefers usage/auth/timeout/provider lines under the tightened matcher rules; no axis matcher fires on a prologue line in fixture corpus.
- Graceful degradation: when `getBuildProgressVisibilityAction` rejects or returns null, the top card still renders a build-row-derived action (no skeleton, no empty state).
- Existing resume pre-click mode and post-click outcome behavior remains intact.
- No `runBuildPipeline` or `autoExecuteBuild` execution semantics change in this effort.

## Verification

- Focused Vitest:
  - `apps/web/components/build/build-studio-workflow-actions.test.ts` (includes the projection-precedence invariant covering both `deriveBuildStudioWorkflowAction` and `deriveWorkflowStageGuidance`)
  - `apps/web/components/build/BuildStudioWorkflowActionCard.test.tsx`
  - `apps/web/components/build/BuildProgressOperationalPanel.test.tsx`
  - `apps/web/components/build/BuildSandboxCard.test.tsx`
  - `apps/web/components/build/WorkflowStageInspector.test.tsx` (asserts inspector reflects projection-derived failureAxis when provided)
  - `apps/web/lib/build/dispatch-attempts.test.ts` (includes a prologue-corpus fixture asserting no axis matcher fires on prologue lines)
- Typecheck: `pnpm --filter web typecheck`
- Production build if focused tests and typecheck pass: `pnpm --filter web exec next build`
- Portal UX check on `/build` after the portal is rebuilt from this branch. A local worktree server smoke test reached authentication but could not exercise `/build` because the temporary server could not connect to the Docker Postgres service from the host.
