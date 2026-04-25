# Platform IA: Tools, AI, Admin, and Native Integrations Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the reviewed Platform Hub IA refactor by clarifying canonical homes for AI runtime management, connection lifecycle management, built-in tools, and admin configuration without replacing the existing platform shell.

**Architecture:** Deliver this in thin, low-churn slices.

1. **Navigation truth pass.** Fix labels, targets, and family boundaries first so the shell stops telling the wrong story.
2. **Canonical-home pass.** Move prompts and skills into AI Operations, narrow Providers to provider/routing concerns, and remove redirect-only audit concepts from the AI family.
3. **Tools lifecycle pass.** Add a Built-in Tools home, move Brave Search configuration there, and make each Tools page describe one lifecycle stage.
4. **Catalog and data-shape pass.** Add a typed cross-source connection catalog aggregation layer and classify non-MCP service providers so the new IA is honest.
5. **Documentation pass.** Update the still-referenced internal specs and QA docs that currently encode the old IA labels and canonical homes.
6. **Verification and rollout pass.** Land redirects, QA, backlog updates, and production-path verification before calling the refactor done.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma 7, PostgreSQL, Vitest, Playwright/platform QA.

**Spec:** `docs/superpowers/specs/2026-04-24-platform-ia-tools-ai-admin-refactor-design.md`

---

## Scope Check

- Keep the current top-level Platform families: `Overview`, `Identity & Access`, `AI Operations`, `Tools & Services`, `Governance & Audit`, `Core Admin`.
- Do not invent a new universal capability schema before the UI model is stable.
- Keep `PlatformConfig.brave_search_api_key` as-is; only move its canonical UI home.
- Keep current route families and use redirects where the canonical home changes.
- Treat the existing live epic as the delivery umbrella:
  - `ep_int_harness_benchmarking_20260423`
  - in-progress item: `bi-int-b4d291`
- This remains one implementation plan with several focused PRs, not several unrelated plans.

## File Map

**Platform shell and navigation**
- Modify: `apps/web/components/platform/platform-nav.ts`
- Modify: `apps/web/components/platform/platform-nav.test.ts`
- Modify: `apps/web/components/platform/PlatformTabNav.tsx`
- Modify: `apps/web/components/platform/PlatformTabNav.test.tsx`
- Modify: `apps/web/components/platform/AiTabNav.tsx`
- Modify: `apps/web/components/platform/ToolsTabNav.tsx`
- Modify: `apps/web/app/(shell)/platform/page.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/page.tsx`

**AI Operations canonical homes**
- Create: `apps/web/app/(shell)/platform/ai/prompts/page.tsx`
- Create: `apps/web/app/(shell)/platform/ai/prompts/page.test.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/skills/page.tsx`
- Create: `apps/web/app/(shell)/platform/ai/skills/page.test.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/providers/page.tsx`
- Create: `apps/web/app/(shell)/platform/ai/providers/page.test.tsx`
- Modify: `apps/web/app/(shell)/admin/prompts/page.tsx`
- Modify: `apps/web/app/(shell)/admin/skills/page.tsx`
- Modify: `apps/web/lib/actions/prompt-admin.ts`
- Modify: `apps/web/lib/actions/skill-marketplace.ts`
- Modify: `apps/web/lib/actions/skills-observatory.ts`

**Tools & Services surfaces**
- Modify: `apps/web/app/(shell)/platform/tools/catalog/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/services/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/integrations/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/discovery/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/inventory/page.tsx`
- Create: `apps/web/app/(shell)/platform/tools/built-ins/page.tsx`
- Create: `apps/web/app/(shell)/platform/tools/built-ins/page.test.tsx`
- Modify: `apps/web/app/(shell)/admin/settings/page.tsx`
- Modify: `apps/web/components/admin/PlatformKeysPanel.tsx`
- Modify: `apps/web/lib/actions/capability-inventory.ts`
- Create: `apps/web/lib/actions/built-in-tools.ts`
- Create: `apps/web/lib/actions/built-in-tools.test.ts`

