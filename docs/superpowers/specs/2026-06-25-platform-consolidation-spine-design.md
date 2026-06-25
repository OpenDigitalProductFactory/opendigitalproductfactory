# Platform Consolidation Spine - Design

**Date:** 2026-06-25
**Status:** Draft for operator review
**Author:** Codex code review and refactoring assessment
**Epic:** EP-PLATFORM-CONSOLIDATION
**Backlog items:** BI-ARCH-CONTRACTS, BI-ARCH-TOOLPACKS, BI-ARCH-DELIVERY-IA, BI-ARCH-BUILDSTUDIO-NS, BI-ARCH-SECTIONNAV, BI-ARCH-UI-PRIMS, BI-ARCH-PACKAGES

## 1. Goal

DPF is becoming a true hybrid platform: business operating system, AI coworker runtime, Build Studio, delivery control plane, architecture graph, mobile companion, and install/runtime substrate in one product. The next wave of functionality will be healthier if it lands on fewer, stronger platform seams.

This spec defines the consolidation spine for that work. The intent is not to merge every package or flatten every feature into one module. The intent is to correct the boundaries that are currently accidental, duplicated, or leaking implementation detail across web, mobile, services, AI tooling, and UI.

## 2. Operator Intent

The request that produced this spec was a code review and refactoring assessment:

- As more functionality is added, combine and collapse functionality where it tightens how features work together.
- Reassess the many packages and decide where DPF should keep independent packages versus bring code together.
- Preserve the larger product vision: an AI-first platform that hybridizes many capabilities instead of feeling like a set of unrelated tools.
- Spend a meaningful refactor budget, especially on excellent UI design and architecture.

## 3. Current-State Evidence

### 3.1 Shared contract layer leaks Prisma into portable consumers

`packages/types/package.json` depends on `@dpf/db`, and `packages/types/src/entities.ts` exports `Prisma.*GetPayload` aliases. `apps/mobile/package.json` consumes `@dpf/types`, so the mobile-facing contract layer is shaped by server persistence instead of a portable API contract.

Evidence:

- `packages/types/package.json:12`
- `packages/types/src/entities.ts:1`
- `apps/mobile/package.json:16-18`

### 3.2 MCP tools are still registered and dispatched through a mega-module

`apps/web/lib/mcp-tools.ts` owns `PLATFORM_TOOLS` and the primary `executeTool` dispatch switch. The current file is still the choke point even though several domains already delegate to smaller handlers.

Evidence:

- `apps/web/lib/mcp-tools.ts:433`
- `apps/web/lib/mcp-tools.ts:5413`
- `docs/architecture/context-engineering-standards.md:15`
- `apps/web/lib/routing/fallback.ts:211`

This is now a product risk, not just a code-style issue. DPF's local model path encodes a 15-tool local fallback threshold, while the registry surface keeps growing with every AI-first capability.

### 3.3 Delivery IA is not yet one mental home

The canonical nav model marks Build Studio as `domain: "delivery"` but places it under the `platform` shell section. Other delivery/process surfaces live under `/build`, `/build/work`, `/platform/development/change-lanes`, `/ops/dev-loop`, `/ops/promotions`, and self-upgrade views.

Evidence:

- `apps/web/lib/navigation/portal-navigation-model.ts:424-435`
- `apps/web/components/platform/platform-nav.ts:71`
- `apps/web/components/ops/OpsTabNav.tsx:7-13`

This overlaps live EP-UNIFIED-TRACKING work, especially BI-D3E09880. This spec should coordinate with that work instead of replacing it.

### 3.4 Build Studio has two production-adjacent component namespaces

The `/build` route imports both `components/build/BuildStudio` and `components/build-studio/BuildStudioV2`. Build-plan normalization still rewrites legacy `components/build-studio/*` paths to `components/build/*`.

Evidence:

- `apps/web/app/(shell)/build/page.tsx:7-8`
- `apps/web/app/(shell)/build/page.tsx:38`
- `apps/web/app/(shell)/build/page.tsx:77`
- `apps/web/app/(shell)/build/page.tsx:252`
- `apps/web/lib/integrate/build-plan-paths.ts:18-22`

