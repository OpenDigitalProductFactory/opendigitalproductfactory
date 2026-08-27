# Platform SBOM and currency consolidation plan

Backlog item: `BI-7D2C4F02`  
Workroom: `WC-ABF509BA`  
Architecture decision: `DI-C24852C1789A` (`product-operate-canonical`, high confidence, autonomy eligible)

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

The Digital Product Factory Portal product becomes the only operator home for its dependencies, discovered estate, CycloneDX composition, and lifecycle-derived currency. The existing platform SBOM generator feeds the canonical `BomDocument`/`BomComponent`/`CatalogIdentity` graph. The former Stack Currency route becomes a compatibility redirect and can no longer own component facts.

## Evidence and ownership

- Live install: `BomDocument`, `BomComponent`, and `BomComponentOccurrence` each contain zero rows; the Azure OpenAI product has zero inventory and BOM rows.
- Duplicate source: `apps/web/lib/operate/platform-stack.ts` owns seven static components and support dates separately from portfolio/SBOM data.
- Existing canonical substrate: `DigitalProduct` owns `ProductDependency`, `InventoryEntity`, and `BomDocument`; `BomComponent` links to `CatalogIdentity`, which owns `CatalogLifecycleMilestone`.
- Existing production artifact: `scripts/sbom/generate-platform-sbom.mjs` already generates the whole-monorepo CycloneDX document from `pnpm-lock.yaml`; the weekly workflow uploads it but does not persist it.
- Root cause: PR #4295 asserted the stack assessment had no other consumer after PR #958 and PR #2269 had already shipped the BOM and portfolio projector. Neither PR recorded an independent review. The projector parity guard only inspects registered projectors and cannot detect route-local competing sources.

Canonical ownership:

- Product relationship: `ProductDependency`
- Deployed/discovered item: `InventoryEntity`
- Software composition: `BomDocument` → `BomComponentOccurrence` → `BomComponent`
- Component identity and support dates: `CatalogIdentity` → `CatalogLifecycleMilestone`
- Operator presentation: product `Operate > Dependencies`

## Atomic delivery decision

The phases below are internal sequencing, not independently shippable deliverables. Ingestion without the canonical product surface would leave the reported UX defect; the surface without ingestion would remain empty; deleting the duplicate before both land would remove the only visible data; and the invariant only has meaning once the canonical flow exists. One BI and one rollback unit are therefore correct.

## Phase 1 — Red: canonical persistence and idempotence

Requirements: `AC-PSCC-001` one platform composition source; `AC-PSCC-002` idempotent install/upgrade ingestion; `AC-PSCC-003` component-to-catalog linkage.

1. Extract BOM component keys, normalized types, and persistence from the web-only assurance folder into `@dpf/db` so Build Studio and seed ingestion use one implementation.
2. Add a pure platform-CycloneDX normalizer and a seed service that:
   - resolves `dpf-portal` by stable product id;
   - invokes the existing whole-platform generator;
   - uses a deterministic document id from the lockfile/source digest;
   - replaces occurrences for that document and supersedes older platform documents;
   - links persisted components to `CatalogIdentity` through the existing SBOM bridge.
3. Call the service immediately after DPF self-registration in `seed.ts`.
4. Start with failing unit tests for normalization, deterministic identity, rerun behavior, stale occurrence removal, and catalog linkage.

Verification: package DB unit tests, web assurance unit tests, and DB typecheck.

## Phase 2 — Red: one product Operate surface

Requirements: `AC-PSCC-004` one visible operator home; `AC-PSCC-005` correct mixed/empty facet behavior; `AC-PSCC-006` catalog-derived currency.

1. Rename the product Operate subitem to `Dependencies`; remove the separate `Supply Chain` subitem.
2. Extend the Dependencies page to load:
   - outgoing and incoming `ProductDependency` edges;
   - canonical attributed `InventoryEntity` rows;
   - the latest product BOM with component catalog milestones and assurance findings.
3. Present three progressively disclosed sections on one page: product relationships, deployed estate, and software composition.
4. Refactor `ProductSupplyChainPanel` into a composition section with a clear provenance line, export action, currency summary, and component table. Currency must use `deriveSupportEndDate` and `deriveCurrency`; unknown dates remain explicitly unsourced.
5. Redirect the old product `/supply-chain` route to `/inventory#software-composition`.

