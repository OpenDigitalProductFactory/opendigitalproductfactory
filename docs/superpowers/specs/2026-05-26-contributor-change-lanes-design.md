---
title: Contributor Change Lanes - governed external agent delivery workflow
status: draft-for-operator-review
author: Codex
date: 2026-05-26
related:
  - AGENTS.md
  - docs/operations/dpf-production-runtime.md
  - docs/operations/runtime-glossary.md
  - docs/superpowers/specs/2026-05-14-portal-work-capsule-control-harness-design.md
  - docs/superpowers/specs/2026-05-16-worktree-hygiene-design.md
  - docs/superpowers/plans/2026-05-18-dpf-runtime-coordination-workflow.md
  - docs/superpowers/specs/2026-05-24-portal-topology-consolidation-design.md
  - docs/superpowers/specs/2026-05-26-build-studio-decision-skill-packs-design.md
epics:
  - EP-BUILD-STUDIO
  - EP-CAPSULE
  - EP-WORKTREE-HYGIENE
  - EP-REDUCTION-GEAR-ARCH
---

# Contributor Change Lanes Design

## Purpose

Contributor Change Lanes make external contributors and AI agents obey the same delivery discipline that Build Studio is moving toward: source isolation is separate from runtime ownership, runtime verification happens only on registered lanes, and "ready for review" is backed by merge, test, deployment, browser, and PR evidence.

The control-plane target is practical, not decorative:

- Branches should not be orphaned after a session ends.
- Worktrees should not be forgotten.
- Contributors should not start hidden `next dev`, `next start`, tunnels, or arbitrary ports for feature verification.
- Users should know exactly where a branch is deployed, which commit is being served, and whether the visible runtime matches the handoff claim.
- PRs should represent work that the author believes is ready to merge, not an early parking lot.

## Problem Statement

Recent contributor sessions exposed the same failure in several forms:

1. A branch was created and pushed without a PR or active WIP record.
2. A worktree was created and then became operationally invisible.
3. Agents stood up ad hoc local servers instead of using existing portal, dev, sandbox, or non-production runtime lanes.
4. Users could not verify the work because there was no known deployed portal instance serving the branch.
5. Branches were not consistently rebased or merge-checked against concurrent work before handoff.
6. Build Studio uses managed internal dev and sandbox runtimes, but Claude and Codex contributors were bypassing that runtime discipline.
7. PR and "done" language arrived before final merge, test, runtime, and browser verification.

The missing product concept is a governed lane that connects branch, worktree, owner, runtime, commit, PR, verification evidence, and TTL.

## Existing Substrate Findings

The repo already contains most of the substrate. The design should project over it instead of introducing a parallel source of truth.

### Work Capsules

`WorkCapsule` already represents active work ownership and can link backlog, Build Studio, executor, branch, worktree, runtime, PR, evidence, and TTL-style state. Relevant implementation:

- `apps/web/lib/work-capsules.ts`
- `apps/web/lib/work-capsules/work-capsule-store.ts`
- `apps/web/lib/work-capsules/mcp-handlers.ts`
- `apps/web/lib/actions/work-capsules.ts`
- `apps/web/app/(shell)/build/work/page.tsx`

Gap: current live capsules are Build Studio-oriented. External desktop or CLI contributors are not consistently attaching their branch, worktree, PR, runtime, and next action to the capsule record.

### Runtime Coordination

`RuntimeTarget` and `RuntimeVerification` already model managed runtimes and verification evidence:

- `packages/db/prisma/schema.prisma`
- `apps/web/lib/runtime-coordination/types.ts`
- `apps/web/lib/runtime-coordination/runtime-targets.ts`
- `apps/web/lib/runtime-coordination/mcp-handlers.ts`
- `apps/web/lib/runtime-coordination/runtime-targets.test.ts`
- `apps/web/lib/mcp-tools-runtime-coordination.test.ts`

Gap: runtime coordination exists, but contributor handoff does not yet require a claimed lane, matching commit SHA, health evidence, or browser evidence before "ready for review".

### Non-production Environment Leases

`NonProductionEnvironmentLease` exists and is exposed through MCP lease tools for shared non-production resources:

- `apps/web/lib/nonprod/environment-lease.ts`
- `apps/web/lib/nonprod/local-integration.ts`
- `apps/web/lib/mcp-tools.ts`
- `apps/web/lib/mcp-tools-nonprod-environments.test.ts`
- `packages/db/prisma/migrations/20260526094500_nonprod_environment_leases/migration.sql`

