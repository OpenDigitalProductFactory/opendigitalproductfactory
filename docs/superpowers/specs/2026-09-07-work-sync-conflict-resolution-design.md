---
status: draft
---

# Work-sync id conflict resolution

**Backlog item:** `BI-8CF5A51D`  
**Workroom:** `WC-B2588227`  
**Parent spec:** [Zero-configuration organization federation](2026-09-02-zero-configuration-organization-federation-design.md) §5.7  
**Plan:** [implementation plan](../plans/2026-09-07-work-sync-conflict-resolution.md)

## 1. Problem

Same-organization work sync (`apps/web/lib/federation/work-sync.ts`) pulls each
trusted peer's backlog every five minutes and materialises it locally as
`BacklogItem` / `Epic` rows carrying a standalone
`[origin:federatedWork:<installationId>:<id>]` marker line. Ownership is
inferred from that marker: a row without it is treated as locally authored and
is never overwritten (spec 2026-08-23 §4 invariant 6, "only the origin
mutates").

When the peer serves an id that already exists locally without the marker, the
runner records a `FederatedRecordMirror` row with `syncStatus=conflict`,
`conflictReason=local-owned-id`, and stops. Nothing resolves it, nothing asks
anyone, and `resolveFederationHealth` still reports "In step" with a
parenthetical about ids "left alone because local work uses them".

On this operator install (2026-09-07) seven such conflicts exist: four items and
three epics. Six of the seven carry a different title on the two installs, one
is `done` on the peer and `open` here. Neither copy carries a marker: the ids
were cited in plans and specs and independently backfilled on both installs.
The same seven conflicted under the previous, now-revoked, link.

The failure scales with the organization: more installs and more agents filing
anchors means more collisions, each one a silent fork.

## 2. Goals

- G1. A `local-owned-id` conflict is a decision a person or governed agent
  takes, and the platform executes it. No hand SQL on production.
- G2. The decision reuses the existing runner, marker helpers,
  `FederatedRecordMirror` and health module. No new table, no migration.
- G3. The health sentence names unresolved conflicts as an open decision.
- G4. The two installs converge on one author per id after the symmetric
  decision is taken on each side.

Non-goals: install-prefixed id minting (follow-up); a portal form for the
decision beyond the existing Delivery Flow sentence (follow-up); automatic
winner selection.

## 3. Research & Benchmarking

| System | Behaviour on same-key, two-author conflict | DPF stance |
| --- | --- | --- |
| Git (`rerere`, merge) | Stops the pipeline; a human resolves explicitly; the resolution is recorded and reused. | Adopt: explicit decision, recorded on the mirror row. |
| CouchDB replication | Keeps both revisions, deterministically picks a provisional winner, surfaces `_conflicts` for the application to resolve. | Adopt "keep both, surface"; reject the provisional winner, because here the two copies are different records, not two edits of one. |
| Linear / Notion workspace import | Duplicate external keys are quarantined and shown for human mapping; nothing is merged silently. | Adopt quarantine-and-map. |
| DPF demand envelopes (BI-51FD61F1) | Per-installation version vectors; dominance resolves concurrent edits of one record. | Reject for this case: neither vector dominates when both installs minted the record; kept for the id-minting follow-up. |

Options considered:

1. **Last-writer-wins on `updatedAt`.** Rejected: discards one author's work with
   no decision; violates never-fabricate and invariant 6.
2. **Version-vector dominance.** Rejected here: two independently minted records
   have no causal relation, so the outcome is still "conflict".
3. **Explicit governed decision per conflict (chosen).** Two decisions,
   executed by the existing runner, exposed as grant-gated MCP tools, named in
   the health sentence.

## 4. Design

### 4.1 Decisions

| Decision | Effect on this install | Effect on the peer |
| --- | --- | --- |
| `adopt-peer` | The local row's body/description is stamped with the origin marker parsed from `peerRecordRef`; the mirror moves to `pending` with `conflictReason=null`. On the next pull the runner sees a marked row and overwrites it from the origin, ending `synced`. Nothing is deleted. | None. The peer remains the author. |
| `keep-local` | The mirror moves to `resolved-local` with `conflictReason=null`. The runner skips it on every later pull and counts it as `itemsKeptLocal`. | The outbound `canonicalSide=local` mirror already exports our copy; the peer sees its own `local-owned-id` conflict and takes the symmetric `adopt-peer` decision. |

`MirrorSyncStatus` gains `"resolved-local"`. `syncStatus` is a text column, so
no migration.

### 4.2 Primitive

`apps/web/lib/federation/work-sync-conflicts.ts`, DB-injected like the runner:

- `listWorkSyncConflicts(db)` returns, per conflict, `mirrorId`, `recordType`,
  id, local title/status/updatedAt and peer title/status/updatedAt (the peer
  values are already kept in `payload`).
- `resolveWorkSyncConflict(db, { mirrorId, decision, reason, actor, now })`
  refuses an unknown mirror, a mirror not in `conflict`, or an unknown decision,
  with no writes. The decision and reason are recorded on the mirror
  (`conflictReason` cleared; the audit line goes to the platform log and the
  MCP tool-execution record).

### 4.3 Runner

`upsertItem` / `upsertEpic`: when the existing row is unmarked and the known
mirror for that id is `resolved-local`, return `kept-local` without writing.
`known` currently covers items only; the epic mirror lookup is added.
`WorkSyncLinkResult` gains `itemsKeptLocal`.

### 4.4 Governed surface

Two tools in `federation-membership-pack.ts`:

- `list_work_sync_conflicts` — `requiredCapability: view_platform`, grant
  `work_capsule_read`.
- `resolve_work_sync_conflict` — `requiredCapability: manage_platform`, grant
  `admin_write`; `reason` is required.

Grants are mirrored in `agent-grants.ts` `TOOL_TO_GRANTS` so
`tool-registry.test.ts` holds. `agent-grants.ts` is baselined "may shrink,
never grow"; the two new lines are offset by consolidating adjacent comments.

### 4.5 Health

`resolveFederationHealth` replaces the conflict footnote with
"; N ids need an ownership decision (resolve_work_sync_conflict)". The states
`in-step` / `behind` / `broken` are unchanged: a conflict is a decision, not a
transport failure, and the spec's "no sentence tells a person to do something
the platform does itself" holds because the platform cannot take this decision.

## 5. Acceptance

- AC-1: adopt-peer → marker present → overwritten from the origin on the next
  `runWorkSync` → mirror `synced`.
- AC-2: keep-local → never re-marked `conflict`; counted as `itemsKeptLocal`.
- AC-3: unknown mirror, non-conflict mirror, unknown decision → refused, no
  writes.
- AC-4: `list_work_sync_conflicts` returns both sides' title, status and
  `updatedAt` per conflict.
- AC-5: health sentence names the count of unresolved conflicts; states
  unchanged.
- AC-6: `TOOL_TO_GRANTS` and pack grants agree; affected vitest files pass;
  `pnpm --filter web build` is clean.

## 6. Applying to the seven live conflicts

After the release lands on both installs, each of the seven is resolved with
`resolve_work_sync_conflict` on the side that gives way, per record, by the
operator. Six have different titles on the two sides, so this is a content
decision, not a timestamp rule.
