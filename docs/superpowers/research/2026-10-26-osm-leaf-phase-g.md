---
title: Open-source-management leaf Phase G research
date: 2026-10-26
status: chosen
backlogItem: BI-015012AA
workroom: WC-11DD9FFD
---

# Open-source-management leaf — Phase G research (BI-015012AA)

Large / archetype research for Coordinated Workrooms Phase G. This note is
the design choice: problem, comparables, options, the option chosen. It does
not approve implementation and does not replace the parent spec.

Operator pass (this thread): use the BI-015012AA set. Do not invent extra
rooms. Generic SaaS software-platform installs do not receive source-repository
rooms. Keep the current 5-parent/12-child layout, For Employees placement,
employee gates, and organisation-specific WWWD.

**Parent spec:** [2026-09-03-coordinated-workrooms-design.md](../specs/2026-09-03-coordinated-workrooms-design.md) §6.1, findings 8 and 9, Phase G.
**Parent plan:** [2026-09-03-coordinated-workrooms.md](../plans/2026-09-03-coordinated-workrooms.md) Phase G.

## Problem

The live install runs the generic `software-platform` leaf. That category has
exactly one leaf, and `operatesASourceRepository` keys on
`archetype.category === "software-platform"`, so every leaf in the category
receives the five source-operations rooms. Finding 8 is the missing leaf.
Finding 9 is the category gate.

Verified on this worktree at `7fedee279b8b5c2e0d86b68602522e0a96000c7f`
(origin/main):

- `packages/storefront-templates/src/archetypes/software-platform.ts` declares
  only `{ archetypeId: "software-platform", category: "software-platform" }`.
  There is no `open-source-management` leaf. Adding a second leaf under the
  same category is the existing pattern (`florist` under `retail-goods`).
- `packages/storefront-templates/src/standing-rooms.ts` still holds
  `SOURCE_OPERATING_CATEGORIES = new Set(["software-platform"])` and
  `operatesASourceRepository` reads the category. The file already records
  that this is a stop-gap: no OVSM property distinguishes "builds software"
  from "builds things", and adding that axis is follow-on work.
- The derived tree for a source-operating archetype is five top rooms plus
  seven universal children plus five software-delivery children: **5 parents
  and 12 children**. That is the live hierarchy the acceptance requires the
  migrated install to keep.
- `seed-storefront-archetypes.ts` upserts `ALL_ARCHETYPES`. A new leaf
  therefore appears as a `StorefrontArchetype` row on the next seed. The
  install's chosen leaf is `StorefrontConfig.archetypeId` (cuid FK to that
  row). Switching the live install is instance overlay, not archetype data.
