# AI Workforce Availability and Authority Projections

> For agentic workers: execute this plan one independently reviewable backlog item at a time - one BI, one branch, one PR. Use `dpf-tdd` for behavior changes, revalidate the backlog coverage receipt before implementation, and record verification evidence against the BI and Work Capsule.

## Outcome

Give the AI Workforce roster and coworker record one truthful source for owner-facing availability and approval labels. The projections are read models over existing governed data; they do not create a second availability or authority store.

The implementation sequence follows WWMD decision `DI-4A73DBCEC0E3`:

1. Availability projection.
2. Authority projection.
3. Four-area roster and coworker-record consumption.

Availability and authority are merged. This branch implements deliverable 3
under `BI-C810CC5A` and Work Capsule `WC-D6E5F3F4`.

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

WWMD interaction `DI-072C2AC24FB8` selected the `restriction-lattice`
approach with high confidence. The projection is a pure, evidence-bearing,
discriminated read model over existing authority sources. It does not add a
database model, authority store, or enforcement path.

Decision ledger:

| Option | Result | Rationale |
| --- | --- | --- |
| `restriction-lattice` | Selected, score `9.4964` | Preserves source evidence, fails closed, and reuses governed data without creating a second authority store |
| `hitl-only` | Rejected | Too coarse; it would ignore explicit offer and service rules |
| `live-action-probe` | Rejected | Conflates a contextual authorization check with a stable roster posture and adds runtime coupling |

The recommendation margin was `1.8566`; the kernel returned high confidence
with a usable decision signal. The lattice preserves action and resource scope
rather than turning one denied action into a global coworker restriction.

### Authority lattice

Normalize authority into these levels, ordered from strictest to loosest:

1. `cannot-act`
2. `advice-only`
3. `proposal-only`
4. `approval-required`
5. `review-required`
6. `autonomous`

The owner labels are:

- `Cannot act`
- `Advises only`
- `Prepares work for approval`
- `Acts with approval`
- `Acts with review`
- `Can act within limits`

Catalog boundaries map as follows:

| Existing value | Projection level |
| --- | --- |
| `never-allowed` | `cannot-act` |
| `advice-only` | `advice-only` |
| `proposal-only` | `proposal-only` |
| `approval-required` | `approval-required` |
| `autonomous-allowed` | `autonomous` |

Agent and service HITL tiers map as follows:

| Existing tier | Meaning | Projection level |
| --- | --- | --- |
| `0` | Human-only | `cannot-act` |
| `1` | Approve | `approval-required` |
| `2` | Review | `review-required` |
| `3` | Autonomous | `autonomous` |

### Authority precedence

1. Select the most specific base: explicit offer, else service, else agent.
2. Within that selected base, let a required offer approval or stricter
   service HITL tier narrow the declared boundary.
3. Preserve service and agent defaults as overridden evidence when a more
   specific source is selected; they do not narrow an explicit offer.
4. Apply agent-governance evidence as a general restriction.
5. For a specific action, consume the existing
   `EffectiveAuthorityExplanation` rather than recomputing grants or bindings.
   This preserves user capability, agent grants, binding subjects, binding
   grants, and binding approval modes in one canonical decision.
6. Apply native action-proposal evidence only when the projection carries an
   explicit action key and resource reference. These contextual restrictions
   may only narrow, never widen, the selected base.
7. Require explicit evaluation states. `evaluated` with no matching rows is
   distinct from `unavailable` or an omitted evaluation.
8. Require each contextual evaluation to attest the same action key and
   resource reference as the projection scope.
9. Prefer the more specific owner explanation when two candidates have equal
   restriction strength.
10. Return `Approval rules need review` when selected or downstream evidence is
   malformed, unsupported, contradictory, or missing a source reference.

### Authority scopes

- `default-posture` is the roster and coworker-record summary. It combines the
  selected catalog/agent base with agent-governance policy. It does not apply
  action-specific grants or proposals globally.
- `effective-action` adds an action key, resource reference, the canonical
  effective-authority evaluation, and native
  action-proposal evaluation. Each evaluation attests the same action/resource
  pair. This scope is suitable for a specific offer or work item, not the
  roster headline.

