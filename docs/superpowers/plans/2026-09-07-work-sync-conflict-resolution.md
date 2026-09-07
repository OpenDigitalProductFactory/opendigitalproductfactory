---
status: draft
---

# Work-sync id conflict resolution implementation plan

**Backlog item:** `BI-8CF5A51D`  
**Workroom:** `WC-B2588227`  
**Design:** the Research, Design and Acceptance sections of `BI-8CF5A51D`; parent spec
[Zero-configuration organization federation §5.7](../specs/2026-09-02-zero-configuration-organization-federation-design.md)

## Problem

Same-organization work sync (`apps/web/lib/federation/work-sync.ts`) records a
peer record whose id already exists locally without the origin marker as
`syncStatus=conflict`, `conflictReason=local-owned-id`, and never touches it
again. There is no resolution path, and the health sentence still reads "In
step". Seven such conflicts exist on this operator install today (four items, three
epics), each a genuinely different record on the two installs under one id.

## Backlog coverage

- Decision: atomic
- Parent: `BI-8CF5A51D`
- Rationale: the resolution primitive, the runner honouring the decision, the
  governed MCP surface, and the health-line change are one invariant — "a
  conflict is a decision someone takes, and the platform executes it". A
  primitive without the runner change re-flags every cycle; a runner change
  without the tool leaves hand SQL as the only path; a tool without the health
  change leaves the decision invisible.
- Dependencies: none

| Key | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- |
| resolution-primitive | OBJ-8CF-1 | contract:work-sync-conflict-decision-v1 | flow:conflict-to-marked-mirror | AC-1, AC-3 |
| runner-honours-decision | OBJ-8CF-2 | contract:work-sync-resolved-local | flow:pull-skips-resolved-local | AC-2 |
| governed-mcp-surface | OBJ-8CF-3 | contract:federation-membership-pack-tools | flow:agent-lists-and-resolves | AC-4, AC-6 |
| health-names-decision | OBJ-8CF-4 | contract:federation-health-line | flow:cockpit-delivery-flow-briefing | AC-5 |

## Phases

### Phase 1 — status vocabulary and primitive

- `packages/db/src/federated-record-sync.ts`: `MirrorSyncStatus` gains
  `"resolved-local"`. No migration: `syncStatus` is a text column.
- New `apps/web/lib/federation/work-sync-conflicts.ts`:
  `listWorkSyncConflicts(db)` and `resolveWorkSyncConflict(db, input)`.
  - `adopt-peer`: parse origin from `peerRecordRef`, stamp the local row's
    body/description with `withFederatedWorkOriginMarker`, set mirror
    `pending` / `conflictReason=null`. Nothing deleted; the runner overwrites
    on its next pull.
  - `keep-local`: set mirror `resolved-local` / `conflictReason=null`.
  - Refuse unknown mirror, non-conflict mirror, unknown decision, with no writes.
- Tests: `work-sync-conflicts.test.ts` with the same injected-store style as
  `work-sync.test.ts`.

### Phase 2 — runner honours the decision

- `work-sync.ts` `upsertItem` / `upsertEpic`: when the existing row is
  unmarked and the known mirror is `resolved-local`, return `kept-local`
  without writing. `WorkSyncLinkResult` gains `itemsKeptLocal`; the
  console line prints it. Epics: `known` currently covers items only; add the
  epic mirror lookup.
- Tests added to `work-sync.test.ts`: adopt-peer round trip (marker present →
  overwritten, mirror `synced`); keep-local not re-flagged.

### Phase 3 — governed MCP surface

- `apps/web/lib/mcp/packs/federation-membership-pack.ts`: definitions and
  handlers for `list_work_sync_conflicts` (`view_platform`) and
  `resolve_work_sync_conflict` (`manage_platform`, requires `reason`).
- `apps/web/lib/tak/agent-grants.ts` `TOOL_TO_GRANTS`: `work_capsule_read`
  and `admin_write` respectively; pack `grants` mirror them so
  `tool-registry.test.ts` stays green. The file is baselined "may shrink,
  never grow" — offset the two new lines by consolidating adjacent comments.

### Phase 4 — health line and docs

- `packages/db/src/federation-health.ts`: the conflict note becomes
  "N ids need an ownership decision (resolve_work_sync_conflict)"; states
  unchanged. Update `federation-health.test.ts` and
  `work-sync-read-model.test.ts` expectations.
- Docs: federation spec §5.7 gains the resolution path;
  `docs/architecture/orientation.md` federation row points at it.

## Verification

- `pnpm --filter web exec vitest run lib/federation lib/mcp/tool-registry.test.ts`
- `pnpm --filter @dpf/db exec vitest run src/federation-health.test.ts`
- `pnpm --filter web build`
- Migration: not applicable (no schema change).
- UX: not applicable (MCP and health sentence only); the health sentence is
  checked on the running install's Delivery Flow after self-upgrade.

## Applying to the seven live conflicts

After the release lands on both installs, each conflict is resolved with
`resolve_work_sync_conflict` on the side that gives way, by the operator's
choice per record. Six of the seven have different titles on the two sides, so
the choice is a content decision, not a timestamp rule.
