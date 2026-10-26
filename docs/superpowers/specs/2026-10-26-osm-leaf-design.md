---
title: Open-source-management leaf (Coordinated Workrooms Phase G)
date: 2026-10-26
status: proposed
backlogItem: BI-015012AA
workroom: WC-11DD9FFD
profile: archetype
parentSpec: 2026-09-03-coordinated-workrooms-design.md
research: 2026-10-26-osm-leaf-phase-g.md
---

# Open-source-management leaf — Phase G design (BI-015012AA)

Canonical design for Coordinated Workrooms Phase G. Extends
[2026-09-03-coordinated-workrooms-design.md](2026-09-03-coordinated-workrooms-design.md)
§6.1. It does not replace that spec, appoint owners, or activate
`coo-orchestrator` (Phase H).

Operator pass (this thread): use the BI-015012AA set. Do not invent extra
rooms. A generic SaaS `software-platform` install does not receive
source-repository rooms. Keep the current 5-parent/12-child layout on the
migrated install, For Employees placement, employee gates, and
organisation-specific WWWD.

**Research:** [2026-10-26-osm-leaf-phase-g.md](../research/2026-10-26-osm-leaf-phase-g.md)
(option B, receipt `initiative-8bc3d757-d26b-4f39-929f-a95062286af9`).
**Plan (parent):** [2026-09-03-coordinated-workrooms.md](../plans/2026-09-03-coordinated-workrooms.md)
Phase G.

## 1. Problem

The live install runs the generic `software-platform` leaf. That category
has one leaf, and `operatesASourceRepository` keys on
`archetype.category === "software-platform"`, so every leaf in the
category receives the five software-delivery rooms. Finding 8 is the
missing leaf. Finding 9 is the category gate.

Verified on this worktree at `7fedee279b8b5c2e0d86b68602522e0a96000c7f`:

- `packages/storefront-templates/src/archetypes/software-platform.ts`
  declares only `{ archetypeId: "software-platform", category: "software-platform" }`.
- `packages/storefront-templates/src/standing-rooms.ts` holds
  `SOURCE_OPERATING_CATEGORIES = new Set(["software-platform"])`.
- Derived tree for a source-operating archetype: five top rooms + seven
  universal children + five software-delivery children (**5 parents /
  12 children**). That is the hierarchy the migrated install must keep.
- `contributor-intake` is **universal**, not software-delivery. A SaaS
  leaf still receives it. What the SaaS leaf must stop receiving are the
  five `SOFTWARE_DELIVERY_SUB_ROOMS` (advisory, repository policy / DCO,
  pull-request flow, issue triage, release readiness).
- `StorefrontConfig.archetypeId` is a cuid FK to `StorefrontArchetype.id`.
  The slug lives on `StorefrontArchetype.archetypeId`. Seed upserts
  `ALL_ARCHETYPES`. Switching an install is instance overlay.

## 2. Objectives

**OBJ-LEAF:** `open-source-management` exists as a second leaf under
category `software-platform`, following the florist-under-retail-goods
pattern.

**OBJ-GATE:** `operatesASourceRepository` is true only when
`archetype.archetypeId` is in a leaf-id set that contains
`open-source-management` and does not contain `software-platform`.

**OBJ-SAAS:** `deriveStandingRooms` for generic `software-platform`
returns the five parents and seven universal children, and does not
include `pull-request-flow-watch`.

**OBJ-COVER:** The seven operator concerns are covered by existing room
keys. No new `shapeKey` is introduced.

**OBJ-TREE:** `deriveStandingRooms` for `open-source-management` returns
the current 17-room tree (5 + 12). For Employees stays on
`contributor-relations` + `contributor-intake` + `coworker-fitness`.

**OBJ-MIGRATE:** After seed, this operator install points
`StorefrontConfig.archetypeId` at the OSM row through the existing
storefront writer, without wiping operator identity or live storefront
content, and without putting an install name in reusable archetype data.

**OBJ-DEMARC:** `packages/storefront-templates` still contains no forge
hostname, token, owner/repo coordinate, or operator-install name.

**OBJ-ROSTER:** Roster follows rooms via the Phase F
`deriveRequiredRoster` contract once that contract is on `main`. This
slice does not author a second roster table.

**OBJ-UX:** `/ea/workrooms` and Operations show the leaf-derived rooms.
`/platform/ai/overview` shows roster coverage after Phase F is live. No
new route is added.

Acceptance bullets, quoted from the live BI body:

- The reusable leaf covers licence/provenance, security/advisory handling, contribution flow, community/adopter inquiry, release coordination, upstream/downstream relationships, and partner/reseller relationship work.
- A generic SaaS software-platform install does not receive source-repository rooms merely from sharing the category.
- The live install is configured to the new leaf and retains its 5-parent/12-child hierarchy, For Employees placement, employee gates, and organization-specific WWWD profile.
- `/ea/workrooms` and Operations show the leaf-derived room and roster coverage.
- Focused derivation/demarcation tests, production build, migration verification, live UX verification, and canonical runtime evidence pass.

## 3. Operator-named coverage (BI-015012AA set)

