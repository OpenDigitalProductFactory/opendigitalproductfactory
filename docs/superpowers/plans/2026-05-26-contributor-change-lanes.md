# Contributor Change Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a governed Contributor Change Lane control plane so external agents and contributors can see, claim, verify, and hand off branches only through registered runtime lanes, with orphan branch/worktree visibility and no ad hoc verification servers.

**Architecture:** Build a projection over existing `WorkCapsule`, `RuntimeTarget`, `RuntimeVerification`, `NonProductionEnvironmentLease`, local git worktree inventory, remote branch inventory, and GitHub PR state. Do not add a new lane source-of-truth table in the first implementation. The first slice is read-only; write actions arrive only after the projection proves accurate.

**Tech Stack:** Next.js app router, React server components, Prisma 7, Vitest, PowerShell janitor helpers, GitHub CLI for local inventory fallback, existing DPF MCP/runtime coordination modules.

---

## Phase 0: Branch And Substrate Guard

- [ ] Confirm work is on an isolated branch/worktree, not `main`.

  ```powershell
  git status --short --branch
  git branch --show-current
  ```

- [ ] Re-read the governing docs before implementation:
  - `AGENTS.md`
  - `docs/superpowers/specs/2026-05-26-contributor-change-lanes-design.md`
  - `docs/operations/dpf-production-runtime.md`
  - `docs/operations/runtime-glossary.md`
  - `docs/superpowers/specs/2026-05-14-portal-work-capsule-control-harness-design.md`
  - `docs/superpowers/specs/2026-05-16-worktree-hygiene-design.md`
  - `docs/superpowers/specs/2026-05-26-build-studio-decision-skill-packs-design.md`

- [ ] Query the live substrate through DPF MCP when available:
  - `list_work_capsules`
  - `get_runtime_coordination_map`
  - `list_nonprod_environment_leases`
  - `list_epics`
  - `list_backlog_items`

- [ ] If MCP is unavailable, state DB fallback explicitly before using read-only DB queries.

- [ ] Verify current remote branch and PR state:

  ```powershell
  git fetch origin
  gh pr list --state open --limit 100 --json number,title,headRefName,baseRefName,isDraft,mergeStateStatus,url,statusCheckRollup
  ```

## Phase 1: Read-Only Lane Projection

Purpose: make the current operational truth visible without mutating runtimes or cleanup state.

- [ ] Create `apps/web/lib/contributor-change-lanes/types.ts`.

  Export these core types:

  ```ts
  export type ContributorLaneKind =
    | "root-portal"
    | "dev-portal"
    | "build-sandbox"
    | "local-integration"
    | "external-debug";

  export type ContributorLaneStatus =
    | "available"
    | "claimed"
    | "starting"
    | "running"
    | "verifying"
    | "blocked"
    | "ready-for-review"
    | "released"
    | "stale";

  export type ContributorChangeLane = {
    id: string;
    laneKind: ContributorLaneKind;
    source: "work-capsule" | "runtime-target" | "nonprod-lease" | "git-branch" | "worktree";
    status: ContributorLaneStatus;
    owner: string | null;
    branch: string | null;
    worktreePath: string | null;
    commitSha: string | null;
    servedCommitSha: string | null;
    pullRequestUrl: string | null;
    runtimeTargetId: string | null;
    runtimeUrl: string | null;
    workCapsuleId: string | null;
    backlogItemId: string | null;
    expiresAt: Date | null;
    lastHeartbeatAt: Date | null;
    latestVerification: {
      status: "pending" | "passed" | "failed" | "blocked";
      checkedAt: Date | null;
      summary: string | null;
    };
    blockers: string[];
    nextAction: string;
  };
  ```

- [ ] Create `apps/web/lib/contributor-change-lanes/lane-projection.ts`.

  Requirements:
  - Pure projection function; no Prisma calls.
  - Accept arrays of existing substrate records and inventory snapshots.
  - Join by runtime target id, work capsule id, branch name, and worktree path.
  - Return stable, sorted rows: blocked first, active/running next, WIP next, orphans next, released/stale last.
  - Mark a stopped registered target as `available`, not as an orphan.
  - Mark a claimed stopped lane as `starting` when a lease exists but no healthy runtime heartbeat exists.
  - Mark a lane `blocked` when the latest health/runtime verification failed or startup timed out.
  - Mark branch rows with no PR and no active WIP TTL as orphaned handoff rows.

