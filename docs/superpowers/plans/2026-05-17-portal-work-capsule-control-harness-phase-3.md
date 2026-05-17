# Portal Work Capsule Control Harness Phase 3 Implementation Plan

> **Status (2026-05-17):** Slice 1 landed as the lease auto-renewal path. Slice 2 is Build Studio attachment: new direct Build Studio builds and backlog-promoted Build Studio drafts create a Work Capsule and, when backlog-linked, write backlog timeline activity. External desktop/CLI executor attachment remains open.

## Goal

Ship the next durable executor-attachment slice after Phase 2: capsule-scoped MCP write tools keep external executor leases alive, read tools stay idempotent, and the remaining Phase 3 executor-attachment work remains explicitly deferred.

## Grounding

- Phase 1 landed the Work Capsule schema, MCP surface, scanner, adoption UI, and explicit `heartbeat_capsule` renewal path.
- Phase 2 landed governed creation as display-and-record: deterministic branch/worktree planning, operator-paste launch commands, and root-clone refusal. It merged to `main` via PR #675.
- Spec section 9.5 requires Phase 3 lease auto-renewal on capsule-scoped write tools while forbidding renewal from `list_work_capsules` and `get_work_capsule`.

## Slice 1 Scope

In scope:

- Add a handler-level helper that renews a lease after successful existing-capsule MCP writes.
- Cover `claim_capsule_scope`, `record_capsule_evidence`, `update_work_capsule_status`, and `release_capsule_scope`.
- Keep `heartbeat_capsule` as the explicit single-renewal path.
- Keep `create_work_capsule` and `adopt_worktree` as initial lease-issue paths for external executor attach.
- Add tests proving a write renews, a read does not renew, and heartbeat renews once.
- Update the design spec status and Phase 3 verification notes.

Out of scope for this slice:

- Build Studio build-to-capsule attachment.
- Codex/Claude desktop attachment UX beyond the existing MCP tools.
- Codex CLI / Claude Code CLI sandbox executor sessions.
- Collision-warning UI or cross-capsule overlap queries.
- `executor-changed` handoff activity.
- DCO commit trailer and PR-body `DPF-Capsule:` enforcement.

## Slice 1 Implementation Status

Committed in `268ea90a feat(work-capsules): auto-renew leases on writes`:

- `renewLeaseAfterCapsuleWrite(capsuleId, actor)` helper added to `mcp-handlers.ts`.
- `runAutoRenewedCapsuleWrite(args)` wrapper applied to `claim_capsule_scope`, `record_capsule_evidence`, `update_work_capsule_status`, and `release_capsule_scope`.
- `list_work_capsules` and `get_work_capsule` left unchanged (read tools; no auto-renewal).
- `create_work_capsule` and `adopt_worktree` left unchanged (issue the initial lease; auto-renewal is for existing-capsule writes only).
- `heartbeat_capsule` left unchanged (explicit single-renewal path; `runAutoRenewedCapsuleWrite` is not applied).

**Test coverage as committed:**

| Assertion | Status |
|---|---|
| `record_capsule_evidence` auto-renews (update with `leaseExpiresAt` + `lease-renewed` activity) | ✓ explicit |
| `get_work_capsule` does not renew | ✓ explicit |
| `heartbeat_capsule` renews once | ✓ explicit |
| `claim_capsule_scope` auto-renews | ⚠ missing — write success asserted, renewal not asserted |
| `update_work_capsule_status` auto-renews | ⚠ missing — write success asserted, renewal not asserted |
| `release_capsule_scope` auto-renews | ⚠ missing — write success asserted, renewal not asserted |
| `list_work_capsules` does not renew | ⚠ missing — spec §17.3 requires all read tools to be asserted idempotent |

The three missing write assertions and one missing read assertion must be added before this slice can open a PR. Spec §17.3 states: "existing-capsule write tools renew, read tools do not." A single proof (`record_capsule_evidence`) is not sufficient coverage because the wrapper is applied per-handler, not globally — a handler wired incorrectly would only be caught by its own test.

**Pattern for the missing write assertions** (same shape as the `record_capsule_evidence` test):
- `workCapsule.update` called with `{ where: { capsuleId }, data: { leaseHolderPrincipalId, leaseExpiresAt } }`
- `workCapsuleActivity.create` called with `{ data: { kind: "lease-renewed", recordedByAgentId } }`

