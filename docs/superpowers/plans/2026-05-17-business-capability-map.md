# Business Capability Map Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class Business Capability Map surface at `/portfolio/architecture` with hierarchy authoring, maturity overlays, traceability links, and IT4IT value-stream alignment.

**Architecture:** Add a dedicated `BusinessCapability` model family for the stable business architecture construct. Keep `TaxonomyNode` as a classification target, keep `EaElement` as the architecture graph target, and link to both through explicit traceability rows. The UI is a dense EA work surface: L1 families expand into L2/L3 heat-map cells, with maturity gap and linked evidence visible without turning capability modeling into taxonomy editing.

**Tech Stack:** Next.js 16 app routes, React 19, Prisma 7, PostgreSQL, Vitest, DPF theme tokens, existing EA and portfolio models.

---

## Context And Standards

Standards were used as reference language only:

- BIZBOK / Business Architecture Guild: capability maps represent stable "what the business can do" building blocks, not org charts, processes, or systems.
- ArchiMate 3.2/4 capability pattern: capability is an ability concept that can be realized by other architecture elements. DPF already seeds ArchiMate-style `business_capability` and `capability` element types, but those generic graph nodes do not provide product-grade map authoring, maturity overlay, or traceability UX.
- TOGAF capability-based planning: the map should create line of sight from goals and desired capability state to change initiatives.
- IT4IT v3.0.1: align capabilities to the seven DPF value-stream slugs already used in the platform: `evaluate`, `explore`, `integrate`, `deploy`, `release`, `consume`, `operate`.

Public reference URLs:

- https://www.businessarchitectureguild.org/resource/resmgr/whitepapers/Business_Architecture_Metamo.pdf
- https://www.opengroup.org/archimate-licensed-downloads
- https://publications.opengroup.org/g193
- https://www.opengroup.org/it4it

## Existing Model Audit

Schema audit completed before proposing new schema:

- `TaxonomyNode` classifies portfolio/product/backlog/EA records and already links to `DigitalProduct`, `BacklogItem`, `EaElement`, inventory, and discovery rules. It must not become the capability map.
- `EaElement` is the ontology graph element. It supports `digitalProductId`, `portfolioId`, `taxonomyNodeId`, `refinementLevel`, `itValueStream`, and `ontologyRole`. It is useful as an impact-analysis target, but it is too generic to own capability-map authoring and assessment history by itself.
- `EaElementType` seed data already includes `business_capability` and `capability`, plus a "Capability Map" viewpoint. That is graph/modeling infrastructure, not the portfolio EA business capability product surface.
- `DigitalProduct` and `BacklogItem` are already portfolio/backlog anchors and should be linked to capabilities through trace rows.
- `ValueStreamTeam` uses the IT4IT value stream slugs. Business capability alignment should reuse those slugs, not introduce a second value-stream enum.
- Live DPF MCP was configured but unreachable on `localhost:3000`; direct DB fallback against `dpf-dev-postgres-1` returned an empty backlog database in this worktree runtime. The existing plan `docs/superpowers/plans/2026-05-17-business-capability-employee-work-taxonomy.md` was read as repo context.

## Data Model Decision

Add first-class capability models:

```prisma
model BusinessCapability {
  id                 String   @id @default(cuid())
  capabilityId       String   @unique
  name               String
  slug               String
  description        String?
  level              Int
  sortOrder          Int      @default(0)
  status             String   @default("active")
  parentId           String?
  currentMaturity    Int      @default(1)
  targetMaturity     Int      @default(3)
  maturityRationale  String?
  it4itValueStreams  String[] @default([])
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model BusinessCapabilityTraceLink {
  id            String @id @default(cuid())
  capabilityId  String
  targetType    String
  targetId      String
  relationship  String
  note          String?
}
```

The implementation should use optional Prisma relations where they add value without forcing a polymorphic anti-pattern. A generic trace table keeps the first slice small while still allowing links to `TaxonomyNode`, `DigitalProduct`, `BacklogItem`, and `EaElement`.

