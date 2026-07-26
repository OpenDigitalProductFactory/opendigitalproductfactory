# AI Workforce Availability and Authority Projections

> For agentic workers: execute this plan one independently reviewable backlog item at a time - one BI, one branch, one PR. Use `dpf-tdd` for behavior changes, revalidate the backlog coverage receipt before implementation, and record verification evidence against the BI and Work Capsule.

## Outcome

Give the AI Workforce roster and coworker record one truthful source for owner-facing availability and approval labels. The projections are read models over existing governed data; they do not create a second availability or authority store.

The implementation sequence follows WWMD decision `DI-4A73DBCEC0E3`:

1. Availability projection.
2. Authority projection.
3. Four-area roster and coworker-record consumption.

This branch implements only deliverable 1 under `BI-4503457C`.

## Backlog Coverage

- Umbrella: `BI-1AE7CE65`
- Decision: `decomposed`
- Receipt: `cms1x4w5n00rf01lh562xoz3m`
- Plan path: `docs/superpowers/plans/2026-07-26-ai-workforce-availability-authority-projections.md`

| Key | Backlog item | Deliverable | Depends on |
| --- | --- | --- | --- |
| `availability-projection` | `BI-4503457C` | Truthful availability projection | None |
| `authority-projection` | `BI-F39A1A82` | Owner-readable authority projection | None |
| `roster-consumers` | `BI-C810CC5A` | Four-area roster and coworker record consume both projections | Availability and authority projections |

Related work remains separate:

- `BI-14FC40CC` may use the availability projection for roster gating, but must not make cross-cutting coworkers implicitly universal.
- `BI-62BFAA95` owns authority enforcement, delegated action decisions, and audit logging. The authority projection is display-only.

## Existing Substrate

- `StorefrontConfig.archetypeId` is the canonical install relation.
- `StorefrontArchetype.archetypeId` is the leaf slug and `StorefrontArchetype.category` is the category slug.
- `@dpf/storefront-templates` exports the governed leaf/category registry.
- `CoworkerService.archetypes` is the current positive applicability evidence.
- `apps/web/lib/coworker-service-catalog/catalog.ts` currently applies exact string matching.
- Existing authority sources include offer/service boundaries, `Agent.hitlTierDefault`, governance profiles, bindings, grants, and action proposals.

No wildcard, empty-list universal meaning, parallel availability table, or new authority editor is introduced.

## Deliverable 1: Availability Projection

### Behavior

Add a pure, non-persisted projection with these states:

- `available`: a validated leaf or category declaration matches the install.
- `setup-needed`: applicability is positive and explicit setup prerequisites are missing.
- `needs-attention`: applicability is positive and an explicit safety/provider/tool/policy blocker exists.
- `not-available`: applicability declarations are valid but none match the install.
- `coverage-not-defined`: the install context or declarations are missing, invalid, or contradictory.

The owner labels are:

- `Available for your business type`
- `Setup needed`
- `Needs attention`
- `Not available for your business type`
- `Coverage not defined`

Every result carries:

- a stable state and label;
- a plain-language reason;
- the match level (`leaf`, `category`, or none);
- source evidence for the install context, service declarations, and any setup/blocking facts.

### Precedence

1. Validate the install leaf/category and all service declarations.
2. If any required context is absent or any declaration is invalid, return `coverage-not-defined`.
3. Prefer an explicit leaf match over a category match.
4. If neither valid match applies, return `not-available`.
5. Only after positive applicability, require an explicit readiness evaluation; omitted or not-evaluated readiness returns `coverage-not-defined`.
6. For evaluated readiness, apply explicit blockers before setup prerequisites.
7. Otherwise return `available`.

`coming-later` is not inferred from non-match. It requires a future governed encoding.

### Files

