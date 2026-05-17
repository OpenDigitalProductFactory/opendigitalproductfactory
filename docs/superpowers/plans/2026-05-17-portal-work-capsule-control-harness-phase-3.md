# Portal Work Capsule Control Harness Phase 3 Implementation Plan

> **Status (2026-05-17):** Slice 1 implementation committed (`268ea90a`). Three write-tool renewal assertions and one read-tool idempotency assertion are missing before the test contract matches spec §17.3 — add them, then run verification before opening PR.

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

## Next Phase 3 Slice

After this PR lands, the next smallest Phase 3 slice is executor handoff: add the `executor-changed` write path, record every transition as activity, and surface the current executor in capsule detail without introducing promotion behavior.