**Catalog aggregation and provider classification**
- Create: `apps/web/lib/actions/connection-catalog.ts`
- Create: `apps/web/lib/actions/connection-catalog.test.ts`
- Modify: `apps/web/lib/actions/mcp-catalog.ts`
- Modify: `apps/web/lib/actions/mcp-services.ts`
- Modify: `apps/web/lib/actions/ai-providers.ts`
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_platform_connection_kinds/migration.sql`
- Modify: `packages/db/src/seed.ts`

**QA and release evidence**
- Modify: `tests/e2e/platform-qa-plan.md`

**Documentation refresh**
- Modify: `docs/superpowers/specs/2026-04-11-business-setup-unification-design.md`
- Modify: `docs/superpowers/specs/2026-04-12-unified-capability-and-integration-lifecycle-design.md`
- Modify: `docs/superpowers/specs/2026-04-18-purpose-first-product-estate-design.md`
- Modify: `docs/superpowers/specs/2026-04-24-platform-ia-tools-ai-admin-refactor-design.md`

---

## Chunk 1: Navigation Truth and Family Boundaries

### Task 1: Fix Platform family labels, targets, and redirect-only leftovers

**Files:**
- Modify: `apps/web/components/platform/platform-nav.ts`
- Modify: `apps/web/components/platform/platform-nav.test.ts`
- Modify: `apps/web/components/platform/PlatformTabNav.tsx`
- Modify: `apps/web/components/platform/PlatformTabNav.test.tsx`
- Modify: `apps/web/components/platform/AiTabNav.tsx`
- Modify: `apps/web/components/platform/ToolsTabNav.tsx`

- [ ] **Step 1: Update the canonical labels in `platform-nav.ts`**

Change subitems to match the reviewed spec exactly:
- `Routing & Calibration` -> `Providers & Routing`
- `Services` -> `MCP Services`
- `Enterprise Integrations` -> `Native Integrations`
- `Discovery Operations` -> `Estate Discovery`

Remove AI-family subitems that only redirect to Audit:
- `Operations`
- `Authority`

- [ ] **Step 2: Fix the Native Integrations nav target**

Ensure the Tools family points to:

```text
/platform/tools/integrations
```

and not the current ADP detail route.

- [ ] **Step 3: Keep nav component ordering aligned with the new IA**

Update `AiTabNav.tsx`, `ToolsTabNav.tsx`, and any shared tab-nav ordering logic so the rendered order matches the spec:
- AI: `Overview`, `Workforce`, `Assignments`, `Prompts`, `Skills`, `Providers & Routing`, `Build Runtime`
- Tools: `Hub`, `Connection Catalog` or `MCP Catalog`, `MCP Services`, `Native Integrations`, `Built-in Tools`, `Estate Discovery`, `Capability Inventory`

- [ ] **Step 4: Add or update nav tests**

Extend `platform-nav.test.ts` and `PlatformTabNav.test.tsx` to assert:
- no leftover legacy labels remain
- AI family no longer exposes redirect-only audit items
- Native Integrations points to the integrations index
- Built-in Tools appears in the Tools family

- [ ] **Step 5: Run focused nav tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/components/platform/platform-nav.test.ts apps/web/components/platform/PlatformTabNav.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/platform/platform-nav.ts apps/web/components/platform/platform-nav.test.ts apps/web/components/platform/PlatformTabNav.tsx apps/web/components/platform/PlatformTabNav.test.tsx apps/web/components/platform/AiTabNav.tsx apps/web/components/platform/ToolsTabNav.tsx
git commit -s -m "feat(platform): align platform navigation with reviewed IA"
```

### Task 2: Reframe family landing pages so the shell and page copy tell the same story

**Files:**
- Modify: `apps/web/app/(shell)/platform/page.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/page.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/page.test.tsx`

- [ ] **Step 1: Update family overview copy**

Make the landing pages explicitly describe family ownership:
- AI Operations = coworkers, prompts, skills, providers/routing, build runtime
- Tools & Services = connection lifecycle, built-in tools, estate discovery, runtime inventory
- Governance & Audit = evidence and oversight, not runtime setup

- [ ] **Step 2: Keep route structure stable**

Do not introduce a new `/platform/ai/workforce` route in this pass. Keep `/platform/ai` as the root surface while the nav can still show both `Overview` and `Workforce` as the same canonical home if needed.

- [ ] **Step 3: Add a small regression test for AI landing content**

Update `apps/web/app/(shell)/platform/ai/page.test.tsx` so it asserts the new AI-family copy and does not mention audit-only concepts as first-class AI subsections.