**Pattern for the missing read assertion** (`list_work_capsules`):
- After a successful call, `workCapsule.update` not called and `workCapsuleActivity.create` not called.

## File Touches

- `apps/web/lib/work-capsules/mcp-handlers.ts`
- `apps/web/lib/mcp-tools-work-capsules.test.ts`
- `docs/superpowers/specs/2026-05-14-portal-work-capsule-control-harness-design.md`
- `docs/superpowers/plans/2026-05-17-portal-work-capsule-control-harness-phase-3.md`

## Verification

Required before PR:

- `pnpm --filter web exec vitest run lib/mcp-tools-work-capsules.test.ts` — all tests green including the four new renewal/idempotency assertions
- `pnpm --filter web typecheck`
- `pnpm --filter web build`

This slice has no migration and no user-facing UI change, so UX verification is limited to the MCP handler contract exercised by the focused test.

## Slice 2 Scope

In scope:

- Attach newly created direct Build Studio `FeatureBuild` rows to a Work Capsule in the same transaction.
- Attach backlog-promoted Build Studio drafts to a Work Capsule in the same promotion transaction.
- Preserve the backlog item row id, epic row id, `FeatureBuild.id`, public `buildId`, and Build Studio phase in capsule linkage/workspace state.
- Write `BacklogItemActivity` of kind `build-studio-capsule-attached` for backlog-linked builds so the backlog timeline shows that development has started under a capsule.
- Keep direct Build Studio builds valid without a backlog item while still creating a capsule.

Out of scope for Slice 2:

- Backfilling capsules for pre-existing active `FeatureBuild` rows.
- External Codex/Claude desktop attachment UX.
- CLI sandbox executor sessions.
- `executor-changed` handoff UI.
- Commit trailer and PR-body `DPF-Capsule:` enforcement.

## Slice 2 Implementation Status

Implemented on `feat/work-capsule-build-studio-attach`:

- Added `attachBuildStudioWorkCapsule` in `apps/web/lib/work-capsules/build-studio-attachment.ts` as the reusable Build Studio-to-capsule policy helper.
- Extended `createWorkCapsule` input to accept existing linkage fields (`executorRef`, `backlogItemId`, `epicId`, `featureBuildId`, `workspaceState`, and explicit `status`) without changing existing manual/MCP callers.
- Updated `createFeatureBuild` so direct Build Studio work creates a `source = build-studio`, `executorKind = build-studio`, `status = working` capsule.
- Updated `promoteBacklogItemToBuildDraft` so backlog-created Build Studio drafts create the same capsule link and write backlog activity.

**Slice 2 test coverage:**

| Assertion | Status |
|---|---|
| Direct `createFeatureBuild` creates a Build Studio Work Capsule | explicit in `apps/web/lib/actions/build-governed.test.ts` |
| Direct `createFeatureBuild` does not write backlog activity without a backlog item | explicit |
| Backlog tee-up promotion creates a Build Studio Work Capsule | explicit in `apps/web/lib/governed-backlog-tee-up.test.ts` |
| `promoteBacklogItemToBuildDraft` returns the attached capsule id | explicit |
| Backlog-linked promotion writes `build-studio-capsule-attached` activity | explicit |

## Slice 2 File Touches

- `apps/web/lib/work-capsules/build-studio-attachment.ts`
- `apps/web/lib/work-capsules/work-capsule-store.ts`
- `apps/web/lib/actions/build.ts`
- `apps/web/lib/governed-backlog-tee-up.ts`
- `apps/web/lib/actions/build-governed.test.ts`
- `apps/web/lib/governed-backlog-tee-up.test.ts`
- `docs/superpowers/specs/2026-05-14-portal-work-capsule-control-harness-design.md`
- `docs/superpowers/plans/2026-05-17-portal-work-capsule-control-harness-phase-3.md`

## Slice 2 Verification

Required before PR:

- `pnpm --filter web exec vitest run lib/governed-backlog-tee-up.test.ts lib/actions/build-governed.test.ts`
- `pnpm --filter web typecheck`
- `pnpm --filter web build`

This slice has no migration and no UI component change. Runtime UX verification is limited to the server-action/workflow contract unless the branch later adds a visible capsule link in Build Studio.

## Next Phase 3 Slice

After Slice 2 lands, the next smallest Phase 3 slice is executor handoff: add the `executor-changed` write path, record every transition as activity, and surface the current executor in capsule detail without introducing promotion behavior.
