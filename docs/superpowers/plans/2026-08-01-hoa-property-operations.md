# HOA property operations implementation plan

**Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`

**UX decision:** `DI-0B87641E5380` (`synchronized-progressive`, high confidence)

> **Rescue note (2026-08-16).** This design was recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed; the implementation did not.**
>
> - Tracking item: `BI-FE286C27`
> - Preserved implementation: `feat/hoa-property-operations` @ `04014faa3c452c56171ae6279a79132b582af620`, pinned locally at `refs/salvage/2026-08-15/feat/hoa-property-operations` and recorded in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin 04014faa3c452c56171ae6279a79132b582af620:refs/heads/feat/hoa-property-operations`.
> - Merge state as measured on 2026-08-16: merges cleanly into current main (425 commits behind, no conflicts).
> - The original backlog anchors in this document did **not** resolve in this install, so it could not pass `check_plan_backlog_coverage`. Coverage is rebound to `BI-FE286C27`.
>
> - **Coverage is intentionally not recorded yet.** The stale delivery anchors (backlog-item and
>   coverage-receipt metadata lines) were removed because their ids do not resolve here, and a
>   receipt bound to work nobody has started would be fiction. This plan is therefore outside
>   the plan-backlog-coverage gate by design — that gate skips any plan carrying no
>   backlog-item metadata line. **When the implementation thread starts:** restore the backlog-item metadata line naming BI-FE286C27, call
>   `record_plan_backlog_coverage`, and copy its Receipt, Decision, Parent, Rationale and
>   Dependencies into a `## Backlog coverage` section. Recording a receipt requires an active
>   Workroom claim on BI-FE286C27 — the repository-artifact resolver needs a claim-backed subject.
>
> Implementation is deliberately deferred to its own thread: this work needs an install/seed cycle to verify honestly, and a rebase alone would not prove it works. Read `BI-FE286C27` for the current dependency state before starting.

Operational-Precedent: hoa-property-priorities

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Replace the generic technician/job presentation for `homeowners-association`, `condo-association`, and `property-management-company` with a business-grade current-operations view that answers:

> Which association, building, unit, common asset, or property issue needs attention now; why; who owns the next move; and what blocks it?

The first release uses one domain projection to drive a schematic property hierarchy and an accessible ranked list. It consumes the reusable geographic TERRITORY renderer from `BI-8D9A2DE5` when that capability becomes available; it does not duplicate MapLibre, routing, geometry, Work Case, or attention substrate.

## Verified substrate

