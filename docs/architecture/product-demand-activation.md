# Product demand activation

`BacklogItem` is DPF's canonical demand and delivery record. Product-management
features extend it; they do not add an `Idea`, `Demand`, strategy-document, or
roadmap authority.

## Scope boundary

Demand may be scoped to the organization or one narrower target:

- an organization-owned business `ProductLine`;
- an organization-owned Goods and Services `Product`; or
- an EEMD `DigitalProduct`.

Business and digital product targets are mutually exclusive. Public APIs accept
stable `orgId`/slug, `lineId`/key, and `productId` references and resolve them
to internal foreign keys at one canonical boundary. Product Direction uses the
same projection boundary. It never infers a business Product from an enabling
DigitalProduct or invents a provider team or consumer.

## State and evidence

The persisted stages remain `raw`, `screened`, `shaped`, and `ready`. A null
stage means **unclassified**. It is not a fifth stored enum and is never treated
as raw in projections.

`DemandEvidenceLink` is an additive child of `BacklogItem`. It owns a reviewed
link and evidence-at-link snapshot, not the source fact. Published reviewed
`WikiPage` knowledge is relational; other typed evidence retains a stable
source-domain reference. Active links are queryable and superseded links remain
in history.

`BacklogItemActivity` is the append-only explanation and decision timeline:

- classification and stage-transition snapshots;
- exact scoring inputs, framework, contributions, confidence, missing values,
  and effort provenance;
- evidence link/supersession activity; and
- funding result, rationale, and WWWD decision interaction.

Current scalar fields and active evidence links remain authoritative. Activity
JSON is history, not a competing current-state model.

## Governed transitions

Lifecycle transitions are separate from scoring:

1. unclassified → raw requires explicit classification or deterministic
   creation of newly scoped product demand;
2. raw → screened requires a stated problem and active reviewed evidence;
3. screened → shaped requires an explainable score, confidence, an investment
   bucket, and reconciled attributed effort;
4. shaped → ready is available only through
   `approve_demand_for_funding` and the organization's WWWD profile.

Scoring never changes `demandStage`. Backward movement requires a rationale,
and funded demand cannot be silently rewound.

## Fleet-safe evolution

The Phase 8 migration adds only nullable scope columns, indexes, foreign keys,
and the empty evidence-link table. It performs no historical update. Existing
rows retain their null stages and scores, and the UI exposes a governed
classification queue. A later tightening or backfill requires separate fleet
convergence evidence.

`/ops/demand` is the canonical operator surface. Product Direction supplies a
filtered contextual link and read-only readiness/history projection; it is not
a second board or write authority.

## Derived roadmap boundary

The Product and ProductLine roadmap is a pure read model over the canonical
product operating context. It does not introduce `Roadmap` or `RoadmapItem`
tables. A committed bet requires:

1. `BacklogItem.demandStage = "ready"`, established by the governed funding
   decision; and
2. an explicit contribution link to an active business `ProductObjective`.

The projection combines active build and shipped-version evidence when the
backlog relation is explicit. Change and architecture records associated
through a real enabling `DigitalProduct` remain coordination evidence. A
`ProductDependency` edge is not converted into a business-demand dependency
because no canonical association currently supports that claim.

Now / Next / Later, timeline, outcome, dependency, coworker-review, and export
views all consume the same projection contract. Missing stages, objective
links, evidence, dates, or dependency mappings remain explicit. A portable
snapshot carries `asOf`, filters, confidence, and source identifiers and is
marked `importable: false`.

This is an expand-first Phase 11 change with no schema migration. The fleet's
legacy unclassified backlog remains unchanged and cannot enter a committed
roadmap lane by inference.

## Product-management playbook boundary

Reusable product-management playbooks extend the existing skill, prompt,
scheduled-task, TaskRun, Product Operating Context, and Product Direction
substrate. `ScheduledAgentTask` remains schedule authority and `TaskRun`
remains execution/provenance authority. The recipe catalog is the single
source for supported scope, canonical inputs, allowed tools, derived output,
proposed writes, approvals, cadence, failure behavior, and refresh sources.
No `ProductPlaybook`, schedule, run, roadmap, or strategy table is added.

The nullable `taskKind = "product-management-playbook"` discriminator and
versioned `taskConfig` use the earlier expand-first scheduler columns. Existing
generic tasks remain valid with null kind, scope, and config. Phase 12 adds no
migration and no tightening constraint.

Execution loads the current Product Operating Context, validates the recipe's
permission digest, records source IDs and the input fingerprint, and skips an
unchanged run without model work. Only a fully successful run advances the
last-successful fingerprint. Partial and failed runs remain retryable.
Canonical changes queue a scoped refresh after the owning database transaction
commits; refresh lookup never crosses into an uncommitted commercial write.

Product and ProductLine Direction are the contextual operator surfaces.
Preview and explicit confirmation precede scheduling; detail is progressively
disclosed. The generic scheduler remains an operations surface, not a second
product workflow. Run inspection links to the existing AI history route, and
portable briefs are timestamped, source-linked, and `importable: false`.

Business `ProductLine` and `Product` remain owned by Goods and Services for
Sale. `DigitalProduct` contributes architecture or delivery evidence only
through a real existing association. WWMD remains platform-development
governance, not a store for customer product-management decisions.