- [ ] Add `apps/web/lib/contributor-change-lanes/lane-projection.test.ts`.

  Test cases:
  - Work Capsule plus Runtime Target plus PR becomes one joined lane row.
  - Branch with open PR but no Work Capsule is flagged with missing capsule blocker.
  - Branch with no PR and no active WIP TTL is flagged as orphaned.
  - Worktree with no branch/capsule linkage is flagged as orphaned.
  - Stopped registered `dev-portal` without lease is `available`.
  - Claimed stopped `dev-portal` with active lease is `starting`.
  - Failed startup verification makes the lane `blocked`.
  - Runtime served SHA mismatch adds a blocker.

- [ ] Run focused tests:

  ```powershell
  pnpm --filter web exec vitest run lib/contributor-change-lanes/lane-projection.test.ts
  ```

## Phase 2: Inventory Readers

Purpose: collect git, worktree, and PR facts for the read-only projection without introducing write actions.

- [ ] Audit existing helpers before creating new ones:

  ```powershell
  rg "worktree" apps/web/lib scripts -g "*.ts" -g "*.tsx" -g "*.ps1" -g "*.psm1"
  rg "gh pr" apps/web/lib scripts docs -g "*.ts" -g "*.ps1" -g "*.md"
  ```

- [ ] Reuse existing Work Capsule or janitor parsing helpers when possible.

- [ ] Create `apps/web/lib/contributor-change-lanes/git-inventory.ts` only for missing read-only logic.

  Requirements:
  - Parse `git worktree list --porcelain`.
  - Parse remote branches from `git for-each-ref refs/remotes/origin`.
  - Accept command output as injected strings in pure parser tests.
  - Do not shell out from unit tests.
  - Normalize branch names by removing `origin/`.

- [ ] Create `apps/web/lib/contributor-change-lanes/github-inventory.ts` if no existing PR inventory helper can be reused.

  Requirements:
  - Keep the command execution boundary isolated.
  - Parse `gh pr list --json ...` into a small internal shape.
  - Return source errors as data so the dashboard can show stale inventory instead of failing the whole page.

- [ ] Add parser tests:

  ```powershell
  pnpm --filter web exec vitest run lib/contributor-change-lanes/
  ```

## Phase 3: Server-Side Read Model

Purpose: expose one server-side function that the route can call.

- [ ] Create `apps/web/lib/contributor-change-lanes/read-model.ts`.

  Requirements:
  - Query Prisma for Work Capsules, Runtime Targets, Runtime Verifications, and Non-production Leases.
  - Call inventory readers for local worktrees, remote branches, and GitHub PRs.
  - Feed all data into the pure projection.
  - Return lanes plus source freshness metadata.
  - Use dependency injection for command runners so tests can pass fake command output.

- [ ] Add tests using fake DB/command harnesses, following the style in existing build and decomposition tests.

- [ ] Do not add write actions in this phase.

## Phase 4: Dashboard UI

Purpose: give operators a single place to see current contributor delivery state.

- [ ] Add route `apps/web/app/(shell)/platform/development/change-lanes/page.tsx`.

- [ ] Add components under `apps/web/components/platform/development/change-lanes/`:
  - `ChangeLanesDashboard.tsx`
  - `ChangeLaneTable.tsx`
  - `ChangeLaneStatusBadge.tsx`
  - `ChangeLaneSourceSummary.tsx`
  - `ChangeLaneBlockers.tsx`

- [ ] UI requirements:
  - Use dense operational table layout.
  - Use tabs or segmented controls for Active lanes, Branches needing handoff, Orphan worktrees, Stale leases, and Cleanup candidates.
  - Use theme variables only; no hardcoded hex colors and no Tailwind gray/white/black shortcuts except allowed white text on accent buttons.
  - Keep all rows readable on laptop width.
  - Show source freshness and command failures clearly.
  - Link PR URLs and runtime URLs.
  - Do not render claim/release buttons yet; show disabled/read-only action placeholders only if needed to clarify next actions.

- [ ] Add React tests with jsdom if component behavior becomes non-trivial.

- [ ] Run focused tests:

  ```powershell
  pnpm --filter web exec vitest run lib/contributor-change-lanes/ components/platform/development/change-lanes/
  ```

## Phase 5: Async Startup Contract

Purpose: implement the approved `starting` behavior for registered stopped lanes without permitting rogue servers.

- [ ] Create `apps/web/lib/contributor-change-lanes/runtime-startup.ts`.

  Requirements:
  - Accept a registered runtime target and active lease.
  - Start only through approved runtime broker operations.
  - Poll the target health endpoint.
  - Record `RuntimeVerification` for startup health checks.
  - Promote to `running` only after health passes.
  - Mark `blocked` on timeout or broker failure.
  - Never start arbitrary `next dev`, `next start`, tunnels, or random ports.

