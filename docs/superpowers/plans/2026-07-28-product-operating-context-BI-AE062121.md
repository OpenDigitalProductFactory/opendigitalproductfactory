# Product operating context implementation plan

**Backlog item:** `BI-AE062121`
**Epic:** `EP-ED496EB0`
**Parent plan:** `docs/superpowers/plans/2026-07-27-product-management-operating-loop.md` Phase 5
**Branch:** `refactor/product-operating-context`
**Base branch:** `feat/product-sold-traceability`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Create the canonical read-only boundary that later Product Direction, intelligence,
demand, roadmap, outcomes, and advice phases consume. The projection resolves:

`Organization → Goods and Services for Sale → ProductLine → Product`

without broadening `DigitalProduct` or WWMD. It exposes real commercial,
consumption, intelligence, demand, delivery, and architecture evidence with
canonical IDs, source kinds, timestamps, availability, and scope. It never
creates product teams, business units, consumers, subscribers, entitlements, or
other identities to fill a projection.

This BI does not add a user-facing route. Phase 6 owns the role-adaptive Product
Direction workspace.

## Evidence and substrate audit

- Live backlog on 2026-07-28 reports `BI-AE062121` as `in-progress` under
  `EP-ED496EB0`; Work Capsule `WC-38E36ADB` owns
  `refactor/product-operating-context`.
- Live data contains one `Organization`, no `ProductLine` or business `Product`
  rows, and 321 `DigitalProduct` rows. Test fixtures therefore remain explicitly
  synthetic; implementation must not backfill or infer business products.
- `Product`, `ProductLine`, `ProductOffering`, `CatalogItem`, and `ProductSold`
  are the Phase 1–4 provider/commercial/consumption authority.
- A real enabling-digital-product trace already exists:
  `Product → ProductOffering.operationalServiceOfferingId →
  ServiceOffering.digitalProductId → DigitalProduct`. No parallel
  Product-to-DigitalProduct association is introduced.
- `ResearchProposal` and `MarketingBattlecard` are organization-scoped today.
  Nullable `digitalProductId` is the minimum association needed to distinguish
  organization-wide evidence from product-specific evidence.
- Research execution now writes `WikiPage`/`WikiPageSource` through
  `enrichOrgCorpus`; it does not automatically write `KnowledgeArticle`.
  `KnowledgeArticle` remains available for an explicit retained snapshot.
- `ScheduledAgentTask` has no organization or product foreign key. This phase
  reports schedule availability honestly and does not infer scope from prompt
  text or route strings. Phase 12 may supply typed PM playbook scheduling.

## Governed decisions

### Business-product to digital-product scope

WWMD decision `DI-D7157B1DCB2E` selected the approved-plan-compatible shape:

- add nullable `digitalProductId` only to `ResearchProposal` and
  `MarketingBattlecard`;
- resolve a business Product's enabling `DigitalProduct` records only through
  the existing operational-offering trace;
- preserve organization-wide evidence distinctly;
- reject a direct general-purpose business Product-to-DigitalProduct table and
  reject inferred links.

### Research knowledge compatibility

WWMD decision `DI-FE38F5373A01` selected `canonical-wiki-provenance`
(composite `8.2193`, margin `0.9500`, high confidence):

- preserve `ResearchProposal.digitalProductId` in the existing
  `WikiPage`/`WikiPageSource` research provenance;
- let the operating-context query read the proposal and provenance boundary;
- do not dual-write legacy `KnowledgeArticle`;
- do not add a broad `WikiPage`-to-`DigitalProduct` relation in this BI.

No commandment conflict fired. The strongest contributors were
Never Assume — Verify and Architecture Over Shortcuts.

## Architecture review (advisory)

- **Alignment summary:** aligned after correcting the stale research-output
  assumption.
- **Important — authority boundary:** the business hierarchy stays in Goods and
  Services for Sale; `DigitalProduct` remains an enabling architecture view.
  **Plan edit:** use only the existing operational-offering trace.
- **Important — research authority drift:** automatic `KnowledgeArticle`
  creation would create a second research authority.
  **Plan edit:** carry product scope through canonical Wiki provenance and keep
  retained articles opt-in.
- **Important — scope honesty:** scheduling, objective, and outcome models do not
  yet have every typed association this context will eventually consume.
  **Plan edit:** represent unavailable/partial slices explicitly; never parse
  prose to manufacture associations.
- **Minor — rollup correctness:** bundle component allocation is attribution,
  not additive revenue.
  **Plan edit:** reuse Product Sold summarization and test non-additive package
  attribution.
- **Standards:** DPF `AGENTS.md` single-source-of-truth, schema-audit, live-state,
  and expand-first migration rules; the approved epic design's provider–consumer
  and progressive-exposure contracts.
- **Recommended next step:** proceed with the corrected atomic plan.

## UX-fit review (advisory)

- **Fit summary:** no new UI or navigation belongs in this phase.
- The contract supplies one canonical model that Phase 6 can progressively
  disclose at summary, standard, or advanced depth; it does not create
  separate “simple mode” and “enterprise mode” authorities.
- The simple-business projection defaults the organization as provider and
  shows consumers only when Product Sold carries real party/evidence links.
- Unknown or unavailable data is labeled as such. Empty data is not presented as
  zero, healthy, or complete.
- Phase 6 can build its first viewport around changed evidence, decisions,
  current bets, risks, and outcome posture without repeating joins.
- Existing `/portfolio/product/[id]` digital-product pages and navigation remain
  unchanged.