That makes Build Studio a high-risk area for new WIP divergence.

### 3.5 Section navigation is implemented many times

The app has multiple `*TabNav` components and local nav data sets for Platform, Admin, Finance, Ops, Customer, EA, Storefront, Compliance, Marketing, Product, Employee, and Identity surfaces. There is already a regression test for duplicate platform tools nav, which is useful but also proves the rendering contract is distributed.

Evidence:

- `apps/web/components/platform/PlatformTabNav.tsx`
- `apps/web/components/admin/AdminTabNav.tsx`
- `apps/web/components/finance/FinanceTabNav.tsx`
- `apps/web/components/ops/OpsTabNav.tsx`
- `apps/web/app/(shell)/platform/tools/layout.test.tsx`

### 3.6 UI styling is uneven across operational surfaces

DPF has a useful operational UI kit in `apps/web/components/ui/report-kit`, including `StatusBadge`, `DataTable`, `FilterBar`, `StatCard`, `ExportButton`, and `Chart`. But active surfaces still contain many inline style objects and hard-coded colors.

Evidence:

- `apps/web/components/ui/report-kit/StatusBadge.tsx:51`
- `apps/web/components/ui/report-kit/DataTable.tsx:97`
- `apps/web/components/ui/report-kit/FilterBar.tsx:117`
- `apps/web/components/ui/report-kit/StatCard.tsx:44`
- `apps/web/components/storefront-admin/SetupWizard.tsx:226`
- `apps/web/components/platform/BuildStudioConfigForm.tsx:197`
- `apps/web/components/workspace/WorkspaceCalendar.tsx:18-25`

### 3.7 Package seams are mixed: some are real, some are accidental

The workspace includes `apps/*`, `packages/*`, and runtime services.

Evidence:

- `pnpm-workspace.yaml:1-6`
- Current scan on `origin/main`: `apps/web/lib` 2585 files, `apps/web/components` 928 files, `apps/web/app` 689 files, `packages` 933 files, `services` 143 files.

The platform should not collapse every seam. `@dpf/db`, `@dpf/api-client`, bootstrap tooling, the skill pack, edge services, ADP, and the integration harness all have runtime or distribution reasons to remain independent. The accidental seam is the portable contract layer depending on server persistence.

## 4. Research and Benchmarking

### 4.1 Open-source and standards references

| Reference | Relevant pattern | Adopt | Reject |
| --- | --- | --- | --- |
| Nx module boundaries, https://nx.dev/docs/features/enforce-module-boundaries | Enforce import boundaries with tags and dependency constraints. | Add explicit package-boundary rules and tests so portable contracts cannot depend on server DB packages. | Do not adopt Nx wholesale just to get the rule; DPF can implement a smaller local check first. |
| Backstage architecture and plugins, https://backstage.io/docs/overview/architecture-overview/ and https://backstage.io/docs/plugins/ | A developer portal can integrate many tools while keeping a cohesive catalog and plugin model. | Keep DPF domain surfaces modular, but render them through shared shell, nav, catalog, and UI primitives. | Do not let every domain ship its own navigation and UI idioms like an unrelated plugin marketplace. |
| Model Context Protocol tools spec, https://modelcontextprotocol.io/specification/2025-06-18/server/tools | Tools are named capabilities with schemas and metadata exposed to model clients. | Treat DPF tool packs as domain-owned MCP manifests with definitions, handlers, annotations, grants, and result-budget policy. | Do not keep growing one unscoped registry because the protocol permits many tools. |

### 4.2 Commercial product references

