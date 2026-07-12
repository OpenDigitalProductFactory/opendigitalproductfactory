# Implementation Plan — BI-D6FA8641: Bind external evidence to the WorkCapsule

**BI:** BI-D6FA8641 (epic **EP-WORK-CONVERGENCE**, priority 1 — the write-model hinge)
**Date:** 2026-07-11
**Memo:** `docs/superpowers/specs/2026-07-11-collaborative-work-management-convergence-memo.md` §6.3
**Design specs:** `2026-06-19-unified-build-studio-tracking-all-surfaces-design.md` (§6.1), `2026-07-11-build-studio-customer-mode-convergence-addendum.md` (§6.3, unmerged)

## Why this is first
Everything downstream in EP-WORK-CONVERGENCE — auto-claim (BI-5FDBF786), cross-agent handoff (BI-A443B9CC), the customer-mode capsule projection (BI-BB13B599) — is blind to external Claude/Codex/Grok work until each piece of external evidence is bound to the durable unit (the `WorkCapsule`) with producer identity. "A prettier customer surface before the write model is unified would still be blind to external work."

## Current state (verified)
- `ExternalEvidenceRecord` (`packages/db/prisma/schema.prisma:4955`): `actorUserId`, `routeContext`, `operationType`, `target`, `provider`, `resultSummary`, `details?`, **`buildId?`**, **`taskRunId?`**, `createdAt`. **No `workCapsuleId`; no producer principal / `executorKind`** beyond `actorUserId` + free-text `provider`.
- Write path: `recordExternalEvidence(...)` (`apps/web/lib/actions/external-evidence.ts`) invoked from the `record_external_evidence` MCP tool (`apps/web/lib/mcp-tools.ts:6545, 7036, 7059, 7200`).
- Capsule already models producer identity on its own activity: `WorkCapsuleActivity` (`schema.prisma`) has `recordedById` + **`recordedByAgentId`** + `toolExecutionId` — the pattern to mirror.
- Read side: `projectCapsule` (`apps/web/lib/work-management/status-projection.ts:131`, used at `:283` in `projectWorkCaseState`); the `UnifiedEvidenceTimeline` component consumes a capsule timeline projection.
- Capsule↔build link exists: `WorkCapsule.featureBuildId` — usable to backfill `workCapsuleId` from `buildId`.

## Target state
Every `ExternalEvidenceRecord` can be resolved to a `WorkCapsule` and carries who/what produced it, so the capsule timeline and `WorkCase` projection surface external agent work — without exposing raw logs by default.

## Steps

1. **Schema (additive, non-destructive).**
   - Add to `ExternalEvidenceRecord`: `workCapsuleId String?`, `executorKind String?`, `recordedByPrincipalId String?`, `recordedByAgentId String?`; relation `capsule WorkCapsule? @relation(fields: [workCapsuleId], references: [id], onDelete: SetNull)`; index `@@index([workCapsuleId, createdAt])`.
   - All nullable → no backfill required to migrate; no rename of the applied migration (avoids P3018). `pnpm --filter @dpf/db generate` after.

2. **Write path.**
   - Extend `recordExternalEvidence(input)` to accept optional `workCapsuleId`, `executorKind`, `recordedByPrincipalId`/`recordedByAgentId`; persist them.
   - Extend the `record_external_evidence` MCP tool input schema (`mcp-tools.ts`) with the same optional fields; default `executorKind` from the caller principal's provider where derivable.
   - **Provenance-agnostic invariant preserved** (`governance-approves-evidence-not-provenance`): gates still read only required evidence fields; the new fields are for rollup/attribution, never for gate branching.

3. **Resolve-or-tolerate the capsule (Phase-1 scope only).**
   - If `workCapsuleId` is supplied, bind directly. If only `buildId` is supplied, resolve `workCapsuleId` via `WorkCapsule.featureBuildId = buildId` when a unique capsule exists; otherwise leave null (full auto-claim is BI-5FDBF786, explicitly out of scope here).

4. **Backfill (best-effort, reversible).**
   - One-time script/migration data-step: set `workCapsuleId` on existing rows where a unique `WorkCapsule.featureBuildId = ExternalEvidenceRecord.buildId` match exists. Log the count that could not be resolved (no silent truncation).

5. **Read path — capsule timeline rollup.**
   - Extend the capsule timeline projection to merge `ExternalEvidenceRecord` by `workCapsuleId` into the one typed event stream feeding `UnifiedEvidenceTimeline`; render mechanical/agent events collapsed, raw detail behind Engineer view (memo §6.3). This is the seam BI-BB13B599 later reads for customer mode — Phase 1 only makes the data resolvable and rolled up.

6. **Tests (TDD — write red first).**
   - `recordExternalEvidence` persists `workCapsuleId` + producer identity (extend `mcp-tools-external-evidence.test.ts`).
   - `buildId`-only input resolves `workCapsuleId` via the featureBuild link; ambiguous/absent → null, no throw.
   - Capsule timeline projection includes an external-evidence event once bound; excludes unbound rows.
   - Backfill resolves the join case and reports unresolved count.

## Acceptance criteria
- An external Claude/Codex/Grok evidence record is queryable by `workCapsuleId` and appears on that capsule's timeline with producer attribution.
- No orphaned external evidence for work that has a resolvable capsule; unresolved rows are logged, not hidden.
- Migration is additive/nullable; existing gates unchanged; `governance-approves-evidence-not-provenance` intact.

## Guardrails
- Nullable columns + `onDelete: SetNull` → no destructive migration; don't rename the applied migration.
- Do **not** branch any governance gate on the new provenance fields.
- Post-rebase in any worktree: `pnpm --filter @dpf/db generate` before typecheck (Prisma client regen).

## Explicitly out of scope (later phases, same epic)
- Auto-claim/adopt a capsule at external work start — **BI-5FDBF786** (priority 2).
- `executor-changed` writer + `reassign_capsule_executor` + lease transfer — **BI-A443B9CC** (priority 3).
- Build Studio customer-mode capsule status projection ("wife-test" surface) — **BI-BB13B599** (priority 4).
