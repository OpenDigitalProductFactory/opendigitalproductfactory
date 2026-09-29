---
status: active
---

# Open-source platform work is public by default: design

- **Backlog item:** `BI-0A5EE9C1`
- **Decision:** WWMD `DI-5E19848444FC`. The option "derive at read" was chosen with high confidence and a margin of 6.7 over "flip the schema default" and "grant clearance by hand".
- **Operator direction (2026-09-29):** "The default for coding should be public, as this is an open-source platform and it's publicly available already."

## Problem

Workroom access fails for platform work even though everything involved is already public:

- Every backlog item is stored as `internal` by default (`work-coordination.prisma`, `BacklogItem.sensitivity`).
- Every Workroom's required clearance also falls back to a hard-coded `"internal"` in `workroom-agent-access.server.ts` and `workroom-assistant-invitation.ts`.
- `appendRoomPolicyParticipant` (`room-policy.ts`) writes `internal` into the case policy whenever anyone is invited.
- AI coworkers are cleared for `{public}`, so each of them is refused with `insufficient-clearance` in every room.

Reproduced on `origin/main` at 6f876d19 with the new test in `workroom-agent-access.server.test.ts`: a public-cleared coworker in a room serving a platform item gets `discover` instead of `action`. The test passes after the fix.

Candidate causes ruled out by running them:

- **The request_coworker refusal on BI-814F86E1.** It was a packet-equality mismatch, not clearance. The exact server packets dispatched on 2026-09-29.
- **The Prisma default alone.** Changing it would not reach the room check, which never reads the item.

## Design

1. **Rule.** `effectiveBacklogSensitivity()` in `apps/web/lib/federation/cross-org-sharing.ts`:
   - `confidential` and `restricted` always stand;
   - platform work (`scopeKind` of `platform` or `common`, or the `dpf-portal` product) reads as `public`;
   - everything else keeps its stored value, which is `internal` by default and fails closed.

   `isPlatformScopedDemand`, the cross-organization sharing gate, is deliberately unchanged.
2. **Room ceiling.** `resolveRoomSensitivityCeiling()` (`apps/web/lib/work-management/room-sensitivity-ceiling.server.ts`) takes the first of:
   - the ceiling declared on the room boundary;
   - the effective sensitivity of the linked backlog item, matched by either key shape;
   - `internal`.

   It is used by the Workroom access check and the assistant invitation check. A case-policy ceiling that someone actually set still stacks on top.
3. **No invented ceilings.** Invites no longer write `internal` into the case policy, and `readWorkspaceRoomPolicy` reports an absent ceiling as absent. Callers that need a fallback still apply `internal`.
4. **Governed change.** `update_backlog_item` accepts `sensitivity`, validated against the closed vocabulary and audited as a `sensitivity_changed` activity.

The stored value is derived at read time, not backfilled. This covers the dozen or more create paths that bypass ingest, and items reclassified after they were created, with no migration.

## Out of scope

- Duplicate coworker identities in the data-access editor. The second half of `BI-0A5EE9C1` is filed separately.
- Case-policy snapshots that already hold `internal` from earlier invites stay enforced. They cannot be told apart from a deliberate choice.

## Research & Benchmarking

- **GitHub:** a repository's visibility, public or private, governs issues and pull requests. Public repositories default to world-readable collaboration.
- **GitLab:** project visibility (public, internal or private) sets the default. Individual issues can be marked confidential to close them. DPF adopts this model: public by default for open work, with a per-item confidential override.
- **Linear:** team-level privacy with no per-issue classification. Rejected, because DPF needs per-item closure for security findings.