| Reference | Relevant pattern | Adopt | Reject |
| --- | --- | --- | --- |
| Atlassian navigation redesign, https://www.atlassian.com/blog/design/designing-atlassians-new-navigation | Dense work products need a durable sidebar/area navigation model, not a wide top-bar map. | Move Delivery into one primary home and use area navigation for build/work/evidence/release surfaces. | Do not duplicate the same destinations in multiple chrome layers. |
| Microsoft Fluent tabs guidance, https://learn.microsoft.com/en-us/fluent-ui/web-components/components/tabs | Tabs are for related panels/views, not whole product sprawl. | Replace large cloned tab strips with a shared section-nav renderer and grouped area navigation. | Do not use tabs as the default answer for every section hierarchy. |
| GitHub Checks/status and reusable workflow docs, https://docs.github.com/articles/about-status-checks and https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows | Evidence and reusable process definitions can be producer-agnostic while still rendering in one timeline/check surface. | Treat Delivery evidence and tool-pack process as reusable, surface-agnostic contracts. | Do not fork Build Studio flows by producing surface or AI client. |
| Jira workflow schemes, https://www.atlassian.com/software/jira/guides/workflows/overview | Work types can share a system while following different process schemes. | Let Delivery expose one home while different work types keep their appropriate lifecycle policy. | Do not make separate products for build, dev loop, release, and evidence just because their workflows differ. |

## 5. Architectural Decision

DPF should consolidate around four platform substrates:

1. **Portable contracts.** DTOs, Zod schemas, and API client types that web, mobile, services, and AI tools can share without importing Prisma.
2. **Scoped AI tool packs.** Domain-owned tool manifests that compose into the MCP registry by route, grant, execution mode, and build phase.
3. **Delivery as a first-class area.** One operator home for builds, work capsules, evidence, external-agent tracking, change lanes, promotion, and upgrade/release status.
4. **Operational UI primitives.** Shared navigation, status, table, filter, card, chart, form, and tokenized styling primitives for the dense operational surfaces DPF actually is.

The package consolidation rule is:

> Collapse accidental seams; preserve runtime, deployment, distribution, and trust boundaries.

That means contract inversion comes before package deletion. It is safer to remove `@dpf/db` from portable packages than to merge portable packages into the web app. It is safer to split `mcp-tools.ts` by domain than to move all MCP behavior into a new giant "platform" module.

## 6. Target Design

### 6.1 Portable contracts

Introduce or reshape a pure contract layer. The final package name can be `@dpf/contracts` or a cleaned `@dpf/types` plus `@dpf/validators`; the invariant matters more than the name:

- No portable package may import `@dpf/db` or Prisma payload types.
- API DTOs are explicit and stable across web, mobile, services, and MCP.
- Zod schemas live with DTOs where validation is part of the contract.
- Prisma payload helper types remain server-only under `@dpf/db` or `apps/web/lib/server-*`.
- `@dpf/api-client` consumes contract DTOs, not raw Prisma aliases.

Recommended migration:

1. Create contract DTOs for the highest-use mobile/API types first.
2. Replace mobile imports from Prisma-derived entities with DTOs.
3. Keep temporary server-side mappers from Prisma payloads to contract DTOs.
4. Add a dependency guard that fails if the portable contract package imports `@dpf/db`.

### 6.2 Scoped MCP tool packs

`mcp-tools.ts` should become a composition layer, not the domain implementation. Each tool pack owns:

- tool definitions
- handler map
- required capability and grant metadata
- optional route context, build phase, and execution-mode exposure rules
- concise result policy and pagination expectations
- tests for definition hygiene, grant gating, and handler parity

Candidate first packs:

- `backlog`
- `build`
- `work-capsules`
- `runtime-coordination`
- `platform-admin`
- `tool-marketplace`
- `wiki/principles`
- `screen/pseudo-user-contract`

The external MCP route and native coworker loop should both select small, scoped catalogs. The local fallback path should not receive a tool surface that exceeds the 15-tool threshold unless it intentionally skips local fallback with a clear reason.

### 6.3 Delivery area

Create one Delivery home and nav group. The home should route the operator to:

- Build Studio
- Work control / capsules
- Unified evidence timeline
- Change lanes
- External agent work tracking
- Promotions and release readiness
- Governed self-upgrade status where it represents delivery/release evidence

Platform AI should keep Build Studio configuration under Platform because model/provider configuration is platform administration. The operator path for doing delivery work should be Delivery.

Deep links must be preserved:

- `/build`
- `/build/work`
- `/platform/development/change-lanes`
- `/ops/dev-loop`
- `/ops/promotions`
- relevant self-upgrade evidence/status paths

This design extends EP-UNIFIED-TRACKING. It should not create a second timeline model.

