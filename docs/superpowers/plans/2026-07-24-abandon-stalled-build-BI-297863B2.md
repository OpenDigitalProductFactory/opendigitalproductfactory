# Governed Agent Self-Abandon for Stalled/Superseded Builds — Implementation Plan

> **For agentic workers:** REQUIRED: Use the DPF-native delivery path (`dpf-tdd`, `dpf-local-merge-ci-before-push`, and `dpf-pr-with-dco`) to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an agent driving Build Studio autonomously a governed, self-service path to abandon its OWN stalled or superseded build so it can free a WIP slot without operator intervention — closing the gap where the only abandon path was a UI Delete gated behind a native `confirm()` dialog that browser automation cannot dismiss.

**Architecture:** Add a pure eligibility-decision function (ownership + non-terminal-phase + stalled/superseded + mandatory evidence reason), reusing the same non-terminal-phase vocabulary as the existing system watchdog (`inert-build-reaper.ts`, `resume-pre-build-phase.ts`) but scoped to self-service with a much shorter staleness window. Wrap it in a transactional DB helper that flips `FeatureBuild.phase` to `abandoned` with a full audit trail (`BuildActivity` row + `abandonReason` carrying the cited evidence), then best-effort releases the sandbox git branch via the existing `abandonBuildBranch` primitive. Expose it as a new MCP tool, `abandon_stalled_build`, gated on the `build_lifecycle` grant — the same grant that gates `promote_to_build_studio`, its lifecycle sibling.

**Tech Stack:** Next.js/TypeScript, Prisma 7, Vitest, MCP tool packs (`apps/web/lib/mcp/packs/build-ops-pack.ts`).

---

### Task 1: Pure Eligibility Decision

**Files:**
- Add: `apps/web/lib/build/self-abandon-eligibility.ts`
- Add: `apps/web/lib/build/self-abandon-eligibility.test.ts`

- [x] **Step 1: Write the eligibility function**

`evaluateSelfAbandonEligibility` — no DB. Rejects (in order): missing/empty evidence reason, caller != `createdById`, epic-decomposed child (`parentEpicId` set — coordinated by the parent Epic), already-terminal phase or `abandonedAt` set, a live `TaskRun` (never abandon actively-working builds). Accepts immediately if `supersededByEpicId` is set (explicit supersession signal); otherwise requires the build's last `BuildActivity` (or `createdAt` if none) to be older than `SELF_ABANDON_MIN_STALE_MS` (default 10 minutes — short relative to the watchdog's 3h/6h/7d windows because this is agent-initiated with cited evidence, not a blind sweep).

- [x] **Step 2: Write the transactional DB wrapper**

`abandonOwnStalledBuild` — loads the build, computes live-task-run count + last-activity, calls the pure eligibility function, and on eligible re-checks under a `$transaction` row lock before flipping `phase: "abandoned"` + `abandonedAt` + `abandonReason` and writing the `BuildActivity` audit row. Best-effort calls `abandonBuildBranch(buildId)` afterward (never blocks the abandon on a sandbox hiccup).

- [x] **Step 3: Unit tests**

Cover: ownership rejection, stalled-vs-healthy rejection, live-task-run rejection, epic-child rejection, missing-reason rejection, supersession bypass, and the DB wrapper's audit-row + idempotent re-check-under-transaction behavior.

### Task 2: MCP Tool Registration

**Files:**
- Modify: `apps/web/lib/mcp/packs/build-ops-pack.ts`
- Modify: `apps/web/lib/mcp/packs/build-ops-pack.test.ts`
- Modify: `apps/web/lib/tak/agent-grants.ts` (`TOOL_TO_GRANTS` — gating source of truth)
- Modify: `apps/web/lib/mcp-tools.ts` (`DESTRUCTIVE_TOOLS` MCP annotation set)

- [x] **Step 1: Add the tool definition + handler**

`abandon_stalled_build(buildId, reason)` alongside `promote_to_build_studio` in `build-ops-pack.ts` (its lifecycle sibling), gated on the same `build_lifecycle` grant. `requiredCapability: "manage_capabilities"` (matches the other build-mutation tools in the lifecycle pack family).

- [x] **Step 2: Register the grant in the gating source of truth**

`TOOL_TO_GRANTS.abandon_stalled_build = ["build_lifecycle"]` in `agent-grants.ts`; the pack's `grants` entry must mirror it exactly (`tool-registry.test.ts` enforces this).

- [x] **Step 3: Pack registration test coverage**

Update `build-ops-pack.test.ts`'s `DEFINITION_TOOLS`/`HANDLER_TOOLS`/`EXPECTED_GRANTS` and add handler-behavior tests (not-found, ineligible, success paths).

### Task 3: Verification

- [ ] Run `pnpm --filter web exec vitest run apps/web/lib/build/self-abandon-eligibility.test.ts apps/web/lib/mcp/packs/build-ops-pack.test.ts apps/web/lib/mcp/tool-registry.test.ts apps/web/lib/tak/agent-grants.test.ts`
- [ ] Run `pnpm --filter web exec tsc --noEmit` (or the module-scoped equivalent) to confirm no type regressions.
