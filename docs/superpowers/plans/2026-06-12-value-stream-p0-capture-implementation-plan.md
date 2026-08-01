# Value Stream P0 Capture Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Recovery note (2026-08-01):** this plan was written 2026-06-12 and stranded uncommitted in a deleted thread's worktree. Only the preamble above was rewritten on recovery — it originally invoked the `superpowers:*` skills, which have since been retired. The plan body is unchanged from 2026-06-12 and predates two months of platform change; re-verify against current `main` before executing.

**Goal:** At storefront setup and archetype reset, derive the org's Operational Value Stream Model (OVSM), persist it as an EA value-stream view, list it on the existing `/ea/value-streams` surface, render it on `/ea/views/[id]`, and keep ArchiMate export working through the existing view export path.

**Architecture:** Derive, do not author: the OVSM is a pure projection of existing archetype substrate (`OperatingModelAxes`, `ActivationProfile`, `SchedulingDefaults`, `BillingPatternProfile`, `PortfolioDecomposition`). Persist it as existing EA substrate (`EaElement`, `EaView`, `EaViewElement`, `EaRelationship`) with projection metadata and no new Prisma table. Reuse the current EA swimlane renderer by setting `properties.projection.layoutRole` to `stream_band` / `stream_stage`.

**Tech Stack:** Next.js app router, Prisma 7, pnpm workspaces, Vitest, `@dpf/storefront-templates`, `@dpf/db`, existing EA ArchiMate renderer/export pipeline.

---

## Review Corrections Applied

This revision turns the prior slice outline into an executable plan.

- Corrected scope to the current branch substrate: `ALL_ARCHETYPES` now has 56 archetypes, including `equipment-rental`, `self-storage`, and `agricultural-cooperative`.
- Added the required agentic-worker plan header and chunk/task structure.
- Split the work into test-first chunks with exact files, commands, and expected evidence.
- Made the projection service accept a Prisma client/transaction dependency so setup and archetype reset can both call it safely.
- Added package export changes that the first draft omitted.
- Kept the UI scope narrow: one widened list page plus optional metadata badges only if existing EA canvas data already supports them.
- Named runtime-bound verification separately from source-local tests, per AGENTS.md build-gate rules.

## Source Context