- [ ] Add tests for:
  - already healthy target stays running.
  - stopped target enters `starting`.
  - healthy poll promotes to `running`.
  - timeout records blocked verification.
  - broker failure records blocked verification.

- [ ] Set default startup timeout to five minutes unless an existing runtime target policy provides a more specific value.

## Phase 6: MCP Tools And Grants

Purpose: allow agents to participate through governed tools after read-only visibility is validated.

- [ ] Add or wrap MCP tools:
  - `list_runtime_lanes`
  - `claim_runtime_lane`
  - `deploy_branch_to_runtime_lane`
  - `release_runtime_lane`
  - `list_orphaned_branches`
  - `list_orphaned_worktrees`
  - `record_branch_handoff`

- [ ] Reuse existing `record_runtime_verification` behavior where possible.

- [ ] Update `apps/web/lib/tak/agent-grants.ts` `TOOL_TO_GRANTS` for every new tool.

- [ ] Add MCP tests:

  ```powershell
  pnpm --filter web exec vitest run lib/mcp-tools*contributor* lib/contributor-change-lanes/
  ```

- [ ] Verify insufficient-scope responses use the existing MCP error shape and do not encourage direct DB fallback.

## Phase 7: Agent Rules And Skill Pack Updates

Purpose: teach Claude/Codex contributors the lane discipline in the same place they learn DPF workflow.

- [ ] Update the DPF skill pack rather than writing tool-specific one-off docs when possible.

  Candidate files:
  - `packages/dpf-skill-pack/skills/dpf-use-shared-nonprod-environment/SKILL.md`
  - a new `packages/dpf-skill-pack/skills/dpf-contributor-change-lane/SKILL.md` if one shared skill is clearer.

- [ ] Add AGENTS.md pointer text only if there is not already a single-source-of-truth pointer.

- [ ] Agent-facing rule text must include:
  - no ad hoc runtime
  - claim a lane or stop
  - do not say "ready to test" unless served SHA matches branch SHA
  - do not say "done" for branch-only work unless it is WIP with TTL and next action
  - do not open PRs before ready-for-review verification

## Phase 8: Janitor Reporting And Safe Cleanup

Purpose: convert read-only orphan visibility into guarded cleanup once the report is trusted.

- [ ] Extend the worktree janitor report to classify:
  - remote branches with no open PR and no WIP TTL
  - local worktrees with no active Work Capsule
  - stale runtime lane leases
  - merged branches safe to delete
  - unmerged inactive branches needing operator decision

- [ ] Keep first cleanup action manual and explicit.

- [ ] Validate resolved absolute paths before deleting or moving any worktree directory.

- [ ] Never run recursive delete against a computed path that has not been checked.

## Phase 9: Full Verification

- [ ] Run focused unit tests:

  ```powershell
  pnpm --filter web exec vitest run lib/contributor-change-lanes/ components/platform/development/change-lanes/
  ```

- [ ] Run affected typecheck:

  ```powershell
  pnpm --filter web typecheck
  ```

- [ ] Run production build when code/UI changes are present:

  ```powershell
  pnpm --filter web build
  ```

- [ ] Verify the dashboard against a registered DPF runtime lane only.

  Do not start ad hoc `next dev`, `next start`, tunnels, hidden PowerShell servers, or arbitrary ports for verification.

- [ ] Browser verification requirements:
  - Route loads at `/platform/development/change-lanes`.
  - Active root portal lane appears.
  - Stopped dev portal lane appears as available or starting, not as verified.
  - Branches without PR or WIP TTL appear as orphaned.
  - Worktrees without active capsule appear as orphaned.
  - Source failure states render instead of crashing the page.

- [ ] Before any ready-for-review handoff:
  - `git fetch origin`
  - merge-check or rebase against current `origin/main`
  - rerun focused tests/typecheck/build after the merge check
  - confirm runtime lane served commit matches branch head
  - record browser verification
  - create PR only after the gate passes

## First Implementation Slice Recommendation

Implement Phases 1 through 4 first: the read-only lane projection, inventory readers, read model, and dashboard. This is the smallest useful slice because it gives the operator immediate visibility into orphan branches, orphan worktrees, stale lanes, and runtime mismatch without risking a broken runtime mutation path.

After the dashboard is reviewed against live data, implement Phases 5 and 6 for lane claim, release, deployment, and async startup.