Catalog values are validated with the existing
`COWORKER_AUTHORITY_BOUNDARIES` registry. Projection-only levels are never
accepted as stored offer or service boundaries. Effective action decisions use
the existing `allow`, `deny`, and `require-approval` output. Proposal evidence
uses the statuses written by the current proposal surfaces: `proposed`,
`approve`, `approved`, `reject`, `rejected`, `executed`, and `failed`.
`BI-17C845C9` owns normalizing the governance API so future rows use the
canonical past-tense decision states; the read model remains tolerant of current
legacy rows until that bug lands.

Every resolved result carries:

- `label` and `summary` for the compact badge;
- `ownerReason` and `ownerAction` for the visible explanation;
- the projection scope;
- the winning source reference;
- advanced evidence with source, field, normalized level, and technical detail.

Every review-needed result carries owner guidance plus validation reasons.
Unknown arrays and objects are represented by type markers, and unrecognized
primitive strings are represented by type and length rather than returned
verbatim.

### Authority files and tests

- Add `apps/web/lib/coworker-service-catalog/authority-projection-contract.ts`.
- Add `apps/web/lib/coworker-service-catalog/authority-projection-sources.ts`.
- Add `apps/web/lib/coworker-service-catalog/authority-projection.ts`.
- Add `apps/web/lib/coworker-service-catalog/authority-projection.test.ts`.
- Cover every HITL and catalog mapping, source precedence, within-source
  tightening, general versus action scope, native governance/grant/proposal
  values, explicit evaluation states, owner-copy tie behavior, malformed and
  contradictory evidence, and the live unsupported `requirements-gate` value.
- Do not change persisted authority, delegated-action enforcement, grants, or
  action-proposal behavior. Those remain owned by `BI-62BFAA95`.

## Deliverable 3: Roster Consumers

Implement in a separate branch for `BI-C810CC5A` after both projections land.

- Load the install archetype once.
- Project roster and coworker-record labels from one shared coworker-discovery
  read model.
- Group coworkers under the four owner-facing areas defined by the live audit:
  `Customers and sales`, `Your team`, `Operations and delivery`, and `Platform and back office`.
- Keep technical evidence under progressive disclosure.
- Do not duplicate applicability or authority logic in React components.

WWMD decision `DI-36FF28260D08` selected the existing dynamic coworker-record
route as the selected coworker context. `/platform/ai/agent/[agentId]` therefore
resolves that coworker in both the client panel header and server prompt path.
The shared `AgentCoworkerPanel` remains the one conversation surface; the
roster and record do not create a parallel workspace or pass a broad agent
override through the event pipeline.

Implementation contract:

- Extract the four portfolio-to-area labels from proactivity into one shared
  owner-facing area map. `CoworkerService.portfolioId` is the classification
  source. `Agent.portfolioId` remains workforce identity placement and must
  never be used as a fallback for the work-area projection.
- Extend the normalized service catalog with the service portfolio slug and
  name. Select the first customer-inward area among a coworker's active,
  explicitly classified services; retain every classified area in Work
  Offered. Coworkers without an explicitly classified service remain in
  `Other`.
- Add `ownerAreaSlug` to the service seed definition as seed-only metadata.
  Resolve the four existing Portfolio rows once at seed time and persist their
  IDs on the service create/update payload. Do not add a schema model, enum, or
  parallel classification store. Seeded assignments are global service
  semantics, not install-specific content:
  - customer/sales and marketing services ->
    `products_and_services_sold`;
  - build, compliance, legal, finance, and provider-scout services ->
    `foundational`.
  Ordinary reseeds must converge these seeded services to their declared area;
  non-seeded services are untouched. A seed invariant fails if a declared
  portfolio slug does not resolve.
- Normalize service and health evidence across slug and canonical agent IDs.
- Derive a plain job deterministically from an active aggregate service, then
  the authored agent description, then an honest undefined label.
- Preserve customer, partner, internal, and not-defined interaction as a set
  derived only from active service declarations; cards and filters may show or
  match more than one scope.