Gap: leases are not yet displayed as one coherent contributor lane view with branch, worktree, commit, runtime, PR, and verification status.

### Worktree Hygiene

The repo has a worktree hygiene design and library:

- `docs/superpowers/specs/2026-05-16-worktree-hygiene-design.md`
- `docs/superpowers/plans/2026-05-16-worktree-hygiene-plan.md`
- `scripts/worktree-janitor-lib.psm1`
- `scripts/worktree-janitor-lib.Tests.ps1`

Gap: the janitor is not yet surfaced as a contributor control-plane dashboard, and it does not currently cross-check active capsules, branches, PRs, and runtime lanes.

### Runtime Operations Documentation

Runtime doctrine already separates production/root, dev, sandbox, and local integration concerns:

- `docs/operations/dpf-production-runtime.md`
- `docs/operations/runtime-glossary.md`
- `docs/operations/runtime-kernel-commandments.md`
- `docs/superpowers/specs/2026-05-24-portal-topology-consolidation-design.md`

Gap: the doctrine is not yet enforced in agent-facing handoff tools. Agents can still bypass it with ad hoc runtime creation.

## Live State Snapshot

Snapshot taken on 2026-05-26 from the local install and live DPF MCP tools. This is evidence for the design, not a stable invariant.

- Runtime targets returned by `get_runtime_coordination_map`:
  - `RT-ROOT-PORTAL`: `root-portal`, `running`, `http://localhost:3000`, final acceptance allowed.
  - `RT-DEV-PORTAL`: `dev-portal`, `planned`, `http://localhost:3001`, final acceptance not allowed.
  - `RT-BUILD-SANDBOX-FB-9E4FA6DE`: `build-sandbox`, `running`, `http://localhost:3035`, branch `build/FB-9E4FA6DE`.
  - `RT-BUILD-SANDBOX-FB-486B7710`: `build-sandbox`, `running`, `http://localhost:3035`, stale heartbeat from 2026-05-24.
- Docker state:
  - Root portal container was healthy on `:3000`.
  - Sandbox container was listening on `:3035`.
  - Dev portal service was not running on `:3001`.
- Health checks:
  - `http://localhost:3000/api/health` responded successfully.
  - `http://localhost:3001/api/health` refused connection.
  - `http://localhost:3035/api/health` timed out.
- Non-production leases:
  - `list_nonprod_environment_leases` returned no active leases.
- Work capsules:
  - `list_work_capsules` returned ten capsules, all `source=build-studio`, all `executorKind=build-studio`, all `status=working`, and all with null `headBranch`, `worktreePath`, and `pullRequestUrl`.
- GitHub state:
  - One open PR was visible: `#1204 feat: add contributor MCP readiness`, branch `feat/contributor-mcp-readiness`, merge state blocked by CodeQL.
  - Sixty-six remote branches had no open PR.
- Worktree state:
  - Eighty-five registered git worktrees existed.
  - Twenty-three registered worktrees were under `D:\DPF\.claude\worktrees`.
  - Sixty-one adjacent worktrees followed the `D:\DPF-*` pattern.
  - Four filesystem-only directories under `D:\DPF\.claude\worktrees` were not registered git worktrees.
- Rogue server scan:
  - Ports in the 3000-3999 range were limited to Docker/WSL-backed listeners on `3000`, `3002`, and `3035`.
  - No unmanaged Node or Next.js listener was observed at the time of the snapshot.

The core finding is that runtime and work execution substrate exists, but external contributor state is not joined into one inspectable lane.

## Research And Benchmarking

This feature follows established delivery-control patterns from major developer platforms while keeping DPF's local-first runtime model.

### GitHub Actions Environments And Deployments

GitHub deployments connect a ref to an environment and surface deployment status, environment protection rules, concurrency, and URLs. The adopted pattern is "review and verification are attached to a named environment, not just to a branch." DPF should similarly require a contributor to use a registered runtime lane before UI verification can count.

Reference: [GitHub Docs - Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)

### GitLab Review Apps And Environments

GitLab Review Apps create per-branch preview environments and can stop them automatically when the merge request closes or a TTL expires. The adopted pattern is explicit preview ownership with lifecycle cleanup. DPF should adopt TTL and stale-lane reporting, but reject unbounded per-branch runtime creation because DPF already has constrained local lanes and Build Studio sandbox resources.

