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