## File Structure

- Modify: `packages/db/prisma/schema.prisma`
  - Add `BusinessCapability` and `BusinessCapabilityTraceLink`.
  - Add relation arrays on `TaxonomyNode`, `DigitalProduct`, `BacklogItem`, and `EaElement` only if using typed optional relations in the trace model.
- Create: `packages/db/prisma/migrations/20260517120000_add_business_capability_map/migration.sql`
  - Add tables and indexes.
- Create: `apps/web/lib/business-capabilities/types.ts`
  - Constants for maturity states, IT4IT slugs, trace target types, and view-model types.
- Create: `apps/web/lib/business-capabilities/data.ts`
  - Read hierarchy, options, trace targets, and summary metrics.
- Create: `apps/web/lib/actions/business-capabilities.ts`
  - Server actions for create capability, update maturity, and add trace link.
- Create: `apps/web/lib/business-capabilities/data.test.ts`
  - Unit tests for hierarchy, maturity-gap classification, and trace grouping.
- Create: `apps/web/components/portfolio/architecture/BusinessCapabilityMap.tsx`
  - Heat-map browsing and maturity overlay.
- Create: `apps/web/components/portfolio/architecture/BusinessCapabilityForms.tsx`
  - Client authoring controls for capability, maturity, and trace links.
- Create: `apps/web/app/(shell)/portfolio/architecture/page.tsx`
  - EA portfolio route.

## Task 1: Schema

- [ ] Add `BusinessCapability` and `BusinessCapabilityTraceLink` to `schema.prisma`.
- [ ] Generate a migration with the DPF-pinned Prisma command:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name add_business_capability_map
```

Expected: migration applies cleanly and Prisma Client regenerates.

## Task 2: Data And Actions

- [ ] Write failing unit tests for:
  - L1/L2/L3 hierarchy assembly.
  - Maturity gap classification.
  - Trace link grouping by target type.
- [ ] Implement read helpers in `apps/web/lib/business-capabilities/data.ts`.
- [ ] Implement server actions with permission checks:
  - `createBusinessCapability`
  - `updateBusinessCapabilityMaturity`
  - `createBusinessCapabilityTraceLink`
- [ ] Keep validations explicit:
  - Level must be 1, 2, or 3.
  - L2/L3 capabilities require a parent.
  - Current and target maturity must be 1 through 5.
  - IT4IT slugs must match the seven platform slugs.
  - Trace targets must resolve before insertion.

## Task 3: UI

- [ ] Build `/portfolio/architecture` as the first-screen working experience, not a landing page.
- [ ] Add an EA context header, compact metrics, authoring forms, and a three-level heat map.
- [ ] Use DPF theme tokens only. No hardcoded hex colors or Tailwind gray/white/black text colors.
- [ ] Show maturity as current vs target with gap severity:
  - `aligned`: current >= target
  - `watch`: gap = 1
  - `gap`: gap >= 2
- [ ] Render traceability grouped by Taxonomy, Product, Backlog, Architecture Element, and IT4IT value stream.

## Task 4: Verification

- [ ] `pnpm --filter web test -- apps/web/lib/business-capabilities/data.test.ts`
- [ ] `pnpm --filter web typecheck`
- [ ] `pnpm --filter @dpf/db exec prisma migrate dev`
- [ ] `pnpm --filter web build`
- [ ] UX verify `/portfolio/architecture` in the browser against the local runtime if available. If the Docker portal is not reachable, record the blocker and verify with component/unit coverage plus build output.

## Refactoring Budget

Reserve roughly 20 percent of implementation effort for refactoring:

- Keep maturity and IT4IT constants in `types.ts`, not inline in the UI.
- Keep hierarchy transformation in `data.ts`, not inside the page component.
- Keep form controls in a separate client component so the route remains a server-rendered data surface.
- Prefer narrow helpers over adding capability logic to generic portfolio or EA modules.
