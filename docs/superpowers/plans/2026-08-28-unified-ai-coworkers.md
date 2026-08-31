# Unified AI Coworkers implementation plan

**Backlog item:** `BI-4BF1FF9C`
**Companion bug:** `BI-7BEDF08A`
**Decision:** `DI-C775CA53632E` — one canonical coworker home, high confidence
**Workroom:** `WC-A0588D8C`
**Branch:** `fix/unified-ai-coworkers`

## Outcome

Deliver one revertible PR that makes `/workforce` the canonical AI Coworkers experience and makes a skipped self-upgrade explain its exact blocker after the task finishes. The directory remains the front door; current/recent activity and advanced management links are disclosed in place. The old Right Now URL becomes a compatibility entry into that same experience, and the primary rail no longer offers a competing AI Workforce home.

## Backlog coverage

- Decision: decomposed
- Receipt: pending
- Deliverable 1 → `BI-4BF1FF9C`: unified navigation and coworker identity/activity experience.
- Deliverable 2 → `BI-7BEDF08A`: retained, named self-upgrade blocker evidence and exact deep link.
- Dependency disposition: the two deliverables are independently testable but intentionally ship in one operator-journey PR at the operator's explicit direction. Deliverable 2 consumes the canonical activity destination created by deliverable 1; neither introduces a parallel route or ledger.

## Review execution evidence

- 2026-08-31: upgraded-runtime research review `TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-B892BB47FD0C` read the immutable design artifact successfully but did not reach `record_initiative_evidence`. The pinned Anthropic provider was rate-limited and the governed local fallback hit its 120-second inference-admission timeout. No receipt was claimed; one fresh-packet retry remains within the bounded delivery directive.

## Existing substrate

- Navigation: `apps/web/lib/navigation/portal-navigation-model.ts` is the single route/rail registry.
- Coworker identity: `loadRoster`, `RosterView`, and `/workforce/[agentId]` remain canonical.
- Activity: `loadWorkforceActivity`, `WorkforceNowShell`, TaskRun, ToolExecution, and TokenUsage remain the read model and ledgers.
- Upgrade safety: `captureActiveSessionBlockers` remains the authoritative blocker detector; `SelfUpgradeRun.completionEvidence` is the existing extensible evidence envelope.
- Compatibility: `/platform/ai/right-now` may redirect but must not become a second implementation.

## Implementation

### 1. Define parity and retention with failing tests

- Extend `apps/web/lib/platform-runtime/workforce-activity.test.ts` with a red regression proving an active `specialist` TaskRun appears in current activity even though it is not part of the coworker quiet roster.
- Add a red regression proving recently terminal TaskRuns are returned with task-run ID, actor identity, title, status, and timestamps.
- Extend navigation/page tests to prove the shell exposes one AI-coworker destination and the compatibility route targets `/workforce?view=activity`.
- Extend `run-store.test.ts`, self-upgrade function tests, and `SelfUpgradeClient.test.tsx` to prove early-skip blocker evidence is persisted, named, rendered, and deep-linked.

### 2. Unify the activity read model

- Query active and recent TaskRuns from the same governed status vocabulary used by quiescence.
- Load all non-archived agent identities needed to label those runs, while keeping `Agent.type=coworker` as the directory/quiet-roster boundary.
- Add a bounded recent-activity projection; do not create a new table or copy task content.
- Preserve sensitive-data aggregation and existing capability gates.

### 3. Make `/workforce` the canonical experience

- Add a compact page-local view switch for **Coworkers** and **Activity**, backed by query state so operational deep links are stable.
- Render the existing roster in Coworkers and the existing live shell, enhanced with recent activity, in Activity.
- Add one clearly secondary **Advanced AI operations** disclosure linking to provider/routing, skills, governance, scheduling, and build-runtime controls.
- Remove the competing `ai_workforce` shell destination; keep compatibility routes and section-scoped navigation guarantees intact.
- Redirect `/platform/ai/right-now` to the canonical activity view while retaining query parameters used to focus a task run.

### 4. Persist and render upgrade blocker identity

- Extend `skipRun` to merge optional evidence without overwriting existing completion evidence.
- On an `activity-in-flight` early skip, persist a minimal sanitized blocker record derived from the exact captured hard blockers: surface, TaskRun ID, agent ID, task title, status, and capture/signal timestamps.
- Parse that evidence through a small shared helper and render it in both the latest-run explanation and run-history reason row.
- Deep-link the exact TaskRun into `/workforce?view=activity&taskRun=<id>`; the recent list supplies a stable row anchor and visible focus state.

### 5. Verify the operator journey

- Run affected Vitest suites after the red→green cycle, then the affected lint/type checks and `pnpm --filter web build` as required by the gate.
- Obtain the governed shared nonproduction lease; verify dark and light themes at desktop and narrow width.
- Exercise: Workforce rail → directory → Activity → coworker identity → Advanced operations; then a retained skipped-run blocker link → exact recent task.
- Record the UX-fit manifest at `docs/ux-fit/2026-08-28-unified-ai-coworkers.ux-fit.json` with screenshots/evidence and a documentation-impact decision.

## Acceptance evidence

- Tests prove actor parity, recent retention, one primary destination, compatibility routing, evidence persistence, and exact deep linking.
- Production build passes with zero TypeScript errors.
- Live UX verification proves the task can be identified after it is no longer active and that identity/operations no longer require separate main-menu discovery.
- No schema migration is required; completion evidence and existing ledgers are reused.

## Documentation impact

Update this plan and the amended portfolio-shaped IA design in the same PR. No install/operator runbook changes are expected because no setup, environment, schema, or upgrade procedure changes; the visible navigation and self-upgrade explanation are covered by the product design and UX-fit receipt.
