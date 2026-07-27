# Governed processing activities implementation plan

**Backlog item:** BI-DG-011
**Parent epic:** EP-DATA-GOVERNANCE
**Depends on:** BI-DG-002 (done)
**Design authority:** `docs/superpowers/specs/2026-07-17-data-management-governance-design.md` §6.5
**Existing umbrella plan:** `docs/superpowers/plans/2026-07-17-data-management-governance-plan.md` Task 15

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Replace inferred compliance-string authority with explicit, organization-owned processing activities. Archetypes may suggest inactive templates, but only a confirmed, effective activity can authorize a purpose. Policy exceptions remain inactive unless their scope, approval, compensating control, expiry, and remediation references are complete.

## Backlog coverage

- Decision: atomic
- Parent: `BI-DG-011`
- Receipt: `cms3ri1kh0m8e01p513zy2vd7`
- Dependencies: `BI-DG-002` (done)
- Deliverable: `governed-processing-activities` → `BI-DG-011`
- Live prerequisite: `BI-DG-002` is done.
- Rationale: the schema, migration, validation service, applicability/retention consumers, and inactive archetype templates are one safety boundary. Models without authoritative consumers leave string matching in control; consumers without persisted confirmations create false legal authority; templates without the validation service could activate unsafe assumptions.

## Existing substrate

- `apps/web/lib/govern/data/processing-activities.ts` is the pure platform capability registry. It intentionally does not confer organization authority.
- `apps/web/lib/compliance-library.ts` combines stored regulation applicability with legacy contextual matching.
- `packages/db/src/regulation-applicability.ts` owns regional, archetype, and listing-status nexus evaluation.
- `apps/web/lib/operate/retention/industry-floors.ts` supplies conservative industry defaults.
- `Policy` and `PolicyRequirement` remain the human-readable policy substrate; executable-policy linkage must be additive rather than schema merging.
- `packages/storefront-templates` is the archetype-owned source for proposed defaults.

## Phase 1 — Contract tests (red)

**Deliverable:** executable acceptance tests before production implementation.

**Files**

- Add `packages/db/src/data-processing-governance-schema.test.ts`
- Add `apps/web/lib/govern/data/processing-activity-service.test.ts`
- Extend `apps/web/lib/compliance-library.test.ts`
- Extend `packages/db/src/regulation-applicability.test.ts`
- Add or extend storefront-template tests for inactive processing-activity templates

**Cases**

- Required stable identifiers, organization/owner, purpose, asset/field/category/subject scope, authority links, recipients/destinations, transfer/residency, lifecycle, risk/review, effective dates, confirmation, and expiry fields exist.
- An activity is authoritative only when confirmed, currently effective, not expired, and internally complete.
- Unknown or incomplete applicability remains `review`; legacy string matches never promote it to `applies`.
- An exception cannot become effective without bounded scope, approver, rationale, compensating control, expiry, and remediation BI.
- Archetype templates are proposals with provenance and an inactive/review state.
- Human policies and requirements can link to executable policy identifiers without merging their schemas.

**Verification**

Run the new focused tests and retain the expected missing-model/service failures as red evidence.

## Phase 2 — Fleet-safe persistence

**Deliverable:** additive Prisma models and forward-only migration.

**Files**

- Modify `packages/db/prisma/schema.prisma`
- Add `packages/db/prisma/migrations/<timestamp>_add_data_processing_governance/migration.sql`

**Implementation**

- Add `DataProcessingActivity` and `DataPolicyException` with stable public IDs and organization ownership.
- Use typed string values defined once in TypeScript and asserted by schema tests.
- Add additive executable-policy link fields/relations to human `Policy` and `PolicyRequirement`.
- Backfill only provenance-linked inactive/review records when existing declarations can seed a proposal. Never infer, confirm, or activate a legal basis.
- Make the migration safe for arbitrary existing data and annotate constraint safety inline.

**Verification**

- Prisma schema validation.
- Schema contract tests.
- Migration safety guard plus application through the shared local-integration sandbox.

## Phase 3 — Authoritative service boundary

**Deliverable:** one validation and resolution module used by all consumers.

**Files**

- Add `apps/web/lib/govern/data/processing-activity-service.ts`
- Add `apps/web/lib/govern/data/processing-activity-service.test.ts`
- Modify `apps/web/lib/compliance-library.ts`
- Modify `packages/db/src/regulation-applicability.ts` only where a typed confirmed-activity input belongs in the generic contract
- Modify `apps/web/lib/operate/retention/industry-floors.ts`

**Implementation**

- Separate pure validation/resolution from Prisma loading so policy behavior is deterministic and easy to test.
- Return explicit `confirmed | review | inactive | expired | invalid` posture with stable explanation codes.
- Resolve applicability from confirmed activities and executable policy first.
- Preserve regional applicability as a capability/nexus signal, not organization authorization.
- Retention floors may consume confirmed activity facts to lengthen retention, never shorten it.
- Remove legacy string matching as an authoritative `applies` path; compatibility fallbacks can only produce `review` or `reference`.

**Verification**

- Service, compliance-library, regulation-applicability, and retention tests.
- Existing callers retain compatible read shapes.

## Phase 4 — Archetype proposals and operator documentation

**Deliverable:** source-controlled template proposals and plain-language operating guidance.

**Files**

- Add a typed processing-activity-template registry under `packages/storefront-templates/src/`
- Export it through the package's existing public surface
- Extend storefront-template tests
- Update the relevant `docs/user-guide/` and architecture documentation
- Update Task 15 status in the existing data-governance plan

**Implementation**

- Templates carry stable template IDs, archetype scope, purpose, proposed data scope, authority references, and provenance.
- Templates are explicitly inactive and require an accountable owner to confirm applicability.
- Document the difference between technical purpose capability, regulatory nexus, template proposal, and confirmed organization authority.

**Verification**

- Every shipped archetype resolves a deterministic template set or an explicit empty set.
- No template shape contains an active/confirmed default.

## Refactor allocation

Reserve approximately 20 percent of implementation effort for boundary cleanup:

- extract shared status/effective-window and completeness validation instead of duplicating checks in service callers;
- centralize stable explanation codes and typed status values;
- replace compliance-library string branches with one compatibility adapter;
- keep Prisma loading separate from the pure resolver.

## Completion gate

1. Focused `@dpf/db`, `web`, and storefront-template tests pass.
2. Affected package typechecks pass.
3. Prisma validates and the migration applies cleanly in the governed sandbox.
4. Production build passes in exact merged-code local CI.
5. Documentation states that templates and nexus signals are not legal authorization.
6. `pnpm pr:health <PR>` reports all terminal checks passing and zero unresolved review threads.

## Risks and rollback

- **False authority:** a template or regional match could accidentally become active. Mitigation: inactive defaults, confirmation fields, fail-closed resolver tests, and no activation backfill.
- **Consumer regression:** existing compliance pages expect current shapes. Mitigation: preserve their read contract while changing the authority source behind it.
- **Retention regression:** new activity facts must never shorten retention. Mitigation: monotonic `max` tests.
- **Migration drift:** tightening constraints could wedge populated installs. Mitigation: additive nullable/JSON fields where appropriate, inline safety attestations, and sandbox migration evidence.
- **Rollback:** revert the application/service changes and additive migration together. The new tables/columns may remain unused safely; do not write a destructive down migration.