- Aggregate availability conservatively:
  `needs-attention`, `setup-needed`, `available`,
  `coverage-not-defined`, then `not-available`.
- Until a typed setup evaluator supplies evidence, pass `not-evaluated`.
  Capability needs in `submitted` state are advanced improvement information,
  not runtime blockers. Only `blocked` rows may enter readiness evidence.
- Keep conversational entry distinct from service-readiness claims. Allow
  `Ask this coworker` when explicit leaf/category applicability matches and no
  safety blocker applies, including when setup readiness is not yet evaluated.
  Continue to label service readiness truthfully and route `setup-needed` to
  Setup.
- Keep owner filters in the URL and include the roster return URL in coworker
  record links.
- Reduce the coworker record to six sections and render a mobile section
  selector instead of wrapping a long technical tab row.
- Keep workforce health, profession coverage, raw identity, and projection
  evidence behind disclosure.
- Resolve every requested identity to one canonical record and one executable
  slug record. Apply the same `active`, non-archived, `production` predicate to
  both before creating a principal or loading prompts and skills. Unknown,
  archived, non-production, and unauthorized records cannot send work.
- Project the owner authority headline from the strictest active service
  boundary/HITL evidence plus agent governance. Agent defaults cannot widen a
  proposal-only or approval-required service.
- Index every active service name and summary in roster search.
- Do not convert service-catalog read failures into an empty catalog. Let the
  route fail into its retryable error boundary rather than presenting `Other`
  or `No active work` as if that were business truth.
- Clamp the existing shared coworker panel to the mobile viewport; the roster
  and record continue to use that one panel rather than creating another AI
  surface. Mobile mode is modal: it traps focus, marks background content
  inert, closes on Escape, and recomputes when the viewport crosses the mobile
  breakpoint.

Live evidence gathered before implementation:

- 77 visible coworkers after dual-seed alias collapse.
- Agent workforce placements populate all four canonical portfolios, but those
  placements are not valid work-area evidence.
- 10 active coworker services: 2 external and 8 internal.
- 0 active coworker services currently have an explicit portfolio assignment;
  seeded service classifications are therefore a launch dependency.
- The live install is `restaurant` / `food-hospitality`.
- The current live service declarations still name
  `software-and-platforms`; the roster must therefore show the mismatch rather
  than imply restaurant availability.
- 0 agent governance profiles currently exist; default authority therefore
  projects from `Agent.hitlTierDefault` until stricter evidence is configured.

### UX Fit Review

- Decision: `fits-with-guardrails`
- Owning area: Platform
- Route family: `/platform/ai/overview` and
  `/platform/ai/agent/[agentId]`
- Primary persona: business owner or platform operator finding the right
  coworker and starting work without understanding agent topology
- Navigation layer touched: local filters, record tabs, and contextual actions
- Reuse/convergence: existing AI Workforce route family, report-kit status and
  filter primitives, `OwnerFirstDisclosure`, and the shared
  `AgentCoworkerPanel`
- Source truth: normalized `CoworkerService` catalog plus availability and
  authority projections; service portfolio owns work-area classification
- Empty/failure behavior: unclassified coworkers remain in `Other`;
  unevaluated readiness remains `Coverage not defined`; unavailable coworkers
  cannot start work
- AI boundary: roster cards and record sections do not send prompts;
  `Ask this coworker` opens the selected shared panel without auto-sending
- Evidence before merge: focused read-model/routing tests, invalid URL filter
  tests, 1440x900 and 390x844 browser passes, keyboard tab pass, 44px action
  targets, selected-coworker panel identity, and
  `scrollWidth <= clientWidth` before and after opening the panel

An independent post-implementation critique initially returned `defer` with
P1 findings in conversational entry, service-level authority, executable
identity validation, catalog-error truthfulness, service search, and mobile
modal behavior. Those findings are merge blockers. The implementation folds
their controls into the contract above; the fit decision returns to
`fits-with-guardrails` only after targeted tests, build, and browser evidence
prove them.

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
