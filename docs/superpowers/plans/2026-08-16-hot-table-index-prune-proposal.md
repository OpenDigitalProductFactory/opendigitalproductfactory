# Hot-table index prune — PROPOSAL ONLY (operator review boundary)

**Status: proposal — NO index is dropped by this branch.** BI-640B011D (Simplify &
Strengthen W2, architecture pass 2026-08-16 §3.2-f) requires index hygiene to run in
both directions: this branch *adds* justified FK-leading indexes; dropping anything
from the two hottest write-path tables is a named human-review boundary because every
index taxes every INSERT/UPDATE on the platform's highest-volume tables, and dropped
coverage can silently regress a dashboard.

**Operator action requested:** review each candidate below against
`pg_stat_user_indexes.idx_scan` on a mature live install (`/ops` → database stats, or
`SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE relname IN
('ToolExecution','WorkCapsule') ORDER BY idx_scan;`) before approving any drop. Zero
scans on a mature install is the evidence bar; this document only ranks likelihood.

## ToolExecution (13 indexes; highest-volume table, enrolled for 365-day purge)

| # | Index | Keep/candidate | Rationale |
|---|-------|----------------|-----------|
| 1 | `[agentId, createdAt]` | keep | Coworker authority audit trail per agent (`/platform/ai/authority`). |
| 2 | `[userId, createdAt]` | keep | Per-user tool audit listings. |
| 3 | `[toolName, createdAt]` | keep | Per-tool usage/failure analysis (MCP efficiency tooling). |
| 4 | `[threadId]` | keep | Per-conversation tool trace joins. |
| 5 | `[auditClass, createdAt DESC]` | keep | Governance surfaces filter by audit class. |
| 6 | `[capabilityId, createdAt DESC]` | **prune candidate** | Capability-scoped listing duplicated in practice by toolName-scoped queries; verify idx_scan. |
| 7 | `[apiTokenId, createdAt DESC]` | keep | Token forensics (which token did what) — security path. |
| 8 | `[taskRunId, createdAt DESC]` | keep | Task-run tool trace (A2A/task surfaces). |
| 9 | `[skillId, createdAt DESC]` | **prune candidate** | Skill telemetry now flows through SkillUsageEvent/SkillMetric; ToolExecution.skillId reads are rare; verify idx_scan. |
| 10 | `[envelopeId]` | **prune candidate** | Trust-envelope join — envelope surfaces are new (PR #4047); confirm they query by envelopeId at volume before keeping a per-row index on the hottest table. |
| 11 | `[delegatingUserId, createdAt DESC]` | keep | Delegated-authority audit (WSID/TAK) — security path. |
| 12 | `[delegationChainId]` | **prune candidate** | Chain-scoped forensics likely served by `[delegatingUserId, createdAt]`; verify idx_scan. |
| 13 | `[createdAt]` | keep | Retention sweep cutoff scan (purge policy `toolExecution`, 365d). |

## Workroom / table `WorkCapsule` (14 indexes at pass time; 16 after this branch)

| # | Index | Keep/candidate | Rationale |
|---|-------|----------------|-----------|
| 1 | `[status, updatedAt]` | keep | Primary WIP listing + liveness reaping scan. |
| 2 | `[backlogItemId]` | keep | BI↔workroom binding lookups (claim/adopt paths). |
| 3 | `[featureBuildId]` | keep | Build-Studio attachment lookup; now also FK-leading. |
| 4 | `[taskRunId]` | **prune candidate** | No current writer populates `taskRunId` (see W2 FK notes); index maintains cost for a null column. Keep the FK; drop the index if idx_scan is 0. |
| 5 | `[gitPromotionCandidateId]` | **prune candidate** | Same: writer-less column today; verify before dropping (now FK-leading). |
| 6 | `[changePromotionId]` | **prune candidate** | Same: writer-less column today; verify before dropping (now FK-leading). |
| 7 | `[epicId]` | keep | Epic-scoped workroom listings. |
| 8 | `[decisionScope]` | **prune candidate** | Low-cardinality single-column filter; usually paired with status — verify. |
| 9 | `[portfolioRole]` | **prune candidate** | Low-cardinality; same shape as #8. |
| 10 | `[activityKind]` | **prune candidate** | Low-cardinality; same shape as #8. |
| 11 | `[headBranch]` | keep | Adopt path resolves identity by (repositoryFullName, headBranch) — leading branch filter. |
| 12 | `[sandboxId]` | keep | Sandbox↔workroom recovery lookups. |
| 13 | `[leaseExpiresAt]` | keep | Lease-expiry reaper scan. |
| 14 | `[requestedByPrincipalId]` | keep | Requester-scoped listings (EP-WORK-CONVERGENCE) + FK-leading. |
| 15 | `[workItemId]` | keep | WorkItem anchor join + FK-leading. |
| 16 | `[leaseHolderPrincipalId]` (new) | keep | Added this branch: SET NULL fan-out on Principal delete + lease-holder lookups. |
| 17 | `[createdByPrincipalId]` (new) | keep | Added this branch: SET NULL fan-out on Principal delete. |

## Deliberate exclusions recorded by W2 (same review boundary)

- **`Workroom.backlogItemId` / `Workroom.epicId` FKs were NOT declared.** Live
  writers store mixed key shapes — BI-*/EP-* semantic keys (MCP adopt/claim paths,
  pinned by `work-capsule-adoption.test.ts`) vs cuid row ids
  (`build-studio-attachment.ts`, `claimBacklogItemForWork`) — so any single FK target
  breaks one writer family at runtime. Normalizing the writers to one canonical key
  is the prerequisite; until then these two columns stay in the unbacked-`*Id`
  budget of `scripts/check-fk-index-coverage.mjs`.
- **`organizationId` columns got FKs but no indexes**: single-org-per-install makes
  them one-value columns; an index would be pure write tax.

## Rollout shape when approved

One forward-only migration per table (`DROP INDEX` is instant), preceded by a week of
`pg_stat_user_indexes` sampling on at least one busy install. Nothing in this
proposal blocks or is blocked by the W2/W3 migrations on this branch.
