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

Rejected pattern: showing two large cards that both answer "what should I do now?" This recreates the stale-chat failure in a different layer.

## Design

Build Studio gets one primary command/status surface: the existing `BuildStudioWorkflowActionCard`, relabeled as `Build Status`. It remains above the tabs because it contains the actionable buttons and WWMD gate capture. Its action and failure-axis copy must use the progress projection when available. The legacy build-row-only derivation remains only as an early-loading fallback.

The Progress tab becomes evidence-only. It starts with `Task progress`, showing the DB task count, source badge, conflict chips, and quiet-agent warning. It no longer repeats the operator action or failure-axis heading. Task rows, sandbox branch, dispatch history, and scoped verification remain there as supporting evidence.

The command/status derivation order is:

1. Progress projection `statusHeading.failureAxis` and `statusHeading.operatorAction`, sourced from dispatch history and scoped verification.
2. Build-row task/verification derivation only when no projection exists yet.
3. No chat self-report may drive the primary command surface.

Source currency is still persisted from sandbox setup, but the sandbox card must display `checkedAt` age and mark stale snapshots. That makes it visible when the projection is old enough that the operator should refresh or inspect the sandbox before trusting it.

Dispatch root-cause extraction must prefer the classified failure line over CLI prologue lines. For `usage-limit`, the UI should surface the actual limit text, not `Reading prompt from stdin...`.

## Components And Data Flow

- `apps/web/lib/build/progress-visibility.ts` remains the primary server projection.
- `apps/web/components/build/build-studio-workflow-actions.ts` accepts an optional progress projection and uses it to override action title and failure axis for recovery actions.
- `apps/web/components/build/BuildStudio.tsx` passes `progressVisibility` into workflow action derivation.
- `apps/web/components/build/BuildStudioWorkflowActionCard.tsx` renders the single `Build Status` command surface and source badges.
- `apps/web/components/build/BuildProgressOperationalPanel.tsx` renders evidence only.
- `apps/web/components/build/BuildSandboxCard.tsx` renders source-currency checked age and stale warning.
- `apps/web/lib/build/dispatch-attempts.ts` extracts a meaningful root cause from stdout/stderr.

## Acceptance Criteria

- The top command surface and MCP/progress projection report the same `failureAxis` for a build when projection data is available.
- The Progress tab no longer contains a second operator-action heading.
- Every task count remains source-labeled.
- Source-currency snapshots show `checkedAt` age and stale state.
- Dispatch root-cause summary skips Codex CLI prologue lines and prefers usage/auth/timeout/provider lines.
- Existing resume pre-click mode and post-click outcome behavior remains intact.
- No `runBuildPipeline` or `autoExecuteBuild` execution semantics change in this effort.

## Verification

- Focused Vitest:
  - `apps/web/components/build/build-studio-workflow-actions.test.ts`
  - `apps/web/components/build/BuildStudioWorkflowActionCard.test.tsx`
  - `apps/web/components/build/BuildProgressOperationalPanel.test.tsx`
  - `apps/web/components/build/BuildSandboxCard.test.tsx`
  - `apps/web/lib/build/dispatch-attempts.test.ts`
- Typecheck: `pnpm --filter web typecheck`
- Production build if focused tests and typecheck pass: `pnpm --filter web exec next build`
- Portal UX check on `/build` after the portal is rebuilt from this branch. A local worktree server smoke test reached authentication but could not exercise `/build` because the temporary server could not connect to the Docker Postgres service from the host.