References:

- [GitLab Docs - Review Apps](https://docs.gitlab.com/ci/review_apps/)
- [GitLab Docs - Environments](https://docs.gitlab.com/ci/environments/)

### Vercel Git Deployments

Vercel automatically maps Git branches and pull requests to preview deployments and exposes URLs for verification. The adopted pattern is that a reviewer has a stable URL tied to a commit. DPF should require a recorded served commit SHA and a runtime URL before a contributor says "ready to test." DPF should not copy Vercel's cloud-per-branch model for local verification lanes.

Reference: [Vercel Docs - Git](https://vercel.com/docs/git)

### Jira Development And Deployment Panels

Jira shows branch, commit, PR, build, deployment, and release context around an issue. The adopted pattern is work-item-centered traceability: reviewers see the delivery chain from task to code to deployment. DPF should expose this through Work Capsules and lane rows rather than making operators infer it from Git commands.

Reference: [Atlassian Support - View release information for an issue](https://support.atlassian.com/jira-software-cloud/docs/view-release-information-for-an-issue/)

## Architecture Decision

Use a projection over existing substrate as the Contributor Change Lane source of truth.

Rejected alternatives:

- A new standalone `ContributorChangeLane` table. This would duplicate `WorkCapsule`, `RuntimeTarget`, `RuntimeVerification`, `NonProductionEnvironmentLease`, Git branches, worktrees, and PR state.
- Documentation and skills only. This would not prevent recurring waste because agents could continue bypassing runtime and handoff discipline.

The WWMD/kernel decision on 2026-05-26 recommended `projection-over-existing-substrate` with high confidence. The strongest drivers were DCO/PR discipline, build gate enforcement, no fabrication, and architecture over shortcuts.

## Design Principles

1. Source isolation is not runtime ownership. A branch or worktree gives a contributor an isolated source tree; it does not authorize a random local server.
2. Only registered lanes may serve contributor UI verification.
3. A stopped registered lane may be claimed, but it is not verification-ready until async startup and health checks pass.
4. Branch handoff is incomplete unless it has an open PR or an active WIP record with TTL, owner, branch, purpose, and next action.
5. A PR means ready to merge, not a parking place.
6. "Ready to test" requires the served lane commit SHA to match the branch commit SHA.
7. "Done" requires evidence: merge check, focused tests, build/typecheck, runtime deployment, browser verification, and PR/CI status.
8. Cleanup is part of delivery: stale leases, merged branches, stale WIP records, and orphan worktrees must be visible.
9. Runtime verification evidence should align with future Ring 2 to Ring 3 GearInterface events under EP-REDUCTION-GEAR-ARCH. `RuntimeVerification` remains the current ledger; future instrumentation can emit GearInterface events from the same lifecycle transitions.

## Lane Model

A Contributor Change Lane is a read model built from current records:

```ts
type ContributorChangeLane = {
  id: string;
  laneKind:
    | "root-portal"
    | "dev-portal"
    | "build-sandbox"
    | "local-integration"
    | "external-debug";
  source: "work-capsule" | "runtime-target" | "nonprod-lease" | "git-branch" | "worktree";
  status:
    | "available"
    | "claimed"
    | "starting"
    | "running"
    | "verifying"
    | "blocked"
    | "ready-for-review"
    | "released"
    | "stale";
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

Projection inputs:

- `WorkCapsule` for owner, purpose, branch, worktree, PR, backlog, and active WIP state.
- `RuntimeTarget` for managed runtime identity, URL, commit, status, heartbeat, and final-acceptance capability.
- `RuntimeVerification` for health, browser, commit match, and acceptance evidence.
- `NonProductionEnvironmentLease` for TTL and claimed environment ownership.
- Git local/remote inventory for branches, worktrees, and merge status.
- GitHub PR inventory for open, merged, closed, blocked, and CI state.

Priority order for joined rows:

1. A Work Capsule with a runtime target and branch is the primary row.
2. A runtime lease without a capsule is a lane row with a missing-capsule blocker.
3. A branch with an open PR but no capsule is an orphaned-handoff row.
4. A branch without PR or WIP TTL is an orphan branch row.
5. A registered worktree without capsule or active branch linkage is an orphan worktree row.

## Registered Lane Taxonomy

Contributor UI verification may use only these registered lane kinds:

- `root-portal`: protected current portal. Allowed for final acceptance only when it is intentionally serving the release/mainline state.
- `dev-portal`: contributor verification lane. It may be claimable even when stopped, but requires async startup and health promotion before use.
- `build-sandbox`: Build Studio sandbox lane. Used for Build Studio-produced work and selected contributor verification when explicitly leased.
- `local-integration`: governed local integration harness. It is suitable for API, migration, and integration verification when recorded through the non-production lease substrate.
- `external-debug`: explicitly debug-only. It may help diagnose an issue, but cannot satisfy PR readiness or final acceptance.

Ad hoc runtime processes are not lanes. A random `next dev`, `next start`, hidden PowerShell server, or tunnel may not be used for feature verification or handoff.

## Async Startup And Health Contract

The operator decision on 2026-05-26 is: a stopped but registered lane can be claimed, then asynchronously started and health-checked. If it does not start, that is a lane failure to surface, not a reason to create a rogue server.

State transition:

1. Contributor requests a registered lane.
2. Claim succeeds if the lane is available or expired.
3. If the lane is already healthy, projection status becomes `running`.
4. If the lane is registered but stopped, claim status becomes `starting`.
5. A brokered startup/check worker attempts the approved start operation for that lane kind.
6. The worker polls the lane health endpoint and records `RuntimeVerification` entries.
7. On healthy response, `RuntimeTarget.status` becomes `running`; lane status becomes `running`; verification can proceed.
8. On timeout, process failure, or repeated health failure, lane status becomes `blocked`; failure reason is recorded; lease remains visible until released or expired.

Defaults:

- Startup timeout: 5 minutes.
- Heartbeat stale threshold: 10 minutes for contributor lanes unless a more specific runtime target threshold exists.
- A `starting` lane is not valid evidence for "ready to test."
- A `blocked` lane should show the operator recovery action, such as "restart dev-portal through the runtime broker" or "release stale lease."

The worker must use registered runtime operations only. It must not start an arbitrary Node process or open an unmanaged port.

## Branch Handoff Contract

A branch handoff is valid only when one of these is true:

1. An open PR exists and the branch has passed the ready-for-review gate.
2. An active WIP record exists with:
   - owner
   - branch
   - worktree path
   - purpose
   - next action
   - expiry/TTL
   - runtime lane if UI verification is expected

Branches without either are orphaned. Worktrees without a matching active capsule or branch handoff are orphaned.

## Ready-For-Review Gate

A lane can move to `ready-for-review` only when all checks are recorded after the latest merge check against `origin/main`:

1. Branch is rebased or merge-checked against current `origin/main`.
2. Focused tests passed.
3. Typecheck and production build passed when the change touches TypeScript, UI, workflows, or runtime code.
4. Migration applies cleanly when schema changes are present.
5. A registered runtime lane is serving the same commit SHA as the branch head.
6. Browser verification was performed against that registered lane.
7. PR exists.
8. CI is green, or pending with known status and no local blocker hidden from the operator.

The UI should distinguish `ready-for-review` from `working`, `blocked`, `verification-needed`, and `wip-expiring`.

## UI Surface

Route: `/platform/development/change-lanes`

Navigation home: Platform Development.

The page is an operational dashboard, not a marketing page. It should prioritize dense, scannable rows:

- Lane
- Status
- Owner
- Branch
- Commit
- Served commit
- PR
- Runtime URL
- Latest verification
- Age
- TTL
- Blockers
- Next action

Suggested tabs:

- Active lanes
- Branches needing handoff
- Orphan worktrees
- Stale leases
- Merged branches safe to delete

Design constraints:

- Use theme variables only: `var(--dpf-text)`, `var(--dpf-muted)`, `var(--dpf-bg)`, `var(--dpf-surface-1)`, `var(--dpf-surface-2)`, `var(--dpf-border)`, `var(--dpf-accent)`.
- Do not use hardcoded hex colors.
- Keep rows compact and stable; avoid decorative cards.
- Use icons for claim, release, refresh, open PR, open runtime, and cleanup actions when actions are added.
- Show warnings as data rows and badges, not modal-only state.

## MCP And Platform Actions

The MCP surface should first wrap existing substrate:

- `list_runtime_lanes`: read the projection.
- `claim_runtime_lane`: create or renew an approved lease and move the lane to `claimed` or `starting`.
- `deploy_branch_to_runtime_lane`: deploy only through a registered brokered runtime operation.
- `record_runtime_verification`: reuse or extend existing runtime verification handling.
- `release_runtime_lane`: release a lease and mark the lane available when safe.
- `list_orphaned_branches`: return branches with no open PR and no active WIP.
- `list_orphaned_worktrees`: return worktrees with no active capsule or handoff.
- `record_branch_handoff`: attach branch/worktree/purpose/next action/TTL to a Work Capsule.

Any new MCP tool must also be added to `TOOL_TO_GRANTS` in `apps/web/lib/tak/agent-grants.ts`.

If a caller lacks write scope, the tool must return the existing MCP insufficient-scope shape. Agents must not fall back to direct DB writes to bypass token scope.

## Janitor And Reporting

The first janitor pass should be read-only and auditable:

- Remote branches with no open PR and no active WIP record.
- Local worktrees with no active Work Capsule or branch handoff.
- Stale runtime lane leases.
- Runtime targets with stale heartbeats.
- Already-merged branches safe to delete.
- Unmerged branches older than threshold with no PR or recent activity.

Cleanup actions should be explicit and scoped. No recursive delete should run without a resolved target path check and a lane/capsule record that explains why cleanup is safe.

## Agent-Facing Rules

The contributor rules should be published in the DPF skill pack and pointed to from `AGENTS.md`:

1. Do not start ad hoc runtime servers for feature verification.
2. Claim a registered runtime lane or stop and report the blocker.
3. Do not say "ready to test" unless a registered lane is healthy and serving the branch commit.
4. Do not say "done" for branch-only work unless it is explicitly WIP with TTL and next action.
5. Do not open a PR until the ready-for-review gate has passed.
6. If a PR is opened early by mistake, close it and keep the branch with a WIP handoff.
7. Before handoff, re-check `origin/main`, merge/rebase, run focused verification, and record evidence.

## Phasing

### Phase 1 - Read-only control plane

Add the lane projection, Git/GitHub/worktree inventory, and `/platform/development/change-lanes` dashboard. No write actions. This is the smallest useful slice because it makes the current waste visible without risking runtime mutation.

### Phase 2 - WIP handoff and lane claim

Add `record_branch_handoff`, `claim_runtime_lane`, and `release_runtime_lane` wrappers over Work Capsules, Runtime Targets, and Non-production Leases.

### Phase 3 - Async startup and verification

Add brokered startup/check workflow for registered stopped lanes, commit-match verification, browser verification recording, and blocked-lane evidence.

### Phase 4 - Ready-for-review enforcement

Teach contributor handoff tools and skills to reject "ready" language unless the gate is satisfied. Surface failures in the dashboard and MCP responses.

### Phase 5 - Janitor cleanup actions

Add guarded cleanup actions for merged branches, stale WIP, stale leases, and orphaned worktrees after the read-only report has proven accurate.

## Risks And Mitigations

- Risk: duplicate lifecycle state across Work Capsules, Runtime Targets, and leases.
  - Mitigation: Contributor Change Lane is a projection, not a new lifecycle table.
- Risk: stopped lanes get claimed and treated as ready.
  - Mitigation: `starting` is a non-ready state; health evidence is required for `running`.
- Risk: agents use direct DB writes when MCP scope blocks them.
  - Mitigation: preserve the existing insufficient-scope behavior and document that direct DB fallback is forbidden for writes.
- Risk: cleanup deletes the wrong worktree.
  - Mitigation: read-only janitor first; cleanup later with resolved-path validation and explicit safe-delete criteria.
- Risk: dashboard becomes stale if GitHub or local inventory commands fail.
  - Mitigation: show stale/error state per source and keep projection rows explainable.

## Acceptance Criteria

The design is successful when:

- A contributor can see every active branch/worktree/runtime lane handoff in one place.
- A branch without PR or active WIP TTL appears as an orphan.
- A registered but stopped dev lane can be claimed into `starting`.
- A `starting` lane becomes `running` only after health verification.
- A lane that fails to start becomes `blocked` with evidence and operator next action.
- A contributor cannot honestly report "ready to test" without a healthy registered lane serving the branch commit.
- A contributor cannot honestly report "ready for review" without merge, verification, runtime, browser, PR, and CI evidence.
- No new source-of-truth table duplicates existing Work Capsule, Runtime Target, Runtime Verification, or Non-production Lease records.