### 6.4 Build Studio namespace convergence

There should be one production Build Studio component namespace.

Decision path:

- If `BuildStudioV2` is the future shell, graduate it into `apps/web/components/build` and wire it to production data.
- If it is a prototype, move it to an explicit prototype/demo home and remove accidental `/build` access.
- Remove `LEGACY_BUILD_STUDIO_PATH_ALIASES` once Build Studio plans no longer generate stale `components/build-studio/*` paths.

Acceptance is not "fewer folders"; acceptance is that Build Studio plans, tests, docs, and agent-generated file paths all point to the same production namespace.

### 6.5 Shared SectionNav renderer

Replace cloned `*TabNav` rendering with one shared renderer:

- `SectionNav` renders top-level families, sibling links, sub-items, active state, overflow, responsive behavior, and duplicate-subnav prevention.
- Section data can remain domain-owned, but it must be converted into a shared shape.
- The canonical portal navigation model should own shell-level facts. Domain nav modules should own only domain-specific grouping labels when needed.

First migration candidates:

1. Platform
2. Admin
3. Finance
4. Ops

These have enough overlap to prove the abstraction without touching every domain at once.

### 6.6 Operational UI primitive adoption

DPF should look and feel like a sophisticated operational tool, not a collection of page-local demos. The existing `report-kit` is a good starting point. Expand and standardize around:

- status badges
- stat cards
- dense data tables
- filter bars
- charts
- form rows and settings sections
- action bars
- empty/loading/error states
- color/status token maps

Initial slices:

- Build Studio configuration form
- Storefront setup wizard or operating-model wizard
- Workspace calendar/status colors

Add a lightweight guard for new hard-coded hex colors and large inline style blocks outside approved token or chart-theme files. Existing pages should be migrated as they are touched; do not run a blind mass rewrite.

### 6.7 Package and service boundary table

| Area | Direction | Rationale |
| --- | --- | --- |
| `@dpf/db` | Keep | Persistence and Prisma ownership are a real server boundary. |
| `@dpf/types` | Reshape or replace | Current shape leaks Prisma into portable consumers. |
| `@dpf/validators` | Keep or merge into contracts | Pure validation is portable; merge only if it simplifies contract ownership. |
| `@dpf/api-client` | Keep | Mobile and external consumers need a stable client boundary. |
| `@dpf/dpf-bootstrap` | Keep | Distribution/install tooling is not app runtime. |
| `@dpf/dpf-skill-pack` | Keep | Plugin/skill payload is a distribution artifact, not normal web code. |
| `storefront-templates` and `finance-templates` | Evaluate | Could become one template/archetype registry if contracts are clean first. |
| `services/adp` | Keep | Runtime service boundary. |
| `services/edge-node` | Keep | Deployment/runtime boundary. |
| `services/integration-test-harness` | Keep | Verification harness boundary. |

## 7. Backlog Filed

| BI | Title | Size | Dependency notes |
| --- | --- | --- | --- |
| BI-ARCH-CONTRACTS | Invert shared contracts away from Prisma payload types | Large | Should start before mobile/API expansion. |
| BI-ARCH-TOOLPACKS | Split the MCP registry into scoped domain tool packs | XLarge | Coordinates with context-engineering standards and coworker grants work. |
| BI-ARCH-DELIVERY-IA | Create one Delivery home for builds, work, evidence, change lanes, and dev-loop status | Large | Must coordinate with EP-UNIFIED-TRACKING and BI-D3E09880. |
| BI-ARCH-BUILDSTUDIO-NS | Converge Build Studio component namespaces and retire legacy path aliases | Large | Should land before more Build Studio UX WIP. |
| BI-ARCH-SECTIONNAV | Replace per-section TabNav clones with a canonical SectionNav renderer | Large | Can begin with Platform/Admin/Finance/Ops. |
| BI-ARCH-UI-PRIMS | Adopt operational UI primitives and tokenized styling on active surfaces | Large | Pair with active UI work; requires screenshot verification. |
| BI-ARCH-PACKAGES | Define package/service boundary rules and collapse only accidental package seams | Medium | Depends on contract inversion for the first real enforcement. |