- `StorefrontConfig.archetypeId` remains the archetype source of truth; `deriveTwinProfile` already resolves HOA/property to `TERRITORY` / `unit-portfolio`.
- `CustomerSite` and `CustomerSiteNode` provide the existing site and nested-location substrate; `Address` carries optional validated latitude/longitude.
- `WorkItem` / Work Case is the canonical owned-work and attention rail. This slice projects compatible work; it does not create a second work-order table or transition system.
- `OperationalSceneLayout` is the one authored-geometry table. The HOA view may read persisted placement later but adds no domain table or migration.
- `WorkspaceTwinHero` and `WorkspaceTwinPanel` remain the `/workspace` mount. Operations stays in the main workspace; performance stays in `/performance`; no new global navigation item is added.
- `BI-CD289EA4`, `BI-094A0A1D`, and `BI-1DA86883` own richer vertical master data, capacity, and full cockpit workflow. This slice exposes honest availability/degradation until those sources land.
- Open worktree/PR sweep found no competing HOA property operations branch. `territory-map-substrate` remains separately owned and untouched.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/plans/2026-07-15-twin-workspace-home-placement-execution.md`
  - the live `EP-SPATIAL-OPERATIONAL-VIEWS` plan/backlog graph, including `BI-8D9A2DE5`, `BI-CD289EA4`, `BI-094A0A1D`, and `BI-1DA86883`
- Current code substrate reviewed:
  - `deriveTwinProfile`, `WorkspaceTwinPanel`, `CustomerSite`, `CustomerSiteNode`, `WorkItem`, and `OperationalSceneLayout`
  - the existing AppFolio/Vantaca `hoa-property-priorities` precedent pack
- Source of truth:
  - `StorefrontConfig.archetypeId` selects the vertical; exact `CustomerSite`/`CustomerSiteNode` IDs define physical hierarchy; explicitly referenced `WorkItem.evidence.hoaProperty.propertyId` supplies current work.
- Decision:
  - preserve `/workspace` as the Operations destination and add a synchronized schematic hierarchy plus ranked accessible list. Reuse the shared TERRITORY renderer later; add no HOA-specific navigation, map, work-order model, or attention system.

## Current industry precedent

Current design-intelligence records establish the minimum business baseline:

- **AppFolio:** portfolio/association context first; property-linked maintenance and architectural requests; board visibility; vendor, approval, due-date, access, budget, notes, and evidence attached to tracked work.
- **Vantaca:** owned action items lead; association/property and configured workflow step remain visible; follow-up/completion dates, service provider, board action, and immutable property association govern progression.
- **DPF adaptation:** elevate high-impact and blocked next actions above a generic map; normalize priority for scanning while preserving source labels and evidence; show the exact property scope and accountable next party; keep the schematic and table synchronized.

The implementation will refresh `apps/web/data/design-intelligence/operational-precedents.csv` only when a missing or newer verified source is found; it will not duplicate existing AppFolio/Vantaca rows.

## UX fit and navigation

Three approaches were evaluated:

1. wait for the full geographic renderer;
2. ship a list-only dashboard;
3. ship a synchronized schematic hierarchy plus accessible ranked list, then bind the geographic renderer through the same projection.

The governed decision selected option 3 (`DI-0B87641E5380`). It ships real value now, keeps non-text information equivalent in text, and avoids a throwaway HOA-specific map.

Interaction hierarchy:

1. one owner-first priority and consequence statement;
2. small operating summary: urgent, overdue/SLA-risk, blocked, unassigned;
3. association/property hierarchy with condition and top priority;
4. ranked action list carrying identical filters and selection;
5. selected-property/action detail with why-high evidence, blockers, accountable party, and next action;
6. secondary disclosure for source health, capability state, and lower-priority work.

Subtype vocabulary must differ:

- homeowners association: community, lot/home, homeowner, board, assessment, architectural request;
- condominium association: association, building, unit, resident, common area, parking, board/management;
- property management company: portfolio, property, unit, tenant/owner, lease, rent/deposit, maintenance vendor.

## Projection contract

Create a pure `hoa-property-operations` module with serializable inputs and output. The output contains:

- stable property hierarchy: portfolio/association -> property/building -> unit/lot/common asset;
- property condition derived from open work, never stored as competing truth;
- normalized work categories: safety, maintenance, violation, architectural review, amenity, inspection, board decision, resident access, payment/collections, lease/tenant, other;
- normalized workflow state plus preserved source status label;
- accountable next party: manager, board, vendor, resident/tenant, owner, system, unassigned;
- blocker facets: vendor, board approval, resident access, budget, weather, evidence, schedule, other;
- explanation fields for every priority score;
- geographic capability: `schematic`, `geocoded`, or `unavailable`, including reason and address confidence;
- freshness, source watermark, degraded/withheld facts, and demo marker.

Priority is deterministic and explainable. Safety and active habitability risk outrank impact, then SLA/due breach, age, blocked dependency, and unassigned ownership. The projection returns the contribution ledger rather than only a numeric score. Ties resolve by due date, opened date, then stable id.

No resident name, email, phone, access code, payment amount, lease detail, violation narrative, or private note enters the client projection unless a later authorized detail endpoint explicitly needs it. The operations overview uses audience-safe labels such as `Unit 204` and `Resident access needed`.

## Data and truthfulness policy

The loader is bounded, organization/archetype scoped where the substrate permits it, and fail-closed:

- resolve the configured HOA archetype and organization first;
- load independent site/hierarchy, work, and capability inputs concurrently;
- only join work to a property through explicit source/evidence references;
- never guess association membership from a similar name or address;
- withhold unscoped records rather than display them under the wrong association;
- return an actionable empty state when no compatible live projection exists;
- use the deterministic golden fixture only in an explicit demo state with the existing `Demo data` treatment.

The generic Work Case source registry is not expanded in this BI. Compatible `WorkItem` records are read through existing source types and explicit structured property references. New HOA source types or write paths belong to the vertical master-data/cockpit items and require their own governed change.

## Phases

### Phase 1 — pure projection and tests

Add the typed domain contract, validation/parsing helpers, explainable priority scoring, hierarchy rollups, filters, selection rules, and golden scenario. Tests cover:

- two associations with duplicate-looking unit labels that never cross-link;
- pool outage affecting the whole community;
- safety-critical roof leak;
- aging violation;
- architectural request waiting on board review;
- vendor schedule conflict;
- resident-access blocker;
- distinct HOA/condo/property-management vocabulary;
- deterministic ranking and privacy-safe serialization;
- empty/degraded/withheld states.

### Phase 2 — live loader and capability seam

Add a server-only loader over existing Prisma models and the generic Work Case read substrate. Keep Prisma behind a narrow interface so the pure module remains testable. Return `schematic` when exact hierarchy exists without geocoded rendering, `geocoded` only when the shared renderer capability is present, and `unavailable` with a reason otherwise.

Performance targets for the current-operations hot path:

- one archetype/config resolution query;
- independent bounded reads run concurrently;
- no per-property or per-work-item query loop;
- default maximum 250 active work items and 500 hierarchy nodes, with portfolio rollups beyond the visible ceiling;
- pure projection p95 target under 50 ms for the bounded fixture; server load target under 400 ms before browser/network overhead.

### Phase 3 — synchronized operations composition

Add `apps/web/components/twin/hoa/` using report-kit primitives and semantic HTML:

- compact summary cards;
- schematic portfolio/property plan grouped by association with non-color status text;
- accessible ranked `DataTable` equivalent containing property, category, impact, age/due, owner, blocker, status, and next action;
- shared filter/selection state between the plan and list;
- detail panel with the priority explanation and link to the canonical Work Room when available;
- actionable empty state and clear demo/degraded/capability labels.

Wire this view through `WorkspaceTwinPresentation` and `WorkspaceTwinPanel` only for `TERRITORY` / `unit-portfolio`. Preserve the generic twin fallback when live and demo HOA projections are unavailable.

### Phase 4 — corpus, docs, and integration verification

- update operational precedent corpus only for verified missing/current sources;
- update the operations user guide with property hierarchy, priority reasons, capability states, and privacy behavior;
- run design-grounding, reporting-composition, style, module-size, doc, and secret guards;
- run targeted unit/component tests and TypeScript;
- run the exact merged-code local-CI gate through FIFO;
- after a passing gate, verify the served HOA workspace on desktop and mobile, including keyboard/list equivalence and the golden exceptions;
- push/open a ready PR only after those gates pass.

## Refactoring allocation (20%)

Reserve one fifth of effort for reusable boundaries rather than HOA-only UI:

- extract shared hierarchy flattening/rollup helpers only where two consumers are proven;
- keep priority scoring pure and data-driven so later HVAC/HOA variants can reuse explanation structure without sharing domain weights;
- keep `WorkspaceTwinPresentation` domain extensions grouped and loaded concurrently instead of adding serial conditionals;
- split visual sections before the module-size guard forces emergency extraction;
- keep the future geographic renderer behind a typed capability/presentation seam.

## Risks and rollback

- **Wrong tenancy:** existing customer-site substrate is install-local. Mitigation: explicit configured scope and reference-only joins; withhold ambiguity. Rollback: disable the HOA loader and fall back to the generic twin.
- **False priority:** vendor workflows use configurable source states. Mitigation: preserve source label and expose the scoring ledger. Rollback: use deterministic safety/SLA/age ordering without source-specific weights.
- **Duplicate attention UI:** `/workspace` already has one cockpit. Mitigation: the HOA view ranks domain work but does not create a second global `Needs you` count or coworker approval rail.
- **Map dependency delay:** BI-8D9A2DE5 may remain blocked. Mitigation: schematic plus list are complete and capability-labelled. Rollback is unnecessary; binding the shared map is additive.
- **Data exposure:** property operations contain resident and financial facts. Mitigation: allowlisted DTO and privacy serialization tests. Rollback: loader returns withheld state.

No migration is planned. Reverting the UI/loader commit restores the generic operational twin; no business data or authored geometry is deleted.

## Backlog coverage

Coverage receipt `cmsaluvo90aru01qk0ovasyj1` records a decomposed plan:

| Deliverable | Backlog item | Dependency |
|---|---|---|
| Reusable TERRITORY geographic renderer | `BI-8D9A2DE5` | none |
| HOA/property projection and synchronized operations view | `BI-76C1B949` | existing site, Work Case, and workspace substrate |
| Geographic capability binding | internal phase of `BI-76C1B949` | `BI-8D9A2DE5` |

Projection, loader, UI sections, fixture, tests, and docs are internal layers of the single HOA operations outcome and are not independently shippable.

## Completion gate

Done means the exact merged candidate has passed targeted tests, exhaustive tests, TypeScript, production build, applicable guards, and served browser UX; the view accurately distinguishes HOA/condo/property-management vocabulary; the golden scenario is visible and ranked correctly; privacy and ambiguity tests pass; and a ready PR is in the governed merge queue. Until then `BI-76C1B949` remains in progress.
