# Unified AI Coworkers implementation plan

**Backlog item:** `BI-4BF1FF9C`
**Companion bug:** `BI-7BEDF08A`
**Activity attribution:** `BI-3EC91596`
**Workroom route slice:** `BI-496CD36E`
**Operations Map history:** `BI-75D5ABCD`
**Decision:** `DI-C775CA53632E` — one canonical coworker home, high confidence
**Scope decision:** `DI-01D9535C3E84` — operator-journey core, high confidence
**Workroom:** `WC-A0588D8C`
**Branch:** `fix/unified-ai-coworkers`

## Outcome

Deliver one revertible operator-journey PR that makes `/workforce` the canonical AI Coworkers experience and reconciles the activity the operator can actually observe: roster coworkers, specialist TaskRuns, external CLI/Build Studio Workrooms, and local-model usage. A skipped self-upgrade keeps its exact blocker after the task finishes, every Workroom inventory link resolves, and the Operations Map can move through explicit historical windows. The directory remains the front door; activity and advanced management are disclosed in place. The old Right Now URL becomes a compatibility entry into that same experience, and the primary rail no longer offers a competing AI Workforce home.

## Backlog coverage

- Decision: decomposed
- Receipt: pending
- D1 → `BI-4BF1FF9C`: unified navigation and a single identity/activity experience with separate roster and governed-executor lanes.
- D2 → `BI-7BEDF08A`: retained, named self-upgrade blocker evidence and exact deep link. Depends on D1.
- D3 → `BI-3EC91596`: canonical TokenUsage reconciliation into roster, external/specialist, and unattributed buckets. Depends on D1.
- D4 → route-only slice of `BI-496CD36E`: raw `WC-*` inventory links resolve to the existing Workroom detail projection. Independent of the deferred field/table rename.
- D5 → `BI-75D5ABCD`: Operations Map presets, exact window label, backward/forward traversal, reset-to-live, and URL-backed state. Independent of D1.
- Dependency disposition: all five deliverables are independently testable; they ship together because the operator explicitly requested the complete monitoring journey and each consumes the same existing Workroom/TaskRun/TokenUsage evidence plane. No deliverable introduces a parallel event store, identity, or route implementation.

## Review execution evidence

- 2026-08-31: upgraded-runtime research review `TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-B892BB47FD0C` read the immutable design artifact successfully but did not reach `record_initiative_evidence`. The pinned Anthropic provider was rate-limited and the governed local fallback hit its 120-second inference-admission timeout. No receipt was claimed; one fresh-packet retry remains within the bounded delivery directive.
- 2026-08-31: fresh-packet retry `TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-64C764A841AC` repeated the provider failure class and remained in fallback admission with zero tool executions beyond the reviewer budget. Per the bounded autonomous directive, no third dispatch or review-gate bypass is permitted; implementation remains blocked until the assigned reviewer provider can execute the governed writer.

## Existing substrate

- Navigation: `apps/web/lib/navigation/portal-navigation-model.ts` is the single route/rail registry.
- Coworker identity: `loadRoster`, `RosterView`, and `/workforce/[agentId]` remain canonical.
- Activity: `loadWorkforceActivity`, `WorkforceNowShell`, TaskRun, ToolExecution, and TokenUsage remain the read model and ledgers.
- External execution: Workroom and WorkroomActivity remain the coordination envelope and activity journal for Codex, Claude, Grok, Build Studio, and native execution.
- Usage: TokenUsage remains the canonical model-call ledger. Attribution is deterministic from Agent identity and existing trace/context linkage; missing linkage is shown as unattributed rather than guessed.
- Historical navigation: `OperationsTopologyControls` and `OperationsMapLiveShell` remain the sole replay/window controls and bounded-refetch path.
- Upgrade safety: `captureActiveSessionBlockers` remains the authoritative blocker detector; `SelfUpgradeRun.completionEvidence` is the existing extensible evidence envelope.
- Compatibility: `/platform/ai/right-now` may redirect but must not become a second implementation.

## Implementation

### D1. Define parity, retention, and attribution with failing tests

- Extend `apps/web/lib/platform-runtime/workforce-activity.test.ts` with a red regression proving an active `specialist` TaskRun appears in current activity even though it is not part of the coworker quiet roster.
- Add a red regression proving recently terminal TaskRuns are returned with task-run ID, actor identity, title, status, and timestamps.
- Add a red regression proving live/recent Workrooms from external executors remain visible even when no roster coworker owns them.
- Add red regressions that all TokenUsage is reconciled into roster, external/specialist, or unattributed buckets and that totals remain lossless.
- Extend navigation/page tests to prove the shell exposes one AI-coworker destination and the compatibility route targets `/workforce?view=activity`.
- Extend `run-store.test.ts`, self-upgrade function tests, and `SelfUpgradeClient.test.tsx` to prove early-skip blocker evidence is persisted, named, rendered, and deep-linked.