Seven *concerns*, not seven new room keys:

| Concern | Existing room(s) |
| --- | --- |
| Licence / provenance | `repository-policy-drift` under source-custody (agreed policy, including licence and DCO) |
| Security / advisory | `dependency-advisory-watch` and `credential-hygiene` |
| Contribution flow | `contribution-flow` parent, `pull-request-flow`, `issue-triage`, `contributor-intake` |
| Community / adopter inquiry | `inquiry-response`, `adopter-health` |
| Release coordination | `release-readiness` |
| Upstream / downstream | `vendor-renewal` and `dependency-advisory-watch` |
| Partner / reseller | `adopter-health` |

Employee-gated human stages on those shapes stay human. This slice does
not add approvers.

## 4. Chosen shape (research option B)

Add the leaf. Change the gate from a category set to a leaf-id set.
Generic `software-platform` then derives 5 + 7. OSM derives 5 + 12.

Rejected in research (do not reopen in implementation):

- **A** — mint seven new standing rooms. Breaks retain-5/12.
- **C** — keep the category gate and add storefront copy only. Finding 9 survives.
- **D** — new OVSM "operates a source repository" axis. Follow-on; standing-rooms.ts already records it.

### 4.1 Leaf declaration

Append one `ArchetypeDefinition` to `softwarePlatformArchetypes` in
`packages/storefront-templates/src/archetypes/software-platform.ts`:

- `archetypeId: "open-source-management"`
- `category: "software-platform"`
- `ctaType: "inquiry"` (same as the generic leaf)
- Reuse `PLATFORM_CONTACT_FIELDS`
- Storefront items describe a business that **publishes and maintains an
  open-source product** (adopters, contributors, partners). They do not
  name this operator install, a forge, or a repository.
- No `activationProfile` unless a test requires one. Category defaults
  already give subscription commercial model, TENANTS twin board, and
  `EP-VERTICAL-SOFTWARE` readiness. Do not add `partner-program`
  capability solely for this leaf; partner/reseller work is the
  `adopter-health` room.

`ALL_ARCHETYPES` already spreads `softwarePlatformArchetypes`. Seed
`seedStorefrontArchetypes` upserts the new `StorefrontArchetype` row on
the next seed. `marketingSkillRules` key on **category**, so OSM inherits
the software-platform marketing reframes.

Category-keyed tables that must keep working for both leaves without
edits: `operational-value-stream.ts`, `twin-profile.ts` (TENANTS),
`processing-activity-templates.ts`, `archetype-readiness.ts`,
`CATEGORY_FLAVOR_DEFAULTS`. A per-leaf `demo-flavor` entry is optional;
absence falls back to the category notes.

### 4.2 Leaf-id gate

In `packages/storefront-templates/src/standing-rooms.ts`:

```
const SOURCE_OPERATING_LEAVES: ReadonlySet<string> = new Set(["open-source-management"]);

export function operatesASourceRepository(archetype: ArchetypeDefinition): boolean {
  return SOURCE_OPERATING_LEAVES.has(archetype.archetypeId);
}
```

Replace `SOURCE_OPERATING_CATEGORIES`. Update the comment: the stop-gap
is now a **leaf-id set**, still not an OVSM axis. Adding that axis remains
follow-on and must not mint new room keys.

`deriveStandingRooms` is unchanged except that it calls the new
predicate. `STANDING_ROOM_PARENT_BY_KEY` stays a property of room **key**,
not of which leaf includes the room.

### 4.3 Tests that must flip

`standing-rooms.test.ts` today asserts generic `software-platform`
receives source-operations rooms. After this slice:

- Generic `software-platform` must **not** include
  `pull-request-flow-watch` (and the other four software-delivery shapes).
- `open-source-management` must include all five.
- Florist and every other non-OSM leaf must still not include them.
- The existing "adds the source-operations rooms only to …" loop stays,
  keyed off `operatesASourceRepository`.
- Demarcation sweep still fails on forge hostnames, tokens, and
  owner/repo coordinates.

`archetypes.test.ts` gains: OSM exists, category is `software-platform`,
ctaType is inquiry. Keep the existing "software-platform archetype for
DPF-style product sellers" case on the generic leaf.

`seed-storefront-archetypes.test.ts` gains an upsert for
`open-source-management`.

`twin-profile.test.ts` "every seeded software-platform archetype is the
TENANTS board" already iterates the category and must stay green.

Phase F (`packages/storefront-templates/src/standing-roster.ts`) currently
phrases the source-ops roster gate as "when the **category** operates a
source repository". Implementation of this slice merges `origin/main`
after Phase F lands, then updates that test and any
`operatesASourceRepository` call site to the leaf-id meaning. This slice
does not edit `standing-roster.ts` while Phase F holds it.

### 4.4 Instance migration

Existing writer: `resetStorefrontArchetype` in
`apps/web/lib/storefront/archetype-reset.ts`. It already takes a slug
(`targetArchetypeId`), resolves the `StorefrontArchetype` row, and writes
`StorefrontConfig.archetypeId` to that row's cuid.