Verification: render tests for first-viewport headings, mixed/empty states, lifecycle tones, export availability, and navigation active state.

## Phase 3 — Remove the duplicate and prevent recurrence

Requirements: `AC-PSCC-007` compatibility redirects; `AC-PSCC-008` no route-owned stack facts or duplicate navigation; `AC-PSCC-009` prospective guard.

1. Change `/ops/stack-currency` to resolve `dpf-portal` and redirect to its canonical Dependencies section.
2. Remove the Stack Currency operations tab, static source, table-only component, tests, and route purpose contract; regenerate the route-purpose artifact.
3. Add a repository guard that asserts:
   - the compatibility route contains only product resolution plus redirect;
   - no `PLATFORM_STACK` symbol or platform-stack source module exists;
   - product navigation exposes one Dependencies destination and no separate Supply Chain destination;
   - the seed invokes canonical platform BOM persistence.
4. Wire the guard into the existing check suite and begin with a failing fixture test.

Verification: route redirect test, navigation tests, guard tests, prose lint, style drift, generated-artifact check.

## Phase 4 — Functional and UX proof

Requirements: `AC-PSCC-010` complete automated verification; `AC-PSCC-011` usable responsive experience and runtime proof.

1. Run the focused red-green suites and package typechecks.
2. Run `pnpm run pregate:preflight`, then the branch exact-tree `pnpm run pregate` through the governed local-CI path.
3. Advance a nonproduction runtime only through the shared lease workflow.
4. Verify in the live portal:
   - `dpf-portal` has one current platform BOM and nonzero occurrences;
   - rerunning the seed leaves one current source document for the same source digest;
   - the product first viewport makes Dependencies discoverable;
   - the page distinguishes product, estate, and component facts without duplicate tabs;
   - desktop and narrow viewport layouts remain legible;
   - old Stack Currency and Supply Chain bookmarks land at the canonical section.
5. Capture screenshots and runtime/database evidence in `WC-ABF509BA`.

Verification: runtime evidence, UX critique, and `pnpm pr:health` including review findings.

## Change-impact obligations

- Resolve graph-linked and colocated tests for `ops-nav.ts`, the removed `platform-stack.ts`, the removed purpose contract, and `seed.ts` before implementation.
- Run `pnpm run check:prose-lint:test`, `pnpm run check:prose-lint`, and `node scripts/check-style-drift.mjs`.
- Regenerate and verify `apps/web/lib/ux-budget/route-purpose.generated.json` and the document index if plan indexing requires it.
- PR body must carry a `## Design grounding` section and a `Seed-Fit-Decision:` line.
- The active overlap on `apps/web/components/ops/ops-nav.ts` is limited to WC-261E0B3D adding a Workrooms tab; preserve that line when reconciling with main.

## Risks and rollback

- Risk: seed-time generator path differs in release images. Mitigation: path-resolution unit test plus init-image build/pregate.
- Risk: replacing occurrences could affect build-specific BOMs. Mitigation: replacement is scoped to the deterministic platform document only; existing content-addressed build BOMs remain unchanged.
- Risk: a large platform BOM overwhelms the table. Mitigation: summary-first UI, bounded initial rows, semantic table markup, and retained SBOM export.
- Risk: lifecycle feeds do not yet cover every npm identity. Mitigation: display `Not sourced` instead of inventing dates; the catalog feed can enrich the same identities later.
- Rollback: revert the single PR. No schema migration is introduced. Existing BOM rows are additive; the prior route can be restored without data loss.

## Backlog coverage

Coverage is deliberately atomic. Portfolio Advisor recorded research receipt `initiative-112cda8a-5968-429b-8279-cceced649456` against the earlier spec blob `4fecf1fe80bfee98e40489d0f7757b91522e431a`; it remains audit history but does not approve the materially revised architecture, UX, risk, and evidence contract. The revised immutable spec requires fresh research and independent `spec-approval` before the initiative scope baseline and coverage receipt can be recorded.

- Decision: `atomic`
- Umbrella BI: `BI-7D2C4F02`
- Deliverable: `platform-sbom-currency-consolidation` → `BI-7D2C4F02`
- Dependencies: none
- Prior research receipt: `initiative-112cda8a-5968-429b-8279-cceced649456` (`pass`, superseded spec blob)
- Coverage receipt: blocked on fresh research, independent `spec-approval`, and the initiative scope baseline; do not implement until all three are recorded