### D1/D3. Unify the activity read model

- Query active and recent TaskRuns from the same governed status vocabulary used by quiescence.
- Load all non-archived agent identities needed to label those runs, while keeping `Agent.type=coworker` as the directory/quiet-roster boundary.
- Add a bounded recent-activity projection; do not create a new table or copy task content.
- Load live/recent Workrooms and their existing objective, executor kind, lifecycle state, timestamps, and canonical detail URL as a distinct governed-executor lane.
- Classify TokenUsage by loaded Agent type; attach Workroom context only where an existing TaskRun/trace association proves it, and aggregate the remainder under an explicit unattributed label.
- Preserve sensitive-data aggregation and existing capability gates.

### D1. Make `/workforce` the canonical experience

- Add a compact page-local view switch for **Coworkers** and **Activity**, backed by query state so operational deep links are stable.
- Render the existing roster in Coworkers and the existing live shell, enhanced with recent activity, in Activity.
- In Activity, clearly separate **Coworkers** from **External & platform work** so a Codex or Build Studio executor is visible without being mislabeled as a coworker.
- Replace the single partial token KPI with a reconciliation showing total local/provider activity and roster/external/unattributed composition, including freshness and provenance language.
- Add contextual links to Workrooms and Operations Map; these are drill-downs, not competing roster homes.
- Add one clearly secondary **Advanced AI operations** disclosure linking to provider/routing, skills, governance, scheduling, and build-runtime controls.
- Remove the competing `ai_workforce` shell destination; keep compatibility routes and section-scoped navigation guarantees intact.
- Redirect `/platform/ai/right-now` to the canonical activity view while retaining query parameters used to focus a task run.

### D2. Persist and render upgrade blocker identity

- Extend `skipRun` to merge optional evidence without overwriting existing completion evidence.
- On an `activity-in-flight` early skip, persist a minimal sanitized blocker record derived from the exact captured hard blockers: surface, TaskRun ID, agent ID, task title, status, and capture/signal timestamps.
- Parse that evidence through a small shared helper and render it in both the latest-run explanation and run-history reason row.
- Deep-link the exact TaskRun into `/workforce?view=activity&taskRun=<id>`; the recent list supplies a stable row anchor and visible focus state.

### D4. Make every Workroom inventory link resolvable

- Add a red loader regression for a raw `WC-*` semantic key from the inventory.
- Resolve raw Workroom identity to its anchored WorkItem and then call the same case/detail composition used by encoded `sourceType:sourceId` routes.
- Keep legacy encoded case keys working; do not rename `capsuleId`, routes, fields, grants, or physical tables in this slice.
- Verify a live and a historical Workroom open the matching detail and activity journal.

### D5. Make Operations Map history navigable

- Extract pure replay-window state helpers and cover preset selection, full-window backward/forward movement, bounds, reset-to-live, and URL parse/serialize with failing tests.
- Add accessible presets plus Back, Forward, and Live controls around the existing replay scrubber; display exact localized start/end and whether the view is live or historical.
- Keep the selected window in `from`/`to` query parameters and update it without dropping other Operations Map filters.
- Feed the selected bounded window through `OperationsMapLiveShell`; historical views refetch as-is and auto-refresh never snaps them to newest data.

### D1–D5. Verify the operator journey

- Run affected Vitest suites after the red→green cycle, then the affected lint/type checks and `pnpm --filter web build` as required by the gate.
- Obtain the governed shared nonproduction lease; verify dark and light themes at desktop and narrow width.
- Exercise: AI Coworkers rail → directory → Activity → external Workroom → working detail → model-usage reconciliation → Operations Map last-day preset → one window back → refresh/deep link; then a retained skipped-run blocker link → exact recent task.
- Record the UX-fit manifest at `docs/ux-fit/2026-08-28-unified-ai-coworkers.ux-fit.json` with screenshots/evidence and a documentation-impact decision.

## Acceptance evidence

- Tests prove actor parity, Workroom visibility/detail resolution, lossless usage attribution, recent retention, one primary destination, compatibility routing, evidence persistence, exact deep linking, and deterministic time-window navigation.
- Production build passes with zero TypeScript errors.
- Live UX verification proves the task can be identified after it is no longer active and that identity/operations no longer require separate main-menu discovery.
- No schema migration is required; completion evidence and existing ledgers are reused.

## Documentation impact

Update this plan and the amended portfolio-shaped IA design in the same PR. Update the AI operations user documentation for the unified activity lanes and historical-window controls. No install procedure or schema migration is expected because the implementation composes existing Workroom, TaskRun, WorkroomActivity, and TokenUsage records.