- Add `apps/web/lib/coworker-service-catalog/availability-projection.ts`.
- Add `apps/web/lib/coworker-service-catalog/availability-projection.test.ts`.
- Add the dependency-free exact matcher in `apps/web/lib/coworker-service-catalog/archetype-declarations.ts` so ordinary catalog reads do not load the full storefront registry.
- Update `apps/web/lib/coworker-service-catalog/catalog.ts` only to reuse the canonical declaration matcher where exact catalog filtering needs it.
- Update `packages/db/src/coworker-service-catalog-seed.ts` to create unresolved services with an empty declaration, preserve any valid existing declarations on ordinary seed updates, and narrowly backfill only the invalid legacy `software-and-platforms` value to empty.
- Extend `packages/db/src/coworker-service-catalog-seed.test.ts` with a registry-validity invariant.
- Correct stale universal and roster-group language in `docs/superpowers/specs/2026-07-25-ai-workforce-ia-design.md`.

### Seed-Fit Decision

`global-default`. Every install should preserve valid service declarations and stop assigning unresolved services to the software archetype. The narrow legacy backfill removes a false fleet default; it does not introduce install-specific or vertical-specific content.

### TDD Cases

- Valid leaf match.
- Valid category match.
- Leaf match is reported ahead of category match.
- Valid declarations with no match return `not-available`.
- Empty declarations return `coverage-not-defined`.
- Unknown declaration returns `coverage-not-defined`, even when another declaration matches.
- When an identifier is both a governed leaf and category, canonical leaf precedence applies.
- Missing or invalid install context returns `coverage-not-defined`.
- Omitted or explicitly unevaluated readiness returns `coverage-not-defined` after positive applicability.
- Setup prerequisites are ignored for non-applicable or undefined coverage.
- Positive applicability plus blockers returns `needs-attention`.
- Positive applicability plus missing prerequisites returns `setup-needed`.
- Every non-empty seed declaration resolves to a governed category or leaf identifier; unresolved services remain empty and project as `Coverage not defined`.
- Existing exact filter behavior remains exact and does not treat empty or `*` as universal.

## Deliverable 2: Authority Projection

Implement in a separate branch for `BI-F39A1A82`.

- Normalize existing authority sources into comparable restriction levels.
- Apply explicit offer restrictions before service defaults, then agent defaults.
- Let stricter downstream governance, grant, or action-proposal restrictions win.
- Return `Approval rules need review` for malformed, contradictory, or unresolved inputs.
- Carry the winning reason and source references.
- Do not change enforcement or persisted authority.

## Deliverable 3: Roster Consumers

Implement in a separate branch for `BI-C810CC5A` after both projections land.

- Load the install archetype once.
- Project roster and coworker-record labels from the shared read models.
- Group coworkers under the four owner-facing areas defined by the live audit:
  `Customers and sales`, `Your team`, `Operations and delivery`, and `Platform and back office`.
- Keep technical evidence under progressive disclosure.
- Do not duplicate applicability or authority logic in React components.

## Refactoring Allowance

Reserve roughly one fifth of the implementation effort for consolidation that directly reduces UX drift:

- one canonical archetype registry adapter;
- one shared declaration matcher used by projection and filtering;
- projection-owned labels and reasons rather than component-owned wording.

This allowance does not authorize unrelated catalog, schema, or route refactors.

## Risk and Rollback

| Risk | Control | Rollback |
| --- | --- | --- |
| Existing invalid seed value becomes visible as unsupported | Registry invariant and explicit seed correction | Revert seed correction and projection consumer independently |
| Empty lists accidentally become universal | Dedicated regression tests | Revert shared matcher; existing exact filter remains available |
| Setup state hides an unsupported coworker | Applicability is resolved before setup | Remove setup input while retaining base projection |
| Catalog consumers change behavior | Keep exact-match filter contract and tests | Revert filter reuse without reverting projection |
| Authority display diverges from enforcement | Separate display BI and evidence-bearing output | Hide projection labels; governed enforcement remains unchanged |

No schema migration is planned.

## Verification

For each child BI:

1. Revalidate the plan coverage receipt.
2. Run targeted Vitest suites for affected projection, catalog, and seed files.
3. Run package typecheck for `web` and `@dpf/db` where source-local dependencies permit.
4. Run the production build in the governed shared local-CI environment.
5. For UI consumers, exercise roster and coworker detail at desktop and mobile sizes.
6. Record commands, SHA, environment/lease, and outcomes against the child BI and Work Capsule.

Documentation impact: the canonical AI Workforce design is corrected in deliverable 1; user-guide changes belong with the roster consumer because this projection has no direct user surface.
