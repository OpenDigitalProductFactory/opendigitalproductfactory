---
title: Archetype roster contract Phase F research
date: 2026-10-26
status: chosen
backlogItem: BI-0536A59F
workroom: WC-067D9503
---

# Archetype roster contract — Phase F research (BI-0536A59F)

Medium research for Coordinated Workrooms Phase F. This note is the design
choice: problem, options considered, the option chosen. It does not approve
implementation and does not replace the parent spec.

**Parent spec:** [2026-09-03-coordinated-workrooms-design.md](../specs/2026-09-03-coordinated-workrooms-design.md) §6, findings 5 and 7, Phase F.
**Parent plan:** [2026-09-03-coordinated-workrooms.md](../plans/2026-09-03-coordinated-workrooms.md) Phase F.

## Problem

An archetype already declares which standing rooms a business of that kind
needs (`deriveStandingRooms`). It does not declare which AI coworkers those
rooms require, so an install cannot measure staffing against demand. Finding 5
is a count of active agents by value stream with no required set; finding 7 is
the missing contract.

Verified on this worktree at `2334b5c18b680b976145df81b793b7e34bd9314b`
(origin/main):

- `packages/storefront-templates/src/standing-rooms.ts` derives rooms from
  universal sub-rooms plus a `software-platform` category gate. Each driven
  room already carries a `shapeKey`.
- `apps/web/lib/work-management/standing-operations-shapes.ts` already names
  the specialist on every agent stage (`accountablePrincipalRef: "agent:…"`).
  Unique slugs for the standing set: `security-engineer`, `platform-engineer`,
  `change-reviewer`, `portfolio-advisor`, `build-specialist`,
  `customer-advisor`, `finance-controller`.
- `establish-coworker.ts` has no archetype argument. `loadRoster` /
  `RosterView` inventory the installed coworkers; they do not know what
  *should* be staffed.
- `COWORKER_AGENT_SEEDS` is the instance seed list. 39 registry identities
  without a persona stay unseeded by design. That is instance staffing, not an
  archetype contract.
- No `deriveRequiredRoster` / `requiredRoles` module exists under
  `packages/storefront-templates/src/` (the media-profile `requiredRolesFor`
  helper is image affordances, not coworkers).
- `/workforce` is the business identity directory. `/platform/ai/overview`
  already holds workforce health/coverage panels via `computeWorkforceSummary`.

## Comparables

1. **Kubernetes RBAC — Role vs RoleBinding.** A `Role` / `ClusterRole` names
   the permission set a kind of work requires. A `RoleBinding` names who fills
   it. The required set is reusable; the binding is per cluster (instance).
   Coverage is "are the required roles bound to a subject?" DPF **adopts** the
   split: archetype roster = Role, live `Agent` row = RoleBinding. DPF
   **rejects** inventing a new Prisma binding table — `Agent` plus
   `agent-identity` aliases already are the binding.

2. **NIST SP 800-181 Rev. 1 NICE Workforce Framework.** Work is expressed as
   Work Roles (a kind of job) independent of the people assigned. Organizations
   map those roles onto staff to see gaps. DPF **adopts** role-as-kind, not
   person-as-kind. DPF **rejects** importing NICE's TKS statement catalog: DPF
   already has agent slugs in `agent_registry.json` and accountable refs on
   work shapes.

3. **IT4IT / this repo's own orchestrator lattice.** Nine orchestrators
   (`coo-orchestrator` plus one per value stream) already declare
   `delegates_to` / `escalates_to`. Finding 5 is that lattice unmeasured.
   DPF **adopts** those nine as a platform-universal required set that every
   install must cover. DPF **rejects** authoring a second orchestrator list
   inside each leaf archetype — they are platform, not business-kind.

**Standard followed.** NIST AI RMF *Govern*: an automated actor may hold
responsibility only where a named accountability path exists. The roster is
that path for coworkers: the required role is derived from the room's shape,
and coverage names which required roles have no live agent.

## Options considered

### A. Per-leaf authored `requiredCoworkers[]` on `ArchetypeDefinition`

Each leaf lists the slugs it wants. Rejected. That is the "author per
archetype" failure standing-rooms already forbids. A new leaf would silently
get an empty roster.

### B. Derive the roster from standing rooms and their shapes (chosen)

`deriveRequiredRoster(archetype)` is a pure function next to
`deriveStandingRooms`. It uses the same gates. For each derived room with a
`shapeKey`, the required coworker is the unique `agent:` slug already named
by that shape. Groups (`shapeKey: null`) add no role.

`packages/storefront-templates` must not import the platform work-shape
module (standing-rooms already holds shape keys as strings for that reason).
A frozen `shapeKey → agentSlug` table lives in the archetype package; a
conformance test in `apps/web` asserts it equals the first agent stage of
`STANDING_SHAPES`. Drift fails the build.

Install coverage is a projector in `apps/web`: required slugs (archetype
roster ∪ the nine platform orchestrators) compared to live `Agent` rows via
`resolveCanonicalAgentId` / slug aliases. Missing roles are named. Staffed
means a selectable production coworker, not a draft or dual-seed ghost.

UI: extend `/platform/ai/overview` (existing health/coverage panels) with
staffed/required and the missing-role list. `/workforce` stays the identity
directory. No new `/ops` route. Do not implement allocation-board BI-7AE90091.

### C. Treat `loadRoster` as the contract

Rejected. That is instance inventory. It cannot say a role is missing.

### D. Wait for Phase G's operator-enumerated OSM roster

Rejected. Phase G adds a leaf and moves the source-ops gate. Phase F is the
generic contract every leaf must already resolve, including today's
`software-platform`. OSM contents stay for the operator pass.

## Chosen

Option B.

Acceptance bullets this slice owes, quoted from the live BI body:

- Every leaf archetype resolves a roster.
- Coverage is computed for an install and names missing roles.
- No instance-specific principal, customer, repository, or vendor fact appears in reusable archetype data.
- The live install reports staffed/required coverage with gaps named.
- Focused conformance tests, production build, live UX verification, and canonical runtime evidence pass.

## What this slice will not do

- Enumerate the open-source-management room set or roster (Phase G).
- Appoint owners or activate `coo-orchestrator` (Phase H).
- Dispatch stages or change authority.
- Put instance facts in `packages/storefront-templates`.
- Rebuild the allocation board (BI-7AE90091).
