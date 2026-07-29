# Operational Scene Persistence and Entity Resolution Plan

**Backlog item:** `BI-CD99DC3F`

**Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`

**Work Capsule:** `WC-60C84B36`
**Design:** `docs/superpowers/specs/2026-07-21-spatial-operational-views-design.md` §5

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Persist operator-authored `SceneLayout` geometry without duplicating live business state, then resolve each placement's `{ kind, id }` reference to its current identity and operational status in bounded, batched reads.

## Substrate verification

- `OperationalSceneLayout` is absent from `origin/main@5961ca54096800dac93ba6672ad462f899e4e20d`, the source code graph, the Prisma schema, and open pull requests.
- `EaView.canvasState` proves the one-JSON geometry pattern but is Enterprise Architecture notation state and cannot own business-operational layouts.
- `SceneLayout` v1 is the merged renderer-neutral JSON contract.
- `CareResource`, `RentableUnit`, `CustomerSite`, `CustomerConfigurationItem`, and `ServiceProvider` remain the identity and live-state owners. Geometry only references them.
- `FloorPlanCanvas` and `floor-layout.ts` remain the renderer seam; this BI does not introduce another canvas.

**Verdict:** the approved one-table addition is justified. Existing geometry persistence is notation-bound, while the domain entities already exist and must be resolved rather than copied.

## Backlog coverage

- Decision: atomic
- Parent: `BI-CD99DC3F`
- Receipt: `cms6gpln608ed01l20ikt6irq`
- Dependencies: `scene-persistence -> entity-resolution -> verification`
- Rationale: the persistence record and resolver are one scene-loading boundary. A table without entity resolution stores unusable geometry; a resolver without layouts has no operational caller.

Operational-Precedent: restaurant-floor

## Phase 1 — Persist authored geometry

1. Add `OperationalSceneLayout` with the approved fields: tenant `orgId`, `twinTemplate`, `spaceKind`, optional `locationId`, `label`, `layoutState`, optional `underlayRef`, optimistic `version`, and timestamps.
2. Relate the record to `Organization.orgId` so a layout cannot outlive or point outside its tenant.
3. Add only the approved lookup index `[orgId, twinTemplate]`.
4. Add an additive, data-safe migration. It creates an empty table, index, and foreign key; it changes no existing row.
5. Update the intentional substrate baseline from 532 to 533 models, citing this spec-approved exception.

Verification: Prisma format/validation, migration safety guard, and a clean migration apply in governed local integration.

## Phase 2 — Resolve geometry references

1. Define the supported v1 entity kinds: `care-resource`, `rentable-unit`, `customer-site`, `infra-ci`, and `table`.
2. Test-drive a pure resolver that:
   - groups and deduplicates references before I/O;
   - performs at most one lookup per supported kind;
   - preserves placement order;
   - returns explicit `resolved`, `missing`, or `unsupported` results;
   - fails closed when the organization does not exist.
3. Add the Prisma-backed lookup adapter:
   - scope care resources, rentable units, and table resources through the organization;
   - resolve customer sites and configuration items from the install-local CRM substrate while keeping the layout tenant boundary explicit;
   - select only identity/status fields.
4. Keep occupancy, reservations, GPS, and other volatile state out of `layoutState`; later renderers may overlay richer projections by the resolved entity ID.

Verification: focused tests must prove batching, deduplication, order preservation, tenant scoping where the current schema supports it, missing rows, unsupported kinds, and organization-not-found behavior.

## Phase 3 — Refactor and gate

1. Consolidate per-kind normalization behind one lookup descriptor table so adding a future entity kind does not add parallel orchestration branches.
2. Keep Prisma in the server adapter and the orchestration contract dependency-injected for fast tests and reuse.
3. Run focused tests, web typecheck, schema/policy guards, exhaustive merged-code tests, all migrations, and the production Docker build through the governed local-CI sandbox.

## Risks and rollback

- **Schema count ratchet:** the model is an intentional approved exception; the baseline update must land in the same commit and the policy guard must pass.
- **Cross-tenant lookup:** tenant-bearing models are filtered by the resolved internal organization ID. CRM customer entities are install-local today; the resolver exposes no bulk data beyond requested IDs and the layout itself remains organization-bound.
- **Stale JSON:** `schemaVersion` in `SceneLayout` and row `version` are separate. The former evolves the JSON contract; the latter supports optimistic persistence.
- **Rollback:** revert the PR before production data depends on it. The migration is additive and does not mutate existing rows; a later cleanup migration, not an edited committed migration, would remove the table.