- [ ] **Step 4: Run focused page tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/app/(shell)/platform/ai/page.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/platform/page.tsx apps/web/app/(shell)/platform/ai/page.tsx apps/web/app/(shell)/platform/tools/page.tsx apps/web/app/(shell)/platform/ai/page.test.tsx
git commit -s -m "feat(platform): clarify platform family ownership copy"
```

## Chunk 2: Move AI Runtime Concerns Out of Admin

### Task 3: Create the canonical Prompts home under AI Operations

**Files:**
- Create: `apps/web/app/(shell)/platform/ai/prompts/page.tsx`
- Create: `apps/web/app/(shell)/platform/ai/prompts/page.test.tsx`
- Modify: `apps/web/app/(shell)/admin/prompts/page.tsx`
- Modify: `apps/web/lib/actions/prompt-admin.ts`

- [ ] **Step 1: Build the new canonical page before redirecting**

Create `/platform/ai/prompts` using the existing `prompt-admin` data/actions so the new home renders the same prompt-template data set and reset behavior as the current Admin page.

- [ ] **Step 2: Convert `/admin/prompts` into a redirect**

After the new page is live, replace the Admin page with a redirect to:

```text
/platform/ai/prompts
```

Use `permanentRedirect` once the new route is complete in the same PR.

- [ ] **Step 3: Add prompt-route tests**

Create tests that prove:
- `/platform/ai/prompts` renders the prompt management surface
- `/admin/prompts` redirects to the canonical AI route

- [ ] **Step 4: Run focused prompt tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/app/(shell)/platform/ai/prompts/page.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/prompts/page.tsx apps/web/app/(shell)/platform/ai/prompts/page.test.tsx apps/web/app/(shell)/admin/prompts/page.tsx apps/web/lib/actions/prompt-admin.ts
git commit -s -m "feat(ai): move prompt management to AI Operations"
```

### Task 4: Unify skill catalog and observability under `/platform/ai/skills`

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/skills/page.tsx`
- Create: `apps/web/app/(shell)/platform/ai/skills/page.test.tsx`
- Modify: `apps/web/app/(shell)/admin/skills/page.tsx`
- Modify: `apps/web/lib/actions/skill-marketplace.ts`
- Modify: `apps/web/lib/actions/skills-observatory.ts`

- [ ] **Step 1: Expand the AI Skills page into the canonical home**

Refactor `/platform/ai/skills` so it combines:
- skill catalog management
- route-skill visibility where applicable
- existing observability content

Use internal sections or tabs such as:
- `Catalog`
- `Route Skills`
- `Observability`

- [ ] **Step 2: Convert `/admin/skills` into a redirect**

Replace the Admin route with a redirect to:

```text
/platform/ai/skills
```

- [ ] **Step 3: Keep data sources stable**

Reuse `skill-marketplace.ts` and `skills-observatory.ts`; do not invent a parallel skills data layer for this move.

- [ ] **Step 4: Add regression coverage**

Add or extend tests to verify:
- the AI Skills page renders both management and observability content
- `/admin/skills` redirects to the AI canonical route

- [ ] **Step 5: Run focused skills tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/app/(shell)/platform/ai/skills/page.test.tsx
```

Add any focused action tests in the same pass if execution logic changes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/skills/page.tsx apps/web/app/(shell)/admin/skills/page.tsx apps/web/lib/actions/skill-marketplace.ts apps/web/lib/actions/skills-observatory.ts
git commit -s -m "feat(ai): unify skills catalog and observability under AI Operations"
```

### Task 5: Narrow Providers to provider and routing concerns only

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/providers/page.tsx`
- Create: `apps/web/app/(shell)/platform/ai/providers/page.test.tsx`
- Modify: `apps/web/lib/actions/ai-providers.ts`
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Remove non-provider sections from the Providers page**

Delete or move out:
- `Activated MCP Services`
- generic `Tool Inventory`

Keep:
- provider registry
- routing/calibration controls
- token spend
- provider/routing scheduled jobs

- [ ] **Step 2: Align provider data loaders with the new page scope**

Update `ai-providers.ts` so the page queries only provider/routing data required by the reviewed IA.

- [ ] **Step 3: Remove any stale TODO that assumes MCP services still live here**

The reviewed spec calls out the current TODO in this page as work to complete, not leave behind.

- [ ] **Step 4: Add or update tests for provider-page scope**

Add assertions that the page no longer renders MCP service operations while still rendering provider/routing content.

