# Workroom as the canonical name for what we claim and how we work

**Backlog item:** `BI-D2D190BF`
**Epic:** `EP-WORK-CONVERGENCE`
**Status:** Planned

## Problem

Founder-directed 2026-08-15: **Workroom** becomes the canonical name for the unit
of work we claim and the place we do it in, replacing **WorkCapsule**.

The name is not free. Two concepts already carry it, and they mean different
things:

| | WorkCapsule | WorkRoom |
| --- | --- | --- |
| Kind | durable record | projection / view layer |
| Storage | Prisma model (`schema.prisma:2275`) + `WorkCapsuleActivity` (`:2347`) | none |
| Anchors | `backlogItemId`, `epicId`, `featureBuildId` | `WorkCase` |
| Carries | `headBranch`, `baseSha`, `worktreePath`, `leaseHolderPrincipalId`, `leaseExpiresAt`, `pullRequestNumber`, `scopeClaims` | `WorkRoomView`, `WorkRoomCycle`, `WorkRoomOutcomePacket`, participants |
| Inbound FKs | 4 (`WorkCapsuleActivity`, `RuntimeTarget`, `RuntimeVerification`, `ExternalEvidenceRecord`) | n/a |
| Reach | ~174 files (`WorkCapsule`), 111 (`workCapsule`), 83 (`work_capsule`), 142 (`work-capsule`) | ~42 files |
| Owning epics | `EP-WORK-CONVERGENCE` | `EP-WORKROOM-COMMS`, `EP-DELIBERATION-ROOMS` (both done) |

A mechanical rename would produce two different `Workroom`s — a table and a view
vocabulary — which is a worse naming problem than the one being fixed.

**Decision: converge both into one concept named Workroom.** The record and the
room are the same thing: the place work is claimed, worked, discussed and
evidenced. This is the naming half of `EP-WORK-CONVERGENCE`, whose thesis
already treats the durable work unit and its collaboration surface as one
architecture.

Rejected alternatives: capsule-takes-the-name-and-the-view-layer-is-renamed
(keeps two concepts, churns shipped code for no conceptual gain);
labels-and-docs-only (code keeps saying capsule — the drift this is meant to
end); spec-first (`EP-WORK-CONVERGENCE` is already the ratified spec).

## Constraints

- **Alias window, never a flag day.** MCP tool names are a client-visible
  contract held by external Claude/Codex/Grok clients and by other installs.
  Repo precedent is `BI-765B9F39` (Phase 5), which shipped a top-level rename
  *with* an alias rather than a hard cut.
- **Migrations are forward-only and must apply against any existing data state**
  (AGENTS.md §2). 285 live rows must survive.
- **`TOOL_TO_GRANTS` denies unlisted tools.** Every renamed tool needs its grant
  row before the alias retires, or the rename reads as an authorization failure.
- **The skill pack is dual-surface** (AGENTS.md §11): authored once at
  `packages/dpf-skill-pack/skills/<slug>/SKILL.md`, seeded to in-portal
  coworkers. A rename there reaches both the CLI plugin and seeded coworkers.
- **Doctrine is in scope.** AGENTS.md §12 states "The unit of WIP is the
  WorkCapsule". The rename is not complete while the rulebook disagrees.

## Phases

### Phase 1 — Schema (`BI-7BE9D81D`)

Rename model `WorkCapsule` -> `Workroom` and `WorkCapsuleActivity` ->
`WorkroomActivity`; rename the four inbound FK columns `workCapsuleId` ->
`workroomId`.

Open decision to settle in implementation: whether to keep the physical table
name via `@@map` for one release, decoupling the logical rename from a physical
table move. Prefer `@@map` — it makes the migration a metadata change over live
rows and keeps rollback cheap. State the choice inline in the migration.

Gates: migration-applies-cleanly, table classification, stewardship exemption,
`packages/db` generated-client regeneration.

### Phase 2 — Vocabulary (`BI-C2C16582`)

The collision *is* the work. Fold `WorkRoomView`, `WorkRoomCycle`,
`WorkRoomOutcomePacket`, `WorkRoomCycleView`, `WorkRoomParticipant*`,
`WorkRoomActivityView` and `authorizeWorkRoomAccess` onto the Workroom concept
rather than leaving them beside a record of the same name.

Document the resulting boundary explicitly: what is a **Workroom** (durable),
what is a **Workroom projection** (view), and where **WorkCase** still owns
business-language framing. Without that written down, the two vocabularies will
re-diverge.

Gates: module-size ratchet, prose-lint baseline, route manifest, UX verification
on `workspace/cases/[caseKey]`.

### Phase 3 — MCP tools (`BI-0702869B`)

Rename `create_work_capsule`, `get_work_capsule`, `list_work_capsules`,
`update_work_capsule_status`, `claim_capsule_scope`, `release_capsule_scope`,
`heartbeat_capsule`, `plan_capsule_worktree`, `record_capsule_evidence`,
`reassign_capsule_executor`, `adopt_worktree` to workroom names behind aliases.

Old names stay live and logged for the deprecation window; `TOOL_TO_GRANTS` and
`agent_registry.json` `tool_grants` gain the new rows before any alias retires.

### Phase 4 — Doctrine (`BI-5FD7DCDB`)

AGENTS.md §12, the kernel principles that name the capsule, the five affected
skills, the architecture runbooks, `docs/user-guide/workspace/work-rooms.md`,
and the specs/plans corpus. Preserve the original founder-directed 2026-06-26
attribution and add the 2026-08-15 rename beside it.

## Sequencing

Phase 1 is the hinge — Phases 2 and 3 both read the renamed model. Phase 4 is
independent and can land first or last; landing it early makes the rulebook lie
about code that has not moved yet, so prefer last.

## Out of scope

Two findings surfaced while scoping this, both real, both filed separately —
they are claim-integrity defects, not naming:

- Only 3 of 62 unproposed remote branches had any Workroom/WorkCapsule claim.
- 146 of 148 live capsules point at a `headBranch` that no longer exists on the
  remote (145 of those predate this session's branch cleanup).

Renaming the concept does not fix either. Folding them in would make this
rename unshippable.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-D2D190BF`
- Receipt: `cmsux1vaz26kg01ppgtsr711j`
- Rationale: each phase ships independently behind the alias window; schema is the hinge for vocabulary and tools, doctrine is independent.
- Dependencies: schema -> `BI-7BE9D81D`; vocabulary -> `BI-C2C16582` (depends on schema); mcp-tools -> `BI-0702869B` (depends on schema); doctrine -> `BI-5FD7DCDB`
