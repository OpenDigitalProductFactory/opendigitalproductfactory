---
status: draft
date: 2026-08-30
backlog_items:
  - BI-EFFD97B4
  - BI-4CB2EF76
epic: EP-1FABA22D
workroom: WC-736F50D3
---

# Workroom definition and persisted roster contracts

## 1. Outcome and scope

This design delivers one reversible foundation pair:

- `BI-EFFD97B4` makes each Workroom definition declare how work starts, the
  maximum tool authority permitted inside the room, and the measures by which
  the room is read.
- `BI-4CB2EF76` persists which canonical Principals belong to a Workroom and
  which typed roles they occupy.

The pair does not activate the Process Overseer. `BI-3913EB49` later consumes
these contracts to compare declared shape with observed execution.

**OBJ-WR-001:** A versioned Workroom definition declares trigger, tighten-only
tool-grant ceiling, and measure bindings without creating a second scheduler,
authority store, or metrics engine.

**OBJ-WR-002:** Workroom membership and role occupancy survive presence loss and
are keyed to canonical `Principal` identity rather than user- or agent-specific
foreign keys.

**OBJ-WR-003:** One read projection distinguishes persisted membership, live
presence, work state, occupied roles, missing roles, and legacy-derived rooms
without changing the existing access ladder.

## 2. Research grounding

The broader research and standards analysis remains in
[`2026-08-30-paaw-competence-evolution-workroom-design.md`](2026-08-30-paaw-competence-evolution-workroom-design.md).
This bounded delivery adopts three findings:

1. [PAAW Candidate 0.2.0](https://arxiv.org/html/2608.27454) treats agentic work
   as explicit, inspectable practice rather than an opaque prompt. DPF adopts
   declared triggers, authority ceilings, roles, and measures; it rejects a
   parallel research-agent runtime.
2. Anthropic's
   [automated alignment researchers](https://alignment.anthropic.com/2026/automated-alignment-researchers/)
   separate generation, evaluation, and oversight. DPF adopts typed role
   occupancy and visible missing-role conformance; it rejects presence as proof
   of membership or independence.
3. Anthropic's
   [automated weak-to-strong researcher](https://alignment.anthropic.com/2026/automated-w2s-researcher/)
   reinforces evaluator independence and measurable iteration. DPF adopts
   explicit measures and role separation; it rejects authority expansion or
   self-approval caused merely by entering a room.

The project-specific reason for persisting the roster is continuity: transient
presence, assignment, and conversation lineage currently approximate who is in
a room, but none is the durable membership fact.

## 3. Existing substrate

- `Workroom` is the canonical room instance in
  `packages/db/prisma/schema/work-coordination.prisma`.
- `Principal` and `PrincipalAlias` are the canonical identity substrate.
- `WorkCaseSourceRegistryEntry` is the versioned definition registry.
- `RecurrenceSchedule` already owns recurrence; cadence triggers use RFC 5545
  rules and do not schedule work themselves.
- `AgentToolGrant` remains the standing authority source. A room grant is only a
  ceiling intersected with standing grants.
- `WorkItemPresence` remains a short-lived heartbeat read.
- `projectWorkroomParticipants` and the Prisma participant loader already merge
  policy, assignment, conversation lineage, coordinator derivation, and
  presence. They are refactored into one projection rather than duplicated.

## 4. Definition contract (`BI-EFFD97B4`)

`WorkCaseSourceRegistryEntry` gains:

- `trigger`: `event`, `cadence`, `threshold`, or `null` for genuinely imperative
  rooms. Cadence carries an RFC 5545 rule; threshold names one declared measure.
- `toolGrant.grantKeys`: a room ceiling. Effective keys are the intersection
  with the participant's standing grants. Missing standing grants are refused,
  never conferred.
- `measures`: stable key, operator label, and existing metric binding key. An
  unresolved binding reports unmeasurable, never zero.

Every registry entry advances its definition version because its contract
changes. Existing `scheduled` and `bookkeeping-period` rooms become cadence
definitions without changing their execution behavior.

## 5. Persisted roster (`BI-4CB2EF76`)

Add normalized membership and role relations:

- one membership per `(workroom, principal)`;
- zero or more typed role assignments using the existing
  `WorkroomParticipantRole` vocabulary;
- membership metadata: work state, admission time, admission reason, and
  current-work summary;
- foreign keys to `Workroom` and canonical `Principal`, with indexed room and
  principal lookup paths.

Presence is not stored on membership. Authority is not stored on membership.
Sponsor and authority summaries remain derived from canonical identity and
authority sources. Membership deletion cascades its role assignments; deleting
a Principal or Workroom follows existing stewardship policy rather than
silently reassigning identity.

Existing rooms are not bulk-inferred during migration. The loader prefers
persisted membership when present and otherwise exposes a labelled
`legacy-derived` projection from existing policy, assignment, conversation, and
coordinator sources. Presence can decorate either projection but cannot create
membership, a role, or access.

## 6. Read model and UI

One pure roster projection merges persisted membership metadata with derived
identity, role, lineage, and presence facts. It returns:

- participant identity and membership source;
- typed roles and work state;
- presence as a separate, time-bounded value;
- occupied required roles and missing required roles;
- source references sufficient to explain each result.

The existing Workroom participant surface uses existing theme-aware report
primitives. It labels membership separately from presence, never renders
`unknown` presence as absence, and shows missing required roles as conformance
information rather than silently inventing occupants. Narrow/wide and
light/dark layouts must preserve this distinction.

The access ladder remains `none | discover | content | action`. Persisted
membership contributes to admission; presence does not. Room grants still
intersect standing grants and cannot raise access.

## 7. Scale, security, and rollback

Roster reads are bounded to one Workroom and use indexed foreign keys. No fleet
scan or all-room reconciliation is introduced. The intended first ceiling is
hundreds of participants and roles in one room; Process Overseer work under
`EP-1FABA22D` owns any later cross-room reconciliation strategy.

Security invariants:

- canonical Principal identity only;
- no presence-to-membership promotion;
- no room-to-standing-grant promotion;
- independent reviewer and approver roles remain distinct where required;
- every compatibility fallback is visibly sourced.

Rollback stops new membership writes and returns the loader to the labelled
legacy-derived projection. Additive tables and definition fields remain
readable until a forward migration removes them; rollback never converts
presence rows into membership.

## 8. Delivery and verification

The two BIs ship in one PR because definition declares the required room shape
and roster records its occupancy. They remain separate commits/evidence outcomes
inside that PR. Four of twenty effort units are reserved for consolidating the
existing participant merge paths behind the pure projection.

Verification is test-first:

- definition completeness, version, cadence compatibility, measure binding, and
  grant-intersection tests;
- migration apply and generated-client/schema checks;
- persisted membership, multiple-role, presence-loss, missing-role, legacy
  fallback, loader, and access-regression tests;
- participant component tests and narrow/wide, light/dark inspection;
- exact-tree merged-code and migration smoke in the shared local-CI environment.

## 9. Acceptance statements

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-WR-001 | OBJ-WR-001 | Every registered room definition declares a versioned trigger or explicit imperative `null`, a tighten-only grant ceiling, and at least one resolvable measure binding. |
| AC-WR-002 | OBJ-WR-001 | Scheduled and bookkeeping-period rooms retain their existing behavior while using the canonical recurrence grammar. |
| AC-WR-003 | OBJ-WR-002 | Persisted membership survives loss of all presence rows and preserves every occupied typed role. |
| AC-WR-004 | OBJ-WR-002 | One Principal with multiple roles is stored once with normalized role assignments; presence and room grants confer neither membership nor standing authority. |
| AC-WR-005 | OBJ-WR-003 | Existing rooms without roster rows retain access and participant visibility through an explicitly labelled legacy-derived path. |
| AC-WR-006 | OBJ-WR-003 | The Workroom surface visibly distinguishes membership, presence, work state, and missing required roles across supported viewport and theme variants. |
| AC-WR-007 | OBJ-WR-003 | Process Overseer enforcement remains inactive until `BI-3913EB49`; this delivery supplies contracts only. |