- [ ] **Step 5: Run focused provider tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/actions/ai-providers.test.ts apps/web/app/(shell)/platform/ai/providers/page.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/providers/page.tsx apps/web/lib/actions/ai-providers.ts apps/web/lib/mcp-tools.ts
git commit -s -m "feat(ai): narrow providers to provider and routing concerns"
```

## Chunk 3: Clarify Tools, Built-ins, and Runtime Inventory

### Task 6: Add Built-in Tools and move Brave Search out of Admin settings

**Files:**
- Create: `apps/web/app/(shell)/platform/tools/built-ins/page.tsx`
- Create: `apps/web/app/(shell)/platform/tools/built-ins/page.test.tsx`
- Create: `apps/web/lib/actions/built-in-tools.ts`
- Create: `apps/web/lib/actions/built-in-tools.test.ts`
- Modify: `apps/web/app/(shell)/admin/settings/page.tsx`
- Modify: `apps/web/components/admin/PlatformKeysPanel.tsx`
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Define the built-in tools descriptor layer**

Create a small typed descriptor set for the first built-in tools:
- Brave Search
- public web fetch
- branding analyzer

This descriptor layer should power the new Built-in Tools page and the future connection catalog union.

- [ ] **Step 2: Create the Built-in Tools page**

The new page should show, at minimum:
- tool identity and description
- whether external credentials are required
- current configuration state
- runtime/capability relationship where relevant

- [ ] **Step 3: Move Brave Search configuration without changing the stored key**

Move the `brave_search_api_key` edit surface off `/admin/settings` and into `/platform/tools/built-ins`.

Do not:
- rename the config key
- duplicate writes into a second storage key
- change the permission model unless a separate security review requires it

- [ ] **Step 4: Remove Brave Search from Admin settings**

Update `PlatformKeysPanel.tsx` and the surrounding settings page so Admin no longer presents Brave Search as generic install configuration.

- [ ] **Step 5: Add focused built-in-tool tests**

Cover:
- Built-in Tools page renders Brave Search from `PlatformConfig`
- Admin settings no longer exposes the Brave Search field
- writes still round-trip through the existing key

- [ ] **Step 6: Run focused built-in-tool tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/actions/built-in-tools.test.ts apps/web/app/(shell)/platform/tools/built-ins/page.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/(shell)/platform/tools/built-ins/page.tsx apps/web/app/(shell)/platform/tools/built-ins/page.test.tsx apps/web/lib/actions/built-in-tools.ts apps/web/lib/actions/built-in-tools.test.ts apps/web/app/(shell)/admin/settings/page.tsx apps/web/components/admin/PlatformKeysPanel.tsx apps/web/lib/mcp-tools.ts
git commit -s -m "feat(tools): add built-in tools home and move Brave Search config"
```

### Task 7: Make every Tools page describe one lifecycle stage

**Files:**
- Modify: `apps/web/app/(shell)/platform/tools/catalog/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/services/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/integrations/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/discovery/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/inventory/page.tsx`
- Modify: `apps/web/lib/actions/capability-inventory.ts`

- [ ] **Step 1: Make the catalog honest in the short term**

If the cross-source aggregation has not landed yet, rename or subtitle the page as `MCP Catalog` and explicitly link to:
- `Native Integrations`
- `Built-in Tools`

- [ ] **Step 2: Relabel page-level copy to match lifecycle**

Update page headers/descriptions so operators can tell:
- `MCP Services` = configured MCP server operations
- `Native Integrations` = DPF-owned business-system integrations
- `Estate Discovery` = infrastructure/product-estate discovery
- `Capability Inventory` = runtime view, not setup catalog

- [ ] **Step 3: Add explicit runtime inventory copy**

`Capability Inventory` must state that it reflects what agents can use at runtime, not what can be newly connected.

- [ ] **Step 4: Keep Discovery qualified everywhere**

Remove unqualified “Discovery” wording from the Tools family where it refers specifically to estate discovery.

- [ ] **Step 5: Add or update tests for page copy**

Add focused tests asserting the new headers/help text on the Tools pages and the runtime-inventory warning on `/platform/tools/inventory`.