- Phase F (PR #6614) derives roster from the same `operatesASourceRepository`
  gate. Once that lands, moving the gate to the leaf automatically moves the
  software-delivery specialists (`change-reviewer`, `portfolio-advisor`,
  `build-specialist`) with the rooms. This slice does not author a second
  roster table.

## Comparables

1. **TODO Group OSPO Definition 2.0.** An Open Source Program Office is the
   centre of competency for an organisation's open-source operations: policy
   for use, distribution, selection, audit and contribution; education;
   legal compliance; community engagement; inbound use of components and
   outbound contribution. The How is a framework of strategy, governance,
   compliance, and community — not a new org-chart. DPF **adopts** those
   four pillars as purpose coverage of standing rooms. DPF **rejects**
   standing up a named "OSPO office" coworker or a parallel hierarchy: the
   standing-room tree and the existing specialists are the office.

2. **OpenChain ISO/IEC 5230:2020** (open-source licence compliance) **and**
   **ISO/IEC 18974** (open-source security assurance). Both are process
   programmes with inbound, internal, and outbound inflection points: a
   written policy, trained people, a defined scope, a bill of materials,
   licence/security artefacts, and a community-engagement guideline. SPDX
   (ISO/IEC 5962) is named as an example artefact, not a required format.
   DPF **adopts** the inbound/internal/outbound split as how the seven
   operator concerns map onto existing rooms. DPF **rejects** shipping
   OpenChain certification, an SBOM pipeline, or SPDX generation in this
   slice — those are later instance programmes, not the leaf contract.

3. **InnerSource Commons / OSPO Alliance Good Governance Initiative.**
   InnerSource is open-source practice *inside* one organisation. GGI is a
   handbook for standing up an OSPO-like function. DPF **adopts** the
   reminder that the function must fit the organisation's existing structure.
   DPF **rejects** making this leaf an InnerSource programme: the operator
   directed a DPF-maintaining open-source *business* (adopters, resellers,
   partners), not an internal-collaboration overlay.

**Standard followed.** ISO/IEC 5230 for the shape of a licence/provenance
programme (policy, scope, inbound/outbound process points). NIST AI RMF
*Govern* from the parent spec for named human accountability on every
driven room. Employee-gated human stages on existing work shapes stay
human; this slice does not add approvers.

## Operator-named coverage, mapped onto the existing 12 children

The BI-015012AA set is seven *concerns*, not seven new room keys. Mapping
them onto the current source-operating tree keeps 5 parents / 12 children
and For Employees placement (`contributor-relations` + intake + coworker
fitness):

| Concern | Existing room(s) |
| --- | --- |
| Licence / provenance | `repository-policy-drift` under source-custody (the agreed policy, including licence and DCO) |
| Security / advisory | `dependency-advisory-watch` (inbound advisories) and `credential-hygiene` |
| Contribution flow | `contribution-flow` parent, `pull-request-flow`, `issue-triage`, `contributor-intake` |
| Community / adopter inquiry | `inquiry-response`, `adopter-health` |
| Release coordination | `release-readiness` |
| Upstream / downstream | `vendor-renewal` (outbound commitments) and `dependency-advisory-watch` (inbound components) |
| Partner / reseller | `adopter-health` (relationships that need attention) |

No new `shapeKey` is introduced. Roster follows rooms via the Phase F
contract once it is on `main`.

## Options considered

### A. Mint seven new standing rooms for the seven concerns

Rejected. That grows the child count and breaks the acceptance that the
migrated install retains its 5-parent/12-child hierarchy. It is also the
"author per archetype" failure standing-rooms already forbids: the next
OSM-like leaf would copy the seven keys by hand.

### B. Leaf gate plus mapped coverage (chosen)

Add `open-source-management` as a second leaf under category
`software-platform`. Change `operatesASourceRepository` from a category set
to a **leaf-id set** containing only `open-source-management`. Generic
`software-platform` then derives the five parents and seven universal
children (no source-operations rooms). The OSM leaf derives the current
17-room tree (5 + 12). Seed upserts the new `StorefrontArchetype` row.
Migrate this install by pointing `StorefrontConfig.archetypeId` at that
row through the existing storefront-config writer — instance overlay, no
install name, repository, or vendor in reusable archetype data.

Conformance tests flip with the gate: generic `software-platform` must
*not* receive `pull-request-flow-watch`; `open-source-management` must.
Demarcation tests stay: no forge hostname, token, or owner/repo in the
package.

### C. Keep the category gate; add the leaf only as storefront copy

Rejected. Finding 9 survives. Every future SaaS leaf in
`software-platform` would still receive contributor-intake and DCO rooms.

### D. Add a new OVSM "operates a source repository" axis and gate on that

Rejected for this slice. The standing-rooms comment already names that
axis as follow-on work. Phase G's owed change is the leaf gate the plan
states. An OVSM property can replace the leaf set later without changing
the room keys.

## Chosen

Option B.

Acceptance bullets this slice owes, quoted from the live BI body:

- The reusable leaf covers licence/provenance, security/advisory handling, contribution flow, community/adopter inquiry, release coordination, upstream/downstream relationships, and partner/reseller relationship work.
- A generic SaaS software-platform install does not receive source-repository rooms merely from sharing the category.
- The live install is configured to the new leaf and retains its 5-parent/12-child hierarchy, For Employees placement, employee gates, and organization-specific WWWD profile.
- `/ea/workrooms` and Operations show the leaf-derived room and roster coverage.
- Focused derivation/demarcation tests, production build, migration verification, live UX verification, and canonical runtime evidence pass.

## What this slice will not do

- Invent extra OSM rooms or a second roster table.
- Appoint owners or activate `coo-orchestrator` (Phase H).
- Dispatch stages or change authority.
- Put instance facts in `packages/storefront-templates`.
- Certify the install to OpenChain or emit SPDX.
- Rebuild the allocation board (BI-7AE90091).
- Change employee-gated human stages on existing work shapes.
