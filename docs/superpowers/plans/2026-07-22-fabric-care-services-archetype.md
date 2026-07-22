# Fabric Care Services Archetype Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time - one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

**Backlog anchor:** `BI-7CFFC421`

**Design:** `docs/superpowers/specs/2026-07-22-fabric-care-services-archetype-design.md`

**Decision:** `DI-A32448993543` selected a new `fabric-care-services` category with high confidence.

**Execution status:** implemented in `feat/fabric-care-services-archetype`. The archetype completeness guard and whitespace check pass in this worktree; targeted Vitest commands are blocked here because the source-only worktree has no `vitest` binary.

## Goal

Add a complete DPF business archetype for dry-cleaning and fabric-care services:
template substrate, WSID corpus, coworker decision, and skill/tool assessment.

## Architecture

The implementation adds `fabric-care-services` as a new `ArchetypeCategory`
with three initial leaves: `dry-cleaning-plant-network`,
`wash-and-fold-laundry`, and `alterations-tailoring`. The first pass reuses the
existing activation axes (`services`, `physical`, `multi-channel`,
`point-of-sale`, `account-with-billing`) rather than adding a new provisioning
enum before plant-production runtime exists. Category-specific UX comes from
archetype templates, vocabulary, business-context, marketing, finance defaults,
and the WSID profession corpus.

## Backlog coverage

Coverage receipt: `cmrwoeib00k4601nz6rim1m5e`.

Decision: `atomic`.

Rationale: the template category, profession corpus, and coworker decision are
not independently shippable under the archetype provisioning playbook. Shipping
only one of them would create a shallow archetype and fail the completeness
guard for a new category.

Deliverable graph:

| Key | Title | Independently shippable | BI | Depends on |
| --- | --- | --- | --- | --- |
| `fabric-care-archetype` | Complete fabric-care services archetype | No | `BI-7CFFC421` | none |

## Files

Create:

- `packages/storefront-templates/src/archetypes/fabric-care-services.ts`
- `docs/professions/operations/wiki/fabric-care-garment-custody-and-ready-promise.md`

Modify:

- `packages/storefront-templates/src/types.ts`
- `packages/storefront-templates/src/archetypes/index.ts`
- `packages/storefront-templates/src/archetypes/archetypes.test.ts`
- `packages/db/src/wiki-taxonomy.ts`
- `apps/web/lib/storefront/industries.ts`
- `apps/web/lib/storefront/industries.test.ts`
- `apps/web/lib/storefront/archetype-vocabulary.ts`
- `apps/web/lib/storefront/public-trust.ts`
- `apps/web/lib/storefront/setup-model.ts`
- `apps/web/lib/docs/storefront-help-panel.ts`
- `apps/web/lib/onboarding/archetype-business-context.ts`
- `apps/web/lib/onboarding/excellence-corpus.ts`
- `apps/web/lib/tak/marketing-playbooks.ts`
- `apps/web/lib/tak/mcp-catalog-types.ts`
- `apps/web/lib/workspace-home/profiles.ts`
- `apps/web/lib/workspace-home/profiles.test.ts`
- `apps/web/lib/workspace-home/registry.ts`
- `apps/web/lib/workspace-home/types.ts`
- `apps/web/lib/finance/setup-profile.ts`
- `apps/web/lib/finance/setup-profile.test.ts`
- `apps/web/lib/integrate/contribution-review.ts`
- `apps/web/lib/marketing/archetype-fit.ts`
- `apps/web/lib/public-web-tools.ts`
- `packages/finance-templates/src/profiles.ts`
- `packages/db/src/business-capability-perspectives.ts`
- `packages/db/test/business-capability-perspectives.test.ts`
- `packages/storefront-templates/src/operational-value-stream.ts`
- `packages/storefront-templates/src/twin-profile.ts`
- `packages/storefront-templates/src/demo-flavor.ts`
- `packages/db/src/portfolio-sources/archetype-supply-manifest.ts`
- `docs/professions/registry.json` only if the existing `operations` family does not already cover the dispatcher/operations corpus
- `docs/user-guide/market-archetypes.md`
- `docs/architecture/archetype-business-value-streams.md`
- `docs/testing/archetype-audit-plan.md`
- `scripts/archetype-coworker-decisions.txt`

Verification:

- `pnpm --filter @dpf/storefront-templates exec vitest run src/archetypes/archetypes.test.ts`
- `pnpm --filter @dpf/db exec vitest run test/seed-storefront-archetypes.test.ts src/portfolio-sources/project-archetype-supply.test.ts`
- targeted web Vitest suites for any web files touched
- `node scripts/check-archetype-completeness.mjs`

## Task 1 - Add failing catalog coverage

- [x] Add a test in `packages/storefront-templates/src/archetypes/archetypes.test.ts` asserting that `fabric-care-services` ships exactly the three initial leaves:
  - `alterations-tailoring`
  - `dry-cleaning-plant-network`
  - `wash-and-fold-laundry`
- [x] Assert the dry-cleaning leaf has:
  - category `fabric-care-services`;
  - `ctaType: "inquiry"`;
  - activation axes `services`, `physical`, `individual`, `multi-channel`, `point-of-sale`, and `account-with-billing`;
  - modules including `customer-estate`, `service-operations`, `billing-readiness`, and `integrations`;
  - form fields for drop-off location, pickup/delivery preference, due date, and garment notes.