- [ ] **Step 6: Run focused Tools-page tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/actions/capability-inventory.test.ts
```

Include any new page tests in the same run.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/(shell)/platform/tools/catalog/page.tsx apps/web/app/(shell)/platform/tools/services/page.tsx apps/web/app/(shell)/platform/tools/integrations/page.tsx apps/web/app/(shell)/platform/tools/discovery/page.tsx apps/web/app/(shell)/platform/tools/inventory/page.tsx apps/web/lib/actions/capability-inventory.ts
git commit -s -m "feat(tools): align tools surfaces to connection lifecycle stages"
```

## Chunk 4: Cross-Source Catalog and Provider Classification

### Task 8: Add a typed connection catalog aggregation layer

**Files:**
- Create: `apps/web/lib/actions/connection-catalog.ts`
- Create: `apps/web/lib/actions/connection-catalog.test.ts`
- Modify: `apps/web/app/(shell)/platform/tools/catalog/page.tsx`
- Modify: `apps/web/lib/actions/mcp-catalog.ts`
- Modify: `apps/web/lib/actions/mcp-services.ts`
- Modify: `apps/web/lib/actions/built-in-tools.ts`

- [ ] **Step 1: Create a discriminated union for catalog entries**

Define:

```ts
type ConnectionCatalogEntry =
  | { kind: "mcp"; ... }
  | { kind: "native"; ... }
  | { kind: "built-in"; ... };
```

The aggregator should union:
- live MCP catalog entries
- native integration descriptors
- built-in tool descriptors

- [ ] **Step 2: Keep this as a UI aggregation layer**

Do not merge source tables in this pass. The goal is one catalog view, not one storage model.

- [ ] **Step 3: Update the catalog page to use the new aggregation**

Once the aggregator is ready, switch `/platform/tools/catalog` from MCP-only rendering to cross-source rendering and rename it to `Connection Catalog`.

- [ ] **Step 4: Add catalog tests**

Cover:
- MCP entries are tagged `kind="mcp"`
- native integration descriptors are tagged `kind="native"`
- built-in tools are tagged `kind="built-in"`
- sorting and badges remain stable when one source returns zero rows

- [ ] **Step 5: Run focused catalog tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/actions/connection-catalog.test.ts apps/web/lib/actions/mcp-catalog.test.ts apps/web/lib/actions/mcp-services.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/connection-catalog.ts apps/web/lib/actions/connection-catalog.test.ts apps/web/app/(shell)/platform/tools/catalog/page.tsx apps/web/lib/actions/mcp-catalog.ts apps/web/lib/actions/mcp-services.ts apps/web/lib/actions/built-in-tools.ts
git commit -s -m "feat(tools): aggregate MCP native and built-in entries into connection catalog"
```

### Task 9: Classify non-MCP `ModelProvider` service rows without a schema rewrite

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_platform_connection_kinds/migration.sql`
- Modify: `packages/db/src/seed.ts`
- Modify: `apps/web/lib/actions/ai-providers.ts`
- Modify: `apps/web/lib/actions/built-in-tools.ts`

- [ ] **Step 1: Add an additive service-kind field to `ModelProvider`**

Choose the low-churn path from the reviewed design:
- keep `ModelProvider` as the current runtime source
- add a new additive classification field such as `serviceKind`
- use it only for `type='service'`

Allowed values in this pass:
- `mcp`
- `built_in`

- [ ] **Step 2: Generate and edit the migration**

Run:

```bash
pnpm --filter @dpf/db exec prisma migrate dev --name platform_connection_kinds --create-only
```

Then edit the generated SQL so it:
- adds the new field safely
- backfills known MCP-backed rows to `mcp`
- backfills non-MCP direct service utilities to `built_in`

The reviewed spec specifically calls out address-validation utilities as examples to classify out of the generic provider bucket.

- [ ] **Step 3: Update seed/bootstrap defaults**

Update `packages/db/src/seed.ts` so bootstrap rows land with the same `serviceKind` values as the migration backfill. This is bootstrap parity, not a runtime-state source of truth.

- [ ] **Step 4: Thread the new classification into reads**

Update:
- `ai-providers.ts` so Providers & Routing only shows true providers plus any service rows still intentionally owned there
- `built-in-tools.ts` so built-in service utilities can be surfaced from the same runtime truth

- [ ] **Step 5: Add invariant tests**

Add tests that prove:
- no `type='service'` row used by the new IA is left unclassified
- the Built-in Tools page does not accidentally swallow MCP services
- the Providers page does not continue to surface built-in direct services as provider configuration