## Backlog coverage

- **Receipt:** `cms5304ab076001mx2v6kadza`
- **Decision:** `atomic`
- **Parent BI:** `BI-AE062121`
- **Mapped item IDs:** none; all deliverables are internal slices of this BI.
- **Rationale:** the typed contract, intelligence scope, authorized query, and
  compatibility/invariant refactor jointly establish one truthful read boundary.
  Shipping any slice alone would expose an incomplete or misleading contract.

| Deliverable | Independently shippable | Depends on |
| --- | --- | --- |
| `operating-context-contract` | No | — |
| `product-intelligence-scope` | No | `operating-context-contract` |
| `bounded-query-boundary` | No | contract, intelligence scope |
| `compatibility-refactor` | No | contract, query boundary |

## Refactoring allocation

Approximately 20% of the implementation capacity is reserved explicitly:

1. extract shared provenance/freshness and bounded-slice helpers instead of
   repeating them across product contexts;
2. adapt the existing digital-product view model without changing its public
   behavior;
3. centralize Product Sold rollup semantics so package attribution remains
   non-additive;
4. add compatibility/invariant tests for organization isolation, honest
   unknowns, and stable ordering;
5. remove duplicated scope/freshness rules encountered within this BI.

## Implementation

### 1. Lock the pure projection contract (red → green → refactor)

**Files**

- Create `apps/web/lib/product-management/product-operating-context.ts`
- Create `apps/web/lib/product-management/product-operating-context.test.ts`
- Modify `apps/web/lib/portfolio/digital-product-view-model.ts` only for shared,
  behavior-preserving adapters

Write failing tests first for:

- organization, product-line, and product scopes;
- organization-as-provider default;
- no fabricated consumers or ownership identities;
- canonical ID, source kind, and `asOf` on every projected item;
- explicit `available`, `partial`, and `unavailable` slices;
- product-specific versus organization-wide intelligence;
- direct Product Sold measures versus non-additive package attribution;
- stable ordering and stale-evidence classification.

Implement a pure assembler over explicit query results. It stores no prose and
performs no I/O.

### 2. Expand product scope on existing intelligence authorities

**Files**

- Modify `packages/db/prisma/schema.prisma`
- Add
  `packages/db/prisma/migrations/20260728200000_add_product_scope_to_research_and_battlecards/migration.sql`
- Modify research proposal, approval, queue payload, execution, and tests;
  preserve organization-wide schedule behavior
- Modify battlecard library, marketing tool pack, and tests

Add nullable indexed `digitalProductId` foreign keys with `ON DELETE RESTRICT`
and inverse `DigitalProduct` relations. Existing rows remain `NULL` and therefore
organization-wide. Validate the supplied digital-product reference through the
foreign key; business-product contexts may use it only when the existing
organization-scoped operational-offering trace resolves that product.

Research proposal approval/execution carries the scope unchanged and records it
in canonical research provenance. Organization-wide scheduled research remains
unchanged. Marketing tools extend their existing inputs and outputs rather than
adding PM-specific duplicates.

### 3. Add the authorized bounded query boundary

**Files**

- Create
  `apps/web/lib/product-management/product-operating-context-query.ts`
- Create
  `apps/web/lib/product-management/product-operating-context-query.test.ts`

Authorize the requested organization once, then load the requested organization,
product-line, or product with organization predicates. Fetch bounded slices with
stable ordering and explicit limits. Resolve enabling digital products only
through `ProductOffering → ServiceOffering → DigitalProduct`.

Return honest partial/unavailable states for associations not yet established.
Test cross-organization denial, referential deletion protection, stale evidence,
empty simple-business data, and package attribution.

### 4. Documentation and compatibility

- Update user/operator documentation describing business products versus digital
  products and truthful progressive disclosure.
- Update architecture documentation with the canonical operating-context query
  boundary and Wiki provenance compatibility.
- Update setup documentation only where terminology or downstream behavior
  changes.
- Update AI-coworker guidance so product scope is explicit and never inferred.
- Preserve existing digital-product overview and knowledge route behavior.

## Migration safety and rollback

The migration is expand-only:

- two nullable columns;
- two nullable foreign keys using `ON DELETE RESTRICT` so product-specific
  evidence cannot silently become organization-wide;
- two indexes;
- no `NOT NULL`, uniqueness, data rewrite, or inferred backfill.

The SQL carries `-- @migration-safety: data-safe` attestations explaining why
every existing row remains valid. Prisma validation/generation and migration
application run in the integrated leased sandbox.

Rollback before merge is branch removal. After deployment, application reads can
stop using the nullable fields without data loss; schema contraction, if ever
needed, is a later fleet-safe migration.

## Verification

Source-local gates:

1. targeted Vitest for the projection, query, research, battlecard, and existing
   digital-product compatibility tests;
2. Prisma format, validate, and generate;
3. affected-package typecheck where the worktree is compile-ready;
4. migration-safety, data-stewardship, docs-link, and architecture guards.

Integrated scarce-sandbox gate, batched with the remaining epic branches:

1. sandbox freshness preflight and lease evidence;
2. migration application against existing data;
3. targeted and affected unit tests;
4. `pnpm --filter web build`;
5. query/read-model timing and bounded-query evidence;
6. Phase 6+ UX verification for the simple one-line, salon mixed line, hotel
   rooms/events, and restaurant dining/private-events scenarios.

Phase 5 is source-complete only after its commit is DCO-signed and pushed. It is
not complete or PR-ready until the integrated runtime gates pass.
