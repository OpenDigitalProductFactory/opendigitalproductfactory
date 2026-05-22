# Edge Node Customer Site Binding Plan

**Date:** 2026-05-22
**Status:** In progress
**Author:** OpenAI Codex with user direction
**Spec:** `docs/superpowers/specs/2026-05-22-edge-node-customer-site-binding-design.md`

## Implementation Principle

Bind scope at the authority boundary first. The Edge Node should never self-assign a customer or site through request JSON. Every route derives customer/site context from the authenticated `EdgeNode` row.

## Chunk 1: Additive Schema Foundation

**Files:**
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260522160000_edge_node_customer_site_scope/migration.sql`
- `packages/db/src/edge-node-types.test.ts`

- [x] Add nullable scope fields to `BootstrapToken`, `EdgeNode`, `DiscoveryRun`, and `DiscoveryConnection`.
- [x] Add relations back to `CustomerAccount`, `CustomerSite`, and targeted `EdgeNode`.
- [x] Add indexes for customer account, customer site, and target Edge Node lookups.
- [x] Keep migration additive and avoid guessing existing row scope.
- [x] Update test fixtures for the generated Prisma shape.
- [x] Verify migration applies cleanly against an isolated database.

## Chunk 2: Scope Normalization Helper

**Files:**
- `apps/web/lib/edge-node/scope.ts`
- `apps/web/lib/edge-node/scope.test.ts`

- [x] Implement a shared normalizer for organization, customer-account, and customer-site scope.
- [x] Require `customerAccountId` when `customerSiteId` is set.
- [x] Generate default strict customer-scope policy metadata.
- [x] Test organization, account, site, and invalid orphan-site cases.

## Chunk 3: Bootstrap And Enrollment

**Files:**
- `apps/web/lib/edge-node/enrollment.ts`
- `apps/web/lib/edge-node/enrollment.test.ts`
- `apps/web/lib/actions/edge-nodes.ts`
- `apps/web/lib/actions/edge-nodes.test.ts`

- [x] Extend bootstrap issuance input with target customer account and optional site.
- [x] Persist target scope and default policy on `BootstrapToken`.
- [x] Copy scope from bootstrap token to `EdgeNode` during enrollment.
- [x] Include copied scope in the enrollment response.
- [x] Validate action input so site target requires customer account target.
- [x] Add tests for issuance, enrollment copy, and action forwarding.

## Chunk 4: Auth, Discovery, And Adapter Enforcement

**Files:**
- `apps/web/lib/auth/edge-node-token.ts`
- `apps/web/lib/auth/edge-node-token.test.ts`
- `apps/web/app/api/v1/edge/discovery-runs/route.ts`
- `apps/web/app/api/v1/edge/discovery-runs/route.test.ts`
- `packages/db/src/discovery-sync.ts`
- `packages/db/src/persist-submitted-discovery-run.ts`
- `packages/db/src/persist-submitted-discovery-run.test.ts`
- `apps/web/app/api/v1/edge/adapters/route.ts`
- `apps/web/app/api/v1/edge/adapters/route.test.ts`

- [x] Expose authenticated customer/site scope from `resolveEdgeNodeAuth`.
- [x] Persist discovery runs with customer/site scope from auth.
- [x] Filter adapter rows by target node, customer account, and customer site before decrypting credentials.
- [x] Preserve legacy organization-scoped adapter behavior for unscoped nodes.
- [x] Add route and helper tests for scoped and unscoped behavior.

## Chunk 5: Documentation And Handoff

**Files:**
- `docs/superpowers/specs/2026-05-22-edge-node-customer-site-binding-design.md`
- `docs/superpowers/plans/2026-05-22-edge-node-customer-site-binding-plan.md`
- `docs/superpowers/plans/2026-05-22-archetype-capability-applicability-and-msp-segmentation-plan.md`

- [x] Write the focused binding spec.
- [x] Include research and benchmarking for tenant/customer/site/device patterns.
- [x] Write this implementation plan.
- [x] Link the prior MSP applicability handoff to this focused spec/plan.

## Chunk 6: Bootstrap Scope UI

**Follow-up PR after the platform contract.** This slice makes the install-time customer/site boundary usable from `/platform/edge-nodes` without expanding into adapter management.

- [x] Add customer/site selectors to bootstrap-token issuance.
- [x] Show token and node scope badges in `/platform/edge-nodes`.
- [x] Validate server-side that a selected customer site belongs to the selected customer account.
- [ ] Add adapter target selectors for organization, customer account, customer site, and specific node.
- [x] Verify the production Docker portal route on the existing `dpf-portal-1` only, not a separate portal instance.

## Verification Gate

- [x] `pnpm --filter web exec vitest run lib/edge-node/scope.test.ts lib/edge-node/enrollment.test.ts lib/auth/edge-node-token.test.ts lib/actions/edge-nodes.test.ts lib/api/__tests__/edge-metrics-endpoints.test.ts app/api/v1/edge/adapters/route.test.ts app/api/v1/edge/discovery-runs/route.test.ts`
- [x] `pnpm exec vitest run packages/db/src/persist-submitted-discovery-run.test.ts packages/db/src/edge-node-types.test.ts`
- [x] `pnpm --filter web typecheck`
- [x] `pnpm --filter @dpf/db typecheck`
- [x] `pnpm --filter @dpf/db exec prisma migrate deploy` against an isolated database
- [x] `cd apps/web && pnpm exec next build`
- [ ] Production Docker portal smoke on the existing `dpf-portal-1` only if UI or runtime route exercise is needed.