- [x] Run:

```powershell
pnpm --filter @dpf/storefront-templates exec vitest run src/archetypes/archetypes.test.ts
```

Observed: blocked before assertion execution because this source-only worktree does not have the `vitest` binary.

## Task 2 - Implement the storefront template substrate

- [x] Add `fabric-care-services` to `ArchetypeCategory` in `packages/storefront-templates/src/types.ts`.
- [x] Create `packages/storefront-templates/src/archetypes/fabric-care-services.ts`.
- [x] Define shared contact/order fields for name, email, phone, preferred location, pickup/delivery preference, needed-by date, garment/item notes, and special handling.
- [x] Define a shared activation profile:
  - modules: `customer-estate`, `service-operations`, `billing-readiness`, `integrations`;
  - billing readiness: `prepared-not-prescribed`;
  - customer graph: `separate-customer-projection`;
  - estate separation: `strict`;
  - axes: services / physical / individual / multi-channel / point-of-sale / account-with-billing / no platform.
- [x] Add the three archetypes:
  - `dry-cleaning-plant-network`;
  - `wash-and-fold-laundry`;
  - `alterations-tailoring`.
- [x] Register the module in `packages/storefront-templates/src/archetypes/index.ts`.
- [x] Attempt the catalog test again.

Observed: blocked before assertion execution because this source-only worktree does not have the `vitest` binary.

## Task 3 - Wire category-keyed consumers

- [x] Add `fabric-care-services` to `PROFESSION_ARCHETYPES` in `packages/db/src/wiki-taxonomy.ts`.
- [x] Add the industry option in `apps/web/lib/storefront/industries.ts` as `Fabric Care Services`.
- [x] Add category vocabulary in `apps/web/lib/storefront/archetype-vocabulary.ts`.
- [x] Add business-context defaults in `apps/web/lib/onboarding/archetype-business-context.ts`.
- [x] Add a marketing playbook in `apps/web/lib/tak/marketing-playbooks.ts`.
- [x] Add workspace-home profile copy in `apps/web/lib/workspace-home/profiles.ts`.
- [x] Add a finance profile/default in `packages/finance-templates/src/profiles.ts`.
- [x] Add operational value-stream defaults in `packages/storefront-templates/src/operational-value-stream.ts` without adding new capacity-unit enums unless tests prove a totality hole.
- [x] Add or confirm the twin mapping in `packages/storefront-templates/src/twin-profile.ts`.
- [x] Add demo flavor and archetype supply manifest entries if those files are keyed by category.
- [x] Attempt targeted tests for touched packages and adjust only tested, real gaps.

## Task 4 - Add WSID corpus and coworker decision

- [x] Add `docs/professions/operations/wiki/fabric-care-garment-custody-and-ready-promise.md` with frontmatter:

```yaml
---
title: Fabric Care Garment Custody and Ready Promise
professionKey: operations
professionArchetype: ["fabric-care-services"]
professionJurisdiction: ["us"]
professionJurisdictionBasis: operating
professionCompetencyLevel: practitioner
sourceClass: open
---
```

- [x] Ground the page in the open sources from the design spec: Census NAPCS, FTC care labeling, OSHA dry cleaning, EPA PCE rule, and incumbent public product pages.
- [x] Record the coworker decision in `scripts/archetype-coworker-decisions.txt`:

```text
fabric-care-services	extends:dispatcher
```

- [x] Do not add a new executable skill unless implementation discovers a real generic capability that existing coworkers cannot use.

## Task 5 - Run the archetype completeness gate

- [x] Run:

```powershell
node scripts/check-archetype-completeness.mjs
```

Observed: pass. Output: `Archetype completeness OK - Tier 1 clean for all 23 categories; 2 meet the full Tier-2 depth floor, 21 grandfathered gaps ratcheting down.`

## Task 6 - Documentation and completion gate

- [x] Decide user-doc impact. User-facing market-archetype docs and architecture/audit docs are updated because the setup catalog count and category list changed.
- [x] Run all targeted source-local commands listed in the Files section where the worktree can execute them.
- [x] If source-local package dependencies are unavailable in the worktree, classify the gate as unrun here and route runtime/build evidence through the governed shared sandbox before PR readiness.
- [x] Review `git diff` for unrelated changes.
- [ ] Commit with DCO sign-off.
- [ ] Push the branch.

## Risks and rollback

| Risk | Mitigation |
| --- | --- |
| New category fails completeness gate. | Use the gate output as the task list; do not baseline the new category. |
| Category is too broad. | Keep first pass to three leaves and defer specialty leaves to BIs. |
| Activation axes are not expressive enough. | Record the `custody-and-return-service` gap; do not add schema substrate without a separate capability design. |
| UI copy remains generic. | Use vocabulary, business-context, and realistic item/form templates. |
| Local worktree cannot run full gates. | Treat compile readiness as unproven and use governed sandbox/canonical verification before merge-ready claims. |

Rollback is source revert of the archetype substrate, corpus page, and coworker
decision before merge. No migration is planned, so there is no database rollback
path in this slice.
