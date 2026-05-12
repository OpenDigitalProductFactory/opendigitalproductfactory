# 2026-05-11 Licensing, Permit, and Jurisdictional Readiness Foundation Plan

**Epic:** `EP-LIC-C64FC2` Licensing, Permit, and Jurisdictional Readiness: Archetype-Aligned Compliance Foundation

**Goal:** Turn the licensing/permitting design into a buildable, phased platform capability rooted in Compliance, with clean ties to archetypes, finance, staff, and marketing.

## 1. Scope For The First Delivery Track

The first delivery track should establish licensing readiness, not full licensing automation.

Included:

- schema foundation for requirement references and license records
- Compliance workspace for organization licenses, person credentials, display obligations, fees, and issues
- coworker investigation prompts and operational issue creation
- bootstrap reference seed for USA, UK, and Australia
- cross-links into Finance, Staff, and Marketing

Deferred:

- broad Canada/EU/South America seed coverage beyond initial design research
- portal submission automation across authority sites
- deep profession-specific workforce workflows
- payment execution beyond linked fee tracking and reminders

## 2. Work Breakdown

### BI-LIC-7D476E

**Research & spec the licensing, permit, and legality investigation capability**

Deliverables:

- final spec review and acceptance
- authoritative source inventory for priority jurisdictions
- archetype-to-investigation heuristic inventory

Exit criteria:

- spec accepted by product owner
- official bootstrap source list captured for USA, UK, Australia

### BI-LIC-F36A08

**Design the domain model for jurisdictional license requirements and organization/person credentials**

Implementation targets:

- add reference model for requirement intelligence
- add organization-held licensing records
- add person-held credential records
- add display obligation and fee schedule records
- add issue model for readiness blockers

Exit criteria:

- migration applies cleanly
- schema does not overload tax-remittance tables
- cross-domain ownership is explicit

### BI-LIC-3621D8

**Add archetype-aware coworker investigation flow for licensing and permit readiness**

Implementation targets:

- prompt/routing context for licensing investigation
- classification of existing vs new vs expansion setup
- archetype-aware question guidance
- live-verification issue creation

Exit criteria:

- coworker uses dedicated dialog UX
- operational pages remain factual
- investigation can persist findings into structured records

### BI-LIC-247DB1

**Add compliance workspace surfaces for licensing, display obligations, fees, and staff qualifications**

Implementation targets:

- `/compliance` licensing workspace
- organization licenses list/detail
- staff credentials list/detail
- display obligations view
- fee/renewal readiness view
- open issues and evidence links

Exit criteria:

- inspectable operational state exists outside the coworker conversation
- Compliance becomes the source of truth for licensing posture

### BI-LIC-AA90DB

**Seed and refresh jurisdiction bootstrap data for licensing and permit investigation**

Implementation targets:

- seed format for requirement/authority bootstrap data
- first coverage set for USA, UK, Australia
- provenance and freshness fields
- refresh-from-research fallback pattern

Exit criteria:

- coworker has enough seed data to start intelligently
- seed is clearly non-authoritative

## 3. Recommended Build Order

1. `BI-LIC-7D476E` finalize research/spec acceptance
2. `BI-LIC-F36A08` schema and model foundation
3. `BI-LIC-AA90DB` bootstrap seed format and initial data
4. `BI-LIC-247DB1` Compliance workspace operational surfaces
5. `BI-LIC-3621D8` coworker investigation behavior and cross-route prompts

Rationale:

- schema must exist before the workspace or coworker can persist truth
- the seed should exist before the coworker investigation flow is considered useful
- the operational workspace should exist before the coworker starts filling it

## 4. Data Stewardship Rules

- do not repurpose tax registration tables for licensing
- do not store licensing truth only in chat memory or notes
- do not make marketing or finance the canonical owner of license status
- use Compliance as the main operational home
- preserve person-held versus organization-held distinction

## 5. Verification Requirements

For each implementation slice:

1. unit tests for affected actions/components
2. production build with zero errors
3. UX verification in the running app
4. migration verification where schema changes are introduced

Additional acceptance for this epic:

- coworker dialog stays in dedicated coworker UX
- compliance operational page remains factual
- theme-aware styling rules are followed on any new UI

## 6. Follow-On Phases

### Phase 2

- Canada bootstrap coverage
- renewal reminders and fee tracking improvements
- better staff qualification linkage

### Phase 3

- EU bootstrap and regulated-profession overlays
- richer marketing trust-signal consumption
- broader finance handoff and payable workflows

### Phase 4

- South America bootstrap coverage
- deeper authority-specific automation and managed refresh

## 7. Smallest Next Slice

The smallest good next execution slice is:

- implement the schema foundation from `BI-LIC-F36A08`
- alongside the first USA/UK/Australia seed format from `BI-LIC-AA90DB`

That gives the platform a stable persistence model and the minimum reference intelligence needed before any Compliance UX or coworker behavior is added.