Its only mode today is `replace-seeded-content`, which **deletes** live
storefront sections and items. That is too destructive for a production
install that already has operator content.

Add a second mode, `retarget-archetype`:

- Update `StorefrontConfig.archetypeId` to the OSM row.
- Preserve org name, slug, and tagline (existing identity path).
- Keep `organization.industry` as `software-platform` (category unchanged).
- Re-run `applyBusinessCapabilityPerspective` and
  `projectOperationalValueStreamForArchetype` so capability and OVSM
  projections follow the new slug.
- Do **not** delete storefront sections or items.
- Do **not** branch on an install name, hostname, or repository.

After canonical-runtime deploy (seed has created the OSM row), call that
mode on this operator install. Record the write as migration evidence.
Do not SQL-patch `StorefrontConfig`. Do not put the install name in
`packages/storefront-templates`.

Standing rooms on this install already materialize the 5/12 tree because
the category gate currently hands software-delivery rooms to
`software-platform`. OSM derives the same keys, so containment
(`standing-room-nesting.ts`) is a no-op for those keys. Employee gates
and organisation-specific WWWD are instance overlay and stay put.

A future SaaS install that stays on generic `software-platform` will stop
deriving the five software-delivery rooms. Existing materialized
software-delivery rooms on such an install are out of scope for this
slice; do not add a mass-retire in this PR.

### 4.5 UX

No new route. `/ea/workrooms` is the architecture definition home;
`/ops/workrooms` is the operations inventory (Phase E). Both read
derived rooms. Roster coverage on `/platform/ai/overview` is Phase F.

The new leaf appears on the existing `/storefront/setup` archetype grid
because the grid reads `ALL_ARCHETYPES`. Do not add a picker. If that
route is budget-frozen, record ux-fit against the existing route rather
than minting `/ops/osm`.

## 5. Schema and substrate

No new Prisma model, enum, MCP tool, or work-shape. No new
`WorkroomRelation` kind. Seed writes one more `StorefrontArchetype` row
through the existing upsert. Instance state is the existing
`StorefrontConfig.archetypeId` FK.

Scale ceiling: `deriveStandingRooms` copies three frozen arrays
(≤17 rooms) per leaf. `ALL_ARCHETYPES` is tens of leaves today; the
function stays O(rooms) per call. Room materialization is per install and
bounded by that same 17. The epic that would lift a future "thousands of
custom rooms per install" is not this one.

## 6. Files this slice will touch (implementation, after independent review)

| Path | Change |
| --- | --- |
| `packages/storefront-templates/src/archetypes/software-platform.ts` | OSM leaf |
| `packages/storefront-templates/src/standing-rooms.ts` | leaf-id gate |
| `packages/storefront-templates/src/standing-rooms.test.ts` | SaaS isolation + OSM 5/12 |
| `packages/storefront-templates/src/archetypes/archetypes.test.ts` | OSM exists |
| `packages/db/test/seed-storefront-archetypes.test.ts` | OSM upsert |
| `packages/storefront-templates/src/standing-roster.ts` | only after Phase F is on `main` |
| `apps/web/lib/storefront/archetype-reset.ts` | `retarget-archetype` mode |
| `docs/superpowers/specs/2026-09-03-coordinated-workrooms-design.md` | §6.1 points here |

## 7. Safety

- Ownership never widens authority (parent spec §7).
- Derivation may name an owner; it may never name an approver.
- Employee-gated stages stay human.
- No stage dispatch.
- Instance facts stay out of the archetype package.

## 8. Non-goals

- Extra OSM rooms or a second roster table.
- Phase H appointments / `coo-orchestrator` / retiring `WC-42C558DD`.
- OpenChain certification or SPDX generation.
- Allocation board BI-7AE90091.
- October 25 COO follow-through (BI-4B48E7FE / BI-756C899D / BI-C43FD3E5).
- Moving `contributor-intake` out of the universal set.
- An OVSM operating-model axis.

## 9. Risks and rollback

- **Storefront wipe.** Mitigated by `retarget-archetype` (no
  `replace-seeded-content` on the live install).
- **SaaS still getting source-ops rooms.** Mitigated by the flipped
  standing-rooms tests.
- **5/12 lost on the migrated install.** Mitigated because OSM is the
  only leaf in the new set, so it keeps software-delivery rooms.
- **Phase F file conflict.** Implementation merges `origin/main` after
  PR #6614; do not edit `standing-roster.ts` until then.
- **Rollback.** Revert the leaf and restore the category set; retarget
  `StorefrontConfig` back to the generic row. Room keys are unchanged for
  this operator install, so containment rows stay valid.

## 10. Verification

Red tests first (`dpf-tdd`): SaaS isolation, OSM 5/12, florist unchanged,
demarcation still empty, seed upsert, retarget mode preserves items.

Then: package tests for `storefront-templates` and the reset writer;
`pnpm --filter web typecheck` if web files change; production build in
merge-queue; live `/ea/workrooms` after canonical deploy and retarget;
roster coverage on `/platform/ai/overview` once Phase F is served.

Infrastructure failure is unrun, never pass.