- [ ] **Step 6: Run DB and focused classification tests**

Run:

```bash
pnpm --filter @dpf/db exec prisma generate
pnpm --filter web exec vitest run apps/web/lib/actions/ai-providers.test.ts apps/web/lib/actions/built-in-tools.test.ts
pnpm --filter web typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/seed.ts apps/web/lib/actions/ai-providers.ts apps/web/lib/actions/built-in-tools.ts
git commit -s -m "feat(platform): classify service providers for tools IA"
```

## Chunk 5: Documentation Refresh

### Task 10: Update the internal docs that would otherwise preserve the old IA

**Files:**
- Modify: `docs/superpowers/specs/2026-04-11-business-setup-unification-design.md`
- Modify: `docs/superpowers/specs/2026-04-12-unified-capability-and-integration-lifecycle-design.md`
- Modify: `docs/superpowers/specs/2026-04-18-purpose-first-product-estate-design.md`
- Modify: `docs/superpowers/specs/2026-04-24-platform-ia-tools-ai-admin-refactor-design.md`
- Modify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 1: Update canonical-route references in still-active platform specs**

Refresh the docs that are most likely to be consulted during future work:
- `2026-04-11-business-setup-unification-design.md`
  - stop treating `/admin/prompts` and `/admin/skills` as canonical homes
- `2026-04-12-unified-capability-and-integration-lifecycle-design.md`
  - replace stale labels like `Routing & Calibration`
  - align service/catalog language with `Providers & Routing`, `MCP Services`, `Native Integrations`, and `Built-in Tools`
- `2026-04-18-purpose-first-product-estate-design.md`
  - replace `Discovery Operations` with `Estate Discovery`
  - keep the route stable while clarifying the naming change

- [ ] **Step 2: Mark older guidance as superseded where full rewrite would create churn**

When a historical spec is still useful but no longer canonical, add a short note near the top such as:

```md
> Superseded in part by `docs/superpowers/specs/2026-04-24-platform-ia-tools-ai-admin-refactor-design.md` for current Platform Hub IA labels and canonical homes.
```

Prefer small supersession notes over large retroactive rewrites of historical implementation documents.

- [ ] **Step 3: Keep the new IA spec current with implementation reality**

As the implementation lands, update `2026-04-24-platform-ia-tools-ai-admin-refactor-design.md` if any of the following change:
- exact route names
- redirect timing
- field name chosen for service classification
- final documentation ownership list

The design spec should remain the trustworthy current-state IA reference, not just the starting draft.

- [ ] **Step 4: Update QA documentation with the new canonical paths**

Extend `tests/e2e/platform-qa-plan.md` so the QA plan uses:
- `/platform/ai/prompts`
- `/platform/ai/skills`
- `/platform/tools/built-ins`
- `Estate Discovery`
- `Providers & Routing`

and treats `/admin/prompts` and `/admin/skills` as redirect/back-compat checks rather than primary navigation destinations.

- [ ] **Step 5: Add a documentation acceptance check to the final PR review**

Before merging the last PR in this sequence, verify:
- no current “how the platform is organized” doc still names the old labels as canonical
- no active spec still points operators to the Admin routes for prompts or skills
- no current platform IA doc describes Brave Search as an Admin setting

- [ ] **Step 6: Commit documentation updates**

```bash
git add docs/superpowers/specs/2026-04-11-business-setup-unification-design.md docs/superpowers/specs/2026-04-12-unified-capability-and-integration-lifecycle-design.md docs/superpowers/specs/2026-04-18-purpose-first-product-estate-design.md docs/superpowers/specs/2026-04-24-platform-ia-tools-ai-admin-refactor-design.md tests/e2e/platform-qa-plan.md
git commit -s -m "docs(platform): refresh IA documentation for tools ai and admin refactor"
```

## Chunk 6: Verification, Redirect Hardening, and Backlog Hygiene

### Task 11: Add QA coverage, run production-path verification, and update live backlog records

**Files:**
- Modify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 1: Extend the platform QA plan**

Add or update cases covering:
- Platform nav labels and targets
- `/admin/prompts` -> `/platform/ai/prompts`
- `/admin/skills` -> `/platform/ai/skills`
- Built-in Tools presence and Brave Search configuration path
- Connection Catalog showing MCP + native + built-in entries
- Capability Inventory explicitly framed as runtime inventory