- Design spec: `docs/superpowers/specs/2026-06-12-value-stream-architecture-platform-design.md` §11 P0.
- Source artefact: `docs/architecture/archetype-business-value-streams.md` §3, §5, §7, §8.7, §8.8, §10.1.
- Backlog anchor: [opendigitalproductfactory#1724](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/1724), epic `EP-ARCH-8D4F2A`.
- Verified substrate in this worktree:
  - `packages/storefront-templates/src/archetypes/index.ts` includes 56 archetypes.
  - Rental/shared-asset archetypes and capabilities exist.
  - `packages/db/src/reference-model-projection.ts` already persists value-stream bands, stages, view elements, and `flows_to` relationships.
  - `apps/web/app/(shell)/ea/value-streams/page.tsx` currently filters only `scopeType: "reference_model_projection"`.
  - Setup hook is `apps/web/app/api/storefront/admin/setup/route.ts`.
  - Reset hook is `apps/web/lib/storefront/archetype-reset.ts`.

## File Map

- Create: `packages/storefront-templates/src/operational-value-stream.ts`
  - Pure OVSM derivation from `ArchetypeDefinition`.
- Create: `packages/storefront-templates/src/operational-value-stream.test.ts`
  - Tests every archetype plus representative commercial/rental/governance cases.
- Modify: `packages/storefront-templates/src/index.ts`
  - Export the derivation API.
- Create: `packages/db/src/archetype-value-stream-projection.ts`
  - Persist OVSM to EA elements/views/relationships.
- Create: `packages/db/src/archetype-value-stream-projection.test.ts`
  - Idempotency and relationship/view-element tests.
- Modify: `packages/db/package.json`
  - Add export path `./archetype-value-stream-projection`.
- Modify: `packages/db/src/index.ts` only if an existing app import needs the barrel; prefer the explicit package export path.
- Create: `apps/web/lib/storefront/project-operational-value-stream.ts`
  - App-layer orchestration: resolve the template archetype, derive OVSM, call the DB projector.
- Create: `apps/web/lib/storefront/project-operational-value-stream.test.ts`
  - Mock derivation/projector and assert setup/reset call shape.
- Modify: `apps/web/app/api/storefront/admin/setup/route.ts`
  - Call the app-layer orchestration after `StorefrontConfig` and `BusinessContext` are persisted.
- Modify: `apps/web/lib/storefront/archetype-reset.ts`
  - Call the app-layer orchestration inside the existing transaction after the target archetype is selected and capability perspective is applied.
- Modify: `apps/web/app/(shell)/ea/value-streams/page.tsx`
  - Widen list query and distinguish operational vs reference value-stream views.
- Create or modify tests near existing route/page tests as needed:
  - `apps/web/app/api/storefront/admin/setup/route.test.ts` if practical in existing pattern.
  - `apps/web/lib/storefront/archetype-reset.test.ts`.
  - `apps/web/app/(shell)/ea/value-streams/page.test.tsx` only if a local server-component test pattern already exists; otherwise cover with a focused data helper test and runtime UX verification.

---

## Chunk 1: Pure OVSM Derivation

### Task 1: Add the derivation contract

**Files:**
- Create: `packages/storefront-templates/src/operational-value-stream.ts`
- Create: `packages/storefront-templates/src/operational-value-stream.test.ts`
- Modify: `packages/storefront-templates/src/index.ts`

- [ ] **Step 1: Write failing tests for representative archetypes**

Test these cases by loading from `ALL_ARCHETYPES`:

- `hair-salon`: `appointment-checkout`, load-bearing stage `qualify`, capacity unit `slot-hours`.
- `veterinary-clinic`: `encounter-based`, load-bearing stage `deliver`, trust gate includes `clinical-adjacent`.
- `bakery`: transactional/point-of-sale, load-bearing stage `capture`, capacity unit includes durable/perishable stock as applicable from artefact category.
- `gym`: `subscription`, load-bearing stage `retain`, capacity unit `physical-capacity`.
- `it-managed-services`: `recurring-agreement`, load-bearing stage `deliver`, trust gate includes strict estate separation.
- `community-bank`: `account-based-fees`, trust gate before `qualify`, KYC/disclosure signal present.
- `small-town-municipality`: statutory/public-body, trust gate includes universal-service obligation.
- `charity`: donation, load-bearing stage `capture`, no purchase artefact.
- `equipment-rental`: reservation-and-return, stage extension includes `return-inspect` or equivalent rental-specific stage metadata.
- `self-storage`: rental/subscription occupancy, capacity unit `reusable-pooled-asset` or `physical-hard-cap` with occupancy semantics.
- `agricultural-cooperative`: member-owned + reservation-and-return, trust/governance signal includes equitable allocation.

Run:

```powershell
pnpm --filter @dpf/storefront-templates exec vitest run src/operational-value-stream.test.ts
```

Expected: FAIL because `deriveOperationalValueStream` does not exist.

- [ ] **Step 2: Implement the public types and six-stage backbone**

Define narrow string unions in `operational-value-stream.ts`, not loose `string` fields:

```ts
export type OperationalValueStreamStageKey =
  | "attract"
  | "capture"
  | "qualify"
  | "deliver"
  | "settle"
  | "retain"
  | "trust-compliance"
  | "operate-improve"
  | "return-inspect";

export type CapacityUnitType =
  | "slot-hours"
  | "service-throughput"
  | "durable-stock"
  | "perishable-stock"
  | "physical-hard-cap"
  | "billable-hours"
  | "volunteer-or-bed-capacity"
  | "loan-processing-throughput"
  | "statutory-throughput"
  | "reusable-pooled-asset"
  | "governance-cycle";

export type DemandSignature =
  | "steady"
  | "seasonal"
  | "weekly"
  | "event-driven"
  | "fiscal-calendar"
  | "rate-sensitive"
  | "emergency-reactive"
  | "synchronized-contention";
```

Keep the model explicit enough for TypeScript and tests:

```ts
export interface OperationalValueStreamStage {
  key: OperationalValueStreamStageKey;
  label: string;
  order: number;
  loadBearing: boolean;
  capabilityBindings: ArchetypeModule[];
  metricBindings: string[];
  trustGateKeys: string[];
}

export interface OperationalValueStream {
  archetypeId: string;
  archetypeName: string;
  category: string;
  stages: OperationalValueStreamStage[];
  loadBearingStageKeys: OperationalValueStreamStageKey[];
  capacityUnit: CapacityUnitType;
  demandSignature: DemandSignature;
  trustGates: string[];
  it4itStageBinding: It4ItStage[];
}
```

- [ ] **Step 3: Implement the mapping conservatively**

Rules:

- Start from the universal six stages plus two cross-cuts.
- Bind capabilities from the existing source fields named in the artefact §5.
- Use lookup maps keyed by `commercialModel`, `category`, `provisioning`, `governance`, and rental-specific `provisioning: "reservation-and-return"`.
- Do not add fields to `ArchetypeDefinition`.
- Do not parse prose from the markdown artefact at runtime.
- Include rental's `return-inspect` stage only for `reservation-and-return` archetypes; do not add it globally.

- [ ] **Step 4: Export the API**

Modify `packages/storefront-templates/src/index.ts`:

```ts
export * from "./operational-value-stream";
```

- [ ] **Step 5: Verify derivation**

Run:

```powershell
pnpm --filter @dpf/storefront-templates exec vitest run src/operational-value-stream.test.ts
pnpm --filter @dpf/storefront-templates typecheck
```

Expected: tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit the pure derivation slice**

```powershell
git add packages/storefront-templates/src/operational-value-stream.ts packages/storefront-templates/src/operational-value-stream.test.ts packages/storefront-templates/src/index.ts
git commit -s -m "feat: derive operational value streams from archetypes"
```

---

## Chunk 2: Persist OVSM to EA Substrate

### Task 2: Add the EA projection service

**Files:**
- Create: `packages/db/src/archetype-value-stream-projection.ts`
- Create: `packages/db/src/archetype-value-stream-projection.test.ts`
- Modify: `packages/db/package.json`
- Modify: `packages/db/src/index.ts` only if needed

- [ ] **Step 1: Write failing projection tests**

Use `reference-model-projection.test.ts` as the structural precedent. Tests must cover:

- First projection creates one `EaView` with `scopeType: "archetype_value_stream"` and `scopeRef: "<orgId>:operational"`.
- Projection creates one `value_stream` band plus all OVSM stages as `value_stream_stage` elements.
- Stage elements carry `properties.projection.layoutRole`, `properties.operationalValueStream.loadBearing`, `capacityUnit`, `demandSignature`, `trustGates`, `stageKey`, and `orgId`.
- Sequential primary stages have `flows_to` relationships in order.
- Re-running the same projection updates in place and creates no duplicate elements/views/view-elements/relationships.

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/archetype-value-stream-projection.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 2: Implement the service with an injectable DB dependency**

Do not hardcode the package singleton inside the service. Reset runs inside `prisma.$transaction`, so the function must accept a client-like dependency.

Shape:

```ts
export interface ProjectArchetypeValueStreamInput {
  db?: Prisma.TransactionClient | PrismaClient;
  orgId: string;
  ovsm: OperationalValueStream;
}

export async function projectArchetypeValueStream(input: ProjectArchetypeValueStreamInput): Promise<ProjectionResult>;
```

Implementation rules:

- Default `db` to package `prisma` for setup callers that do not pass a transaction.
- Look up `archimate4`, `value_stream`, `value_stream_stage`, `flows_to`, and the `Business Architecture` viewpoint exactly like `reference-model-projection.ts`.
- Use metadata to resolve idempotency:
  - `properties.projection.source = "archetype-ovsm"`
  - `properties.projection.orgId = input.orgId`
  - `properties.projection.stageKey = stage.key`
  - `properties.projection.archetypeId = ovsm.archetypeId`
- Use `EaView.scopeType = "archetype_value_stream"` and `scopeRef = "<orgId>:operational"`.
- Name the view `"<Archetype Name> — Operational Value Stream"`.
- Preserve `layoutType: "graph"` so existing canvas layout can take over.
- Add `itValueStream` when the schema field exists and current `EaElement` create/update patterns support it; otherwise store the IT4IT binding under `properties.operationalValueStream.it4itStageBinding` and leave a comment in the test.

- [ ] **Step 3: Keep projection helper refactor small**

If extracting shared helper functions from `reference-model-projection.ts` takes less than 20% of this slice, extract a small internal helper module such as `packages/db/src/ea-projection-helpers.ts`. Otherwise mirror the idempotency pattern locally and defer shared-helper cleanup. This is the planned refactoring budget for this slice.

- [ ] **Step 4: Export the service**

Modify `packages/db/package.json`:

```json
"./archetype-value-stream-projection": "./src/archetype-value-stream-projection.ts"
```

Only add a barrel export to `packages/db/src/index.ts` if an app import path needs it. Prefer:

```ts
import { projectArchetypeValueStream } from "@dpf/db/archetype-value-stream-projection";
```

- [ ] **Step 5: Verify projection**

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/archetype-value-stream-projection.test.ts src/reference-model-projection.test.ts
pnpm --filter @dpf/db typecheck
```

Expected: tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit the projection slice**

```powershell
git add packages/db/src/archetype-value-stream-projection.ts packages/db/src/archetype-value-stream-projection.test.ts packages/db/package.json packages/db/src/index.ts
git commit -s -m "feat: project archetype value streams into EA"
```

---

## Chunk 3: Wire Setup and Archetype Reset

### Task 3: Add app-layer orchestration and call it from setup/reset

**Files:**
- Create: `apps/web/lib/storefront/project-operational-value-stream.ts`
- Create: `apps/web/lib/storefront/project-operational-value-stream.test.ts`
- Modify: `apps/web/app/api/storefront/admin/setup/route.ts`
- Modify: `apps/web/lib/storefront/archetype-reset.ts`
- Modify existing tests where practical.

- [ ] **Step 1: Write failing orchestration tests**

Test the app helper with mocks:

- It finds the template archetype by `archetypeId` from `ALL_ARCHETYPES`.
- It calls `deriveOperationalValueStream(template)`.
- It calls `projectArchetypeValueStream({ db, orgId, ovsm })`.
- It throws a useful error if a DB archetype exists but the template archetype is missing.

Run:

```powershell
pnpm --filter web exec vitest run lib/storefront/project-operational-value-stream.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Implement the helper**

Suggested signature:

```ts
export async function projectOperationalValueStreamForArchetype(input: {
  db?: Prisma.TransactionClient | PrismaClient;
  organizationId: string;
  archetypeId: string;
}) {
  const template = ALL_ARCHETYPES.find((a) => a.archetypeId === input.archetypeId);
  if (!template) throw new Error(`Template archetype ${input.archetypeId} not found`);
  const ovsm = deriveOperationalValueStream(template);
  return projectArchetypeValueStream({ db: input.db, orgId: input.organizationId, ovsm });
}
```

- [ ] **Step 3: Wire setup**

In `apps/web/app/api/storefront/admin/setup/route.ts`, call the helper after `businessContext.upsert` and before returning success. Use the DB archetype's public `archetypeId` string from the request/template, not the internal row id.

Non-fatal or fatal? Make it fatal for P0. If the OVSM cannot project, setup has not completed the architecture contract.

- [ ] **Step 4: Wire reset inside the existing transaction**

In `apps/web/lib/storefront/archetype-reset.ts`, call:

```ts
await projectOperationalValueStreamForArchetype({
  db: tx,
  organizationId,
  archetypeId: targetArchetype.archetypeId,
});
```

Place it after `applyBusinessCapabilityPerspective(tx, ...)` and before returning the reset result.

- [ ] **Step 5: Extend reset tests**

In `apps/web/lib/storefront/archetype-reset.test.ts`, mock the helper and assert reset calls it with the transaction-like client, organization id, and target archetype id. If the current test harness does not expose the transaction object cleanly, assert call count and semantic arguments.

- [ ] **Step 6: Verify setup/reset wiring**

Run:

```powershell
pnpm --filter web exec vitest run lib/storefront/project-operational-value-stream.test.ts lib/storefront/archetype-reset.test.ts
pnpm --filter web typecheck
```

Expected: tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit the wiring slice**

```powershell
git add apps/web/lib/storefront/project-operational-value-stream.ts apps/web/lib/storefront/project-operational-value-stream.test.ts apps/web/app/api/storefront/admin/setup/route.ts apps/web/lib/storefront/archetype-reset.ts apps/web/lib/storefront/archetype-reset.test.ts
git commit -s -m "feat: generate operational value stream during setup"
```

---

## Chunk 4: Surface on Existing EA Value Streams UI

### Task 4: Widen the value-stream list and preserve theme-aware UI

**Files:**
- Modify: `apps/web/app/(shell)/ea/value-streams/page.tsx`
- Add tests only if existing patterns support this server component cleanly.

- [ ] **Step 1: Write or identify the smallest UI/data test**

If a server-component test pattern exists, add a test that asserts `prisma.eaView.findMany` receives:

```ts
where: { scopeType: { in: ["reference_model_projection", "archetype_value_stream"] } }
```

If no pattern exists, extract the view query into a small helper under `apps/web/lib/ea/value-stream-views.ts` and test that helper.

- [ ] **Step 2: Update the query**

Change the list query from:

```ts
where: { scopeType: "reference_model_projection" }
```

to:

```ts
where: { scopeType: { in: ["reference_model_projection", "archetype_value_stream"] } }
```

Select `scopeType` so cards can label operational vs reference views.

- [ ] **Step 3: Update card copy without creating a new surface**

Requirements:

- Keep `/ea/value-streams` as the only list route.
- Keep cards theme-aware: use `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`, and `border-[var(--dpf-border)]`.
- Label operational views as `Operational — your business`.
- Label reference projections as `Reference model`.
- Empty state must mention both ways a view can appear: setup-generated operational stream or reference-model projection.
- Do not add hardcoded colors or new card-within-card layouts.

- [ ] **Step 4: Optional badge only if data already flows**

If `getEaView()` already serializes `properties.operationalValueStream`, add a small label/badge on the canvas or card for load-bearing/capacity. Use existing styling tokens only. If this requires new renderer plumbing, defer to P1 and do not expand P0.

- [ ] **Step 5: Verify UI source**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: typecheck exits 0.

- [ ] **Step 6: Commit the UI slice**

```powershell
git add 'apps/web/app/(shell)/ea/value-streams/page.tsx' apps/web/lib/ea/value-stream-views.ts apps/web/lib/ea/value-stream-views.test.ts
git commit -s -m "feat: list operational value streams in EA"
```

Only include `apps/web/lib/ea/value-stream-views.*` if those files were created.

---

## Chunk 5: Verification and Evidence

### Task 5: Run source-local and runtime-bound gates

**Files:**
- No new files unless recording evidence through MCP/backlog tooling is available.

- [ ] **Step 1: Run targeted source-local tests**

Run:

```powershell
pnpm --filter @dpf/storefront-templates exec vitest run src/operational-value-stream.test.ts
pnpm --filter @dpf/db exec vitest run src/archetype-value-stream-projection.test.ts src/reference-model-projection.test.ts
pnpm --filter web exec vitest run lib/storefront/project-operational-value-stream.test.ts lib/storefront/archetype-reset.test.ts
```

Expected: all targeted tests PASS in the worktree.

- [ ] **Step 2: Run source-local typechecks**

Run:

```powershell
pnpm --filter @dpf/storefront-templates typecheck
pnpm --filter @dpf/db typecheck
pnpm --filter web typecheck
```

Expected: all typechecks exit 0 in the worktree.

- [ ] **Step 3: Run production build on the required substrate**

Per AGENTS.md, do not treat a worktree-local runtime as canonical evidence. Run `pnpm --filter web build` through the shared local-CI convergence sandbox lease or canonical local install after governed advance.

Evidence must name the substrate:

- `shared local-CI convergence sandbox lease`, or
- `canonical local install after governed self-upgrade`.

- [ ] **Step 4: UX verification**

Against the required runtime substrate:

1. Complete storefront setup for a representative archetype such as `equipment-rental` or `hair-salon`.
2. Open `/ea/value-streams`.
3. Confirm one operational value-stream view appears and is labeled distinctly from reference-model projections.
4. Open the view.
5. Confirm the EA canvas renders a nonblank swimlane with the value stream band and stages.
6. Export via the existing ArchiMate view export path and confirm the generated file includes value-stream elements.
7. Run archetype reset to another archetype and confirm the operational view updates idempotently rather than duplicating.

- [ ] **Step 5: Record evidence**

If DPF MCP write scope is available, record execution evidence for:

- targeted tests,
- typechecks,
- production build substrate,
- UX verification substrate,
- export verification.

If MCP is unavailable, include the command output and substrate names in the PR body.

- [ ] **Step 6: Final commit/push/PR**

Only after all required gates pass:

```powershell
git status --short
git push
```

Open a regular ready-for-review PR only after build and UX evidence are complete. Do not open a draft PR.

---

## Acceptance Criteria

- [ ] `deriveOperationalValueStream()` returns deterministic OVSM data for all 56 archetypes in `ALL_ARCHETYPES`.
- [ ] Rental/shared-asset archetypes carry the return/inspect and reusable-pooled-asset semantics without leaking that stage into non-rental archetypes.
- [ ] Setup creates exactly one `archetype_value_stream` EA view for the org.
- [ ] Archetype reset regenerates that view idempotently and does not duplicate elements, view elements, or relationships.
- [ ] `/ea/value-streams` lists both reference-model projections and the org operational stream.
- [ ] `/ea/views/[id]` renders the operational stream with existing swimlane layout.
- [ ] Existing ArchiMate export works for the generated operational value-stream view.
- [ ] No new Prisma table.
- [ ] No new route.
- [ ] UI remains theme-aware and avoids hardcoded colors.
- [ ] Targeted tests, typechecks, production build, UX verification, and export verification have named-substrate evidence.

## Out of Scope

- Stage KPI dashboards and headline metrics (P1 Measure).
- Coworker prompts, business handoffs, WWWD profile consultation (P2 Facilitate).
- Demand-calendar/capacity look-ahead and DAP proactivity (P3 Proactive-optimize).
- Full rental-family asset-pool capacity engine beyond storing the rental OVSM semantics.
- New EA routes or new standalone architecture surfaces.