## 8. Phasing

### Phase 0 - Guardrails and planning

- Attach this spec path to EP-PLATFORM-CONSOLIDATION.
- Confirm BI ownership and priorities against active WIP.
- Add a package-boundary check plan.
- Identify which active Build Studio/Delivery work should be redirected to this spine instead of opening new parallel BIs.

### Phase 1 - Contract inversion

- Create or reshape the portable contract layer.
- Remove the `@dpf/db` dependency from portable/mobile-facing types.
- Add mappers at server boundaries.
- Update mobile and API client imports.
- Add dependency guard tests.

### Phase 2 - MCP tool packs

- Define `ToolPack` shape.
- Extract backlog/build/capsule/runtime packs first.
- Keep `mcp-tools.ts` as a thin compatibility composition layer during migration.
- Prove parity through current MCP route tests and grant-filter tests.
- Keep local fallback tool surfaces below the context threshold where possible.

### Phase 3 - Delivery and Build Studio convergence

- Add the Delivery home/section.
- Preserve deep links and redirects.
- Move or graduate `BuildStudioV2`.
- Remove legacy Build Studio path aliases after plan-generation tests stop needing them.
- UX verify the Delivery path and Build Studio path across desktop and mobile widths.

### Phase 4 - Navigation and UI primitives

- Build shared `SectionNav`.
- Migrate Platform/Admin/Finance/Ops.
- Expand operational UI primitives where needed.
- Migrate Build Studio config plus one setup/calendar surface.
- Add visual evidence and style drift guard.

### Phase 5 - Package boundary cleanup

- Document the package keep/merge/split table as a durable architecture standard.
- Evaluate template registry consolidation.
- Add a future-package checklist: every new package must declare its boundary reason.

## 9. Verification Gates

All implementation PRs under this epic must satisfy the normal DPF build gate:

- targeted unit tests for affected packages
- `pnpm --filter web build` when touching web/runtime-bound code
- UX verification for Delivery, Build Studio, nav, or UI primitive changes
- migration apply evidence when schema changes are added
- MCP/backlog evidence updates when BIs are completed

Additional gates:

- Contract work must prove no portable package imports `@dpf/db`.
- Tool-pack work must prove definition discovery and execute dispatch parity.
- Delivery IA work must prove legacy deep links still resolve.
- SectionNav work must include duplicate-subnav regression coverage.
- UI primitive work must include before/after screenshots and token/style drift checks.

## 10. Risks

### R1. The epic is broad enough to become a dumping ground

Mitigation: keep the BIs as independent slices. Do not add unrelated cleanup because it feels like "consolidation."

### R2. Package consolidation could erase useful runtime boundaries

Mitigation: collapse only accidental seams. Runtime, deployment, distribution, and trust boundaries stay unless a later spec proves otherwise.

### R3. Tool-pack extraction can break authority controls

Mitigation: move metadata with the handler, not after it. Every extracted pack must keep grant, token-scope, phase, route-context, and execution-mode tests.

### R4. Navigation changes can strand existing users and agents

Mitigation: preserve links and redirects. Update route context and coworker assumptions in the same slice as nav moves.

### R5. UI cleanup can become decorative polish instead of workflow improvement

Mitigation: migrate active operational workflows first and verify actual interaction paths, not isolated component screenshots only.

## 11. Open Decisions

1. Should `@dpf/contracts` be a new package, or should `@dpf/types` be repaired in place?
2. Should Delivery become a new top-level shell rail item immediately, or first ship as a grouped route under the current shell while nav data converges?
3. Should `BuildStudioV2` graduate, be retired, or be quarantined as a prototype?
4. Should the initial style drift guard be advisory-only or fail CI for new inline hex/style additions outside approved files?

## 12. Recommended Next Step

Start with BI-ARCH-CONTRACTS and BI-ARCH-TOOLPACKS. They address the two deepest architectural risks: persistence leaking into portable contracts and model-facing tools growing beyond the local context economy. BI-ARCH-DELIVERY-IA and BI-ARCH-BUILDSTUDIO-NS should run next or in parallel with active Build Studio UX work so future UI investment lands on the converged surface.