- [ ] **Step 2: Run the targeted Vitest suites**

Run:

```bash
pnpm --filter web exec vitest run apps/web/components/platform/platform-nav.test.ts apps/web/components/platform/PlatformTabNav.test.tsx apps/web/app/(shell)/platform/ai/page.test.tsx apps/web/app/(shell)/platform/ai/prompts/page.test.tsx apps/web/app/(shell)/platform/tools/built-ins/page.test.tsx apps/web/lib/actions/built-in-tools.test.ts apps/web/lib/actions/connection-catalog.test.ts apps/web/lib/actions/ai-providers.test.ts apps/web/lib/actions/capability-inventory.test.ts
```

- [ ] **Step 3: Run typecheck and production build**

Run:

```bash
pnpm --filter web typecheck
cd apps/web && npx next build
```

- [ ] **Step 4: Rebuild and verify the Docker-served runtime**

Run:

```bash
docker compose build --no-cache portal portal-init sandbox
docker compose up -d portal-init sandbox
docker compose up -d portal
```

Then verify at `http://localhost:3000`:
- `/platform/ai`
- `/platform/ai/prompts`
- `/platform/ai/skills`
- `/platform/ai/providers`
- `/platform/tools`
- `/platform/tools/catalog`
- `/platform/tools/services`
- `/platform/tools/integrations`
- `/platform/tools/built-ins`
- `/platform/tools/discovery`
- `/platform/tools/inventory`
- `/admin/prompts`
- `/admin/skills`
- `/admin/settings`

- [ ] **Step 5: Verify redirect behavior explicitly**

Assert:
- old Admin deep links resolve in one hop
- no Tools subitem lands on a detail page by mistake
- no redirect loops exist between AI and Audit

- [ ] **Step 6: Update live backlog state under the existing epic**

Using the live DB or app-backed actions, do all of the following:
- keep `bi-int-b4d291` current as work lands
- add follow-on backlog items only if a later chunk is intentionally deferred
- use only canonical enum values from `apps/web/lib/backlog.ts`
- close any completed sub-items immediately so the epic remains trustworthy

- [ ] **Step 7: Commit QA coverage**

```bash
git add tests/e2e/platform-qa-plan.md
git commit -s -m "test(platform): cover platform IA refactor flows"
```

## Suggested PR Sequence

1. `feat(platform): align platform navigation with reviewed IA`
2. `feat(ai): move prompt management to AI Operations`
3. `feat(ai): unify skills catalog and observability under AI Operations`
4. `feat(ai): narrow providers to provider and routing concerns`
5. `feat(tools): add built-in tools home and move Brave Search config`
6. `feat(tools): align tools surfaces to connection lifecycle stages`
7. `feat(tools): aggregate MCP native and built-in entries into connection catalog`
8. `feat(platform): classify service providers for tools IA`
9. `docs(platform): refresh IA documentation for tools ai and admin refactor`
10. `test(platform): cover platform IA refactor flows`

## Exit Criteria

- Platform navigation matches the reviewed IA labels and ordering with no leftover redirect-only AI items.
- `Native Integrations` points to `/platform/tools/integrations`, not an integration detail page.
- `/platform/ai/prompts` is the canonical prompt-management home and `/admin/prompts` redirects there.
- `/platform/ai/skills` is the canonical skills home and `/admin/skills` redirects there.
- `/platform/ai/providers` no longer renders activated MCP services or a generic tool inventory section.
- `/platform/tools/built-ins` exists and is the only canonical UI home for Brave Search configuration.
- `/admin/settings` no longer surfaces Brave Search configuration.
- `/platform/tools/catalog` honestly reflects its source scope at every phase, and ends as a cross-source Connection Catalog once the aggregator lands.
- `/platform/tools/inventory` explicitly presents itself as runtime inventory, not setup catalog.
- Non-MCP `ModelProvider.type='service'` rows used by the new IA are classified so they do not appear in the wrong family.
- The currently referenced platform IA docs and QA plan all describe the new canonical homes and labels, with historical docs explicitly marked as superseded where needed.
- Targeted tests, `pnpm --filter web typecheck`, and `cd apps/web && npx next build` pass.
- Docker-served runtime verification passes on the canonical routes and legacy redirects.
- Live backlog items under `ep_int_harness_benchmarking_20260423` reflect the shipped state of the work.
