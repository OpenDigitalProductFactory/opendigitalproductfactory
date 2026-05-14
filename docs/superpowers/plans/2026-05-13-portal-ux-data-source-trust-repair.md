# Portal UX Data Source Trust Repair Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:subagent-driven-development` only when the operator explicitly asks for parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove fake-looking or disconnected portal UX by making every visible metric/action traceable to a real source, fixing broken click paths, and connecting backlog/build workflows through governed platform processes.

**Architecture:** Add a small shared data-provenance contract at the server/view-model boundary for operator-facing metrics and panels, then apply it to the highest-trust surfaces: portfolio budgets/completeness, provider cost, platform authority grants, admin navigation, backlog-to-build promotion, and Build Studio layout. The repair is vertical and incremental: first stabilize broken reads, then label or replace placeholder values, then connect actions to existing durable processes. This is a read-model/UI trust repair, not a new global provenance persistence system.

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL 16, Docker Compose, TypeScript, Vitest, pnpm workspaces, existing DPF MCP backlog tools.

---

## Current Evidence Snapshot

Captured from repo, browser, MCP, logs, and live Postgres on 2026-05-13. Re-run Chunk 0 before implementation because this is live product state.

- Portfolio budgets come from seed/default data, not discovered finance or source systems.
  - `packages/db/src/seed.ts` defines `PORTFOLIO_BUDGETS` and upserts `Portfolio.budgetKUsd`.
  - `apps/web/lib/evaluate/portfolio-data.ts` reads `Portfolio.budgetKUsd`; `formatBudget` renders values such as `3500` as `$3.5M`.
  - Live `Portfolio` rows showed `foundational=2500`, `manufacturing_and_delivery=1800`, `for_employees=1200`, `products_and_services_sold=3500`.
  - `docs/superpowers/specs/2026-03-11-phase-2d-investment-metric-design.md` explicitly calls those values placeholder/demonstration budgets.
- Portfolio item clicks currently hit an error boundary.
  - Browser reproduced `/portfolio/foundational` error.
  - Portal logs showed Prisma selecting unknown fields `manufacturer`, `observedVersion`, and `enrichmentStatus` on `DigitalProduct`.
  - `DigitalProduct` does not own those fields in `packages/db/prisma/schema.prisma`; related inventory metadata lives on `InventoryEntity`.
- Provider cost information mixes real internal token usage with catalog/profile labels.
  - `apps/web/lib/inference/ai-provider-data.ts` groups `TokenUsage.costUsd`.
  - Provider detail falls back to `provider.costBand ?? "free"`.
  - Live `TokenUsage` had small real internal costs, while provider rows displayed many `free` labels that are not external account billing.
  - Live `TokenUsage` also included a blank provider id row; provider spend UI must render an explicit `Unknown provider` bucket rather than hiding or mislabeling it.
  - `docs/superpowers/specs/2026-04-23-ai-provider-finance-bridge-design.md` says provider billing reconciliation is still a known follow-up.
- Platform hub `Active grants` is accurate for `DelegationGrant`, but misleading for standing authority.
  - `apps/web/app/(shell)/platform/page.tsx` counts active, unexpired `DelegationGrant`.
  - Live DB showed `DelegationGrant=0`, but `AgentToolGrant=496` across `81` agents.
- Admin menu includes items that immediately leave Admin.
  - `apps/web/components/admin/admin-nav.ts` links `Prompts` and `Skills` under `/admin`.
  - `/admin/prompts` and `/admin/skills` permanently redirect to `/platform/ai/prompts` and `/platform/ai/skills`.
  - Existing IA design makes those Platform AI homes canonical; the Admin menu is still advertising the legacy location.
- Backlog rows do not expose a Build Studio launch path.
  - `apps/web/components/ops/BacklogItemRow.tsx` offers edit/report/delete actions only.
  - Existing `promoteBacklogItemToBuildDraft`, `promote_to_build_studio`, `activeBuildId`, and `originatingBacklogItemId` wiring already define the governed launch path; the row action must reuse that path.
- Build Studio current in-progress items consume too much screen real estate.
  - `apps/web/components/build/BuildStudio.tsx` renders unbounded long titles in the build list and detail header.
  - `apps/web/components/build/build-studio-layout.ts` has layout helpers, but current panels do not constrain long in-progress work well enough.

## Existing Designs To Extend

- `docs/superpowers/specs/2026-03-11-phase-2d-investment-metric-design.md`
- `docs/superpowers/specs/2026-04-23-ai-provider-finance-bridge-design.md`
- `docs/superpowers/specs/2026-04-24-platform-ia-tools-ai-admin-refactor-design.md`
- `docs/superpowers/specs/2026-04-25-build-studio-redesign-design.md`
- `docs/superpowers/specs/2026-04-30-discovery-portfolio-gap-closure-design.md`
- `docs/superpowers/plans/2026-04-21-backlog-triage-build-studio.md`
- `docs/superpowers/plans/2026-04-30-discovery-portfolio-gap-closure-plan.md`

Do not create a parallel strategy doc for these domains. This plan is the execution bridge that ties the loose UX reports to the existing architecture.

## Chief Architect Amendments

These amendments are part of the plan, not optional review commentary.

- Provenance belongs on the read model first. Do not add a new provenance table or extra nullable source columns in this repair unless a chunk explicitly proves that the existing tables cannot express the source.
- Budget cleanup must use the current slug `manufacturing_and_delivery`, not the older shorthand `manufacturing`. Any migration guard must match exact slug plus exact placeholder value.
- Preserve `ModelProvider.costBand` for routing and ranking. The user-facing fix is to split the provider cost view model so routing cost, catalog pricing, internal token spend, finance contract data, and external billing status cannot collapse into one operator label.
- Backlog launch must call the existing governed promotion helper inside a transaction. A raw `createFeatureBuild` call would bypass `activeBuildId`, `originatingBacklogItemId`, and governed draft semantics.
- `/build` currently accepts `v` but not `buildId` in its search params. Do not link backlog rows to `/build?buildId=<id>` until the route and `BuildStudio` initial selection support that deep link, or use an already-supported canonical pattern if one lands first.
- UI work in touched components must also remove hardcoded fallback hex colors found in the same edited surface. Source-trust UX loses credibility if the repair ships with non-theme styling drift.

## Scope

**In scope.**

- Fix portfolio click failures caused by schema drift.
- Stop presenting seeded/demo budget numbers as if they are discovered or account-backed.
- Separate real internal usage, catalog pricing, finance profile data, and unavailable external provider billing.
- Rename or split `Active grants` into terms that match the underlying authority records.
- Remove redirect-only Admin destinations from the Admin primary menu.
- Add a governed backlog-to-Build-Studio launch/resume action.
- Constrain Build Studio list/detail layout so current in-progress work does not dominate the screen.
- Add targeted tests and UX verification for each changed surface.

**Not in scope.**

- Implementing provider external billing API reconciliation end-to-end.
- Inventing live portfolio budgets without a source contract.
- Replacing the full Build Studio redesign with the `?v=2` shell in this plan.
- Rewriting all portal IA.
- Direct DB fixes without seed/template/source-code repair.

## Source-Trust Model

Operator-facing values must be one of:

- `live-db`: persisted runtime data from a DPF table.
- `connected-account`: data queried from a provider/customer account.
- `computed`: derived from live platform data, with inputs named.
- `catalog`: static or curated registry value.
- `seed-default`: bootstrap default that may be overwritten by setup/import.
- `demo-placeholder`: explicitly non-operational demonstration data.
- `not-connected`: the platform has a concept but no connected source yet.

UI rule: any metric that is not `live-db`, `connected-account`, or clearly `computed` must show source context near the value. Do not hide stub provenance in hover-only text.

Implementation rule: provenance is attached to view-model outputs and component props. It must not require client components to import Prisma or infer source state from display strings.

## Refactoring Budget

Spend about 20% of implementation effort on refactoring that prevents this from recurring:

- Create one shared provenance type/helper instead of per-page string labels.
- Normalize provider cost view-model naming so "free", "basic", "catalog", "internal spend", and "external billing" cannot collapse into one label.
- Extract portfolio completeness select/read mapping away from ad hoc component or helper shapes so Prisma schema ownership is explicit.
- Extract a compact Build Studio list-item component with stable dimensions.
- Add tests around provenance and schema mappings to catch future drift.

---

## Chunk 0 - Re-Verify Runtime Truth

Purpose: confirm the audit evidence is still current before touching code.

- [ ] Query live backlog/spec overlap through the DPF MCP tools:
  - `search_specs_and_plans` for `portal UX data provenance provider cost portfolio budget admin navigation Build Studio backlog launch`
  - `list_epics` with `hasOpenItems=true`
  - `list_backlog_items` with `hasActiveBuild=true`
- [ ] If MCP search returns no direct overlap, record that explicitly and use DB fallback only for row-level runtime facts that the MCP tools do not expose.
- [ ] Query live portfolio budget state:

```powershell
docker exec dpf-postgres-1 psql -U dpf -d dpf -c 'SELECT slug, name, "budgetKUsd" FROM "Portfolio" ORDER BY slug;'
```

- [ ] Query authority state:

```powershell
docker exec dpf-postgres-1 psql -U dpf -d dpf -c 'SELECT COUNT(*) AS active_delegation_grants FROM "DelegationGrant" WHERE status=''active'' AND "expiresAt" > now();'
docker exec dpf-postgres-1 psql -U dpf -d dpf -c 'SELECT COUNT(*) AS standing_tool_grants FROM "AgentToolGrant";'
```

- [ ] Query provider internal spend:

```powershell
docker exec dpf-postgres-1 psql -U dpf -d dpf -c 'SELECT "providerId", SUM("costUsd") AS internal_token_cost_usd FROM "TokenUsage" GROUP BY "providerId" ORDER BY internal_token_cost_usd DESC;'
docker exec dpf-postgres-1 psql -U dpf -d dpf -c 'SELECT COALESCE(NULLIF("providerId", ''''), ''<missing>'') AS provider_id, COUNT(*) AS rows, SUM("costUsd") AS internal_token_cost_usd FROM "TokenUsage" GROUP BY 1 ORDER BY internal_token_cost_usd DESC;'
```

- [ ] Reproduce the current browser paths after login:
  - `/portfolio`
  - `/portfolio/foundational`
  - `/platform`
  - `/platform/audit`
  - `/platform/ai/providers`
  - `/admin`
  - `/admin/prompts`
  - `/ops`
  - `/build`
- [ ] Save screenshots or notes with exact route, date, and DB snapshot.

Exit: current evidence is either confirmed or this plan is amended before implementation.

## Chunk 1 - Shared Provenance Contract

Purpose: make source truth reusable so every affected surface speaks the same language.

Files:

- Create `apps/web/lib/surface-data-provenance.ts`
- Create `apps/web/lib/surface-data-provenance.test.ts`
- Create `apps/web/components/ui/DataSourceBadge.tsx`
- Create `apps/web/components/ui/DataSourceBadge.test.tsx`
- Modify `apps/web/components/platform/PlatformSummaryCard.tsx`
- Create or modify `apps/web/components/platform/PlatformSummaryCard.test.tsx`

Tasks:

- [ ] Define `DataSourceKind` as a typed union covering `live-db`, `connected-account`, `computed`, `catalog`, `seed-default`, `demo-placeholder`, and `not-connected`.
- [ ] Define `DataSourceProvenance` with `kind`, `label`, `description`, optional `sourceTable`, optional `sourceRoute`, optional `lastVerifiedAt`, and optional `actionHref`.
- [ ] Define `ProvenancedMetric<T>` with `label`, `value`, and `provenance`.
- [ ] Keep `surface-data-provenance.ts` client/server safe: no Prisma imports, no server-only imports, no DB calls, and date values passed as ISO strings or caller-owned display text.
- [ ] Add helper functions for display tone and short labels. Tone maps to semantic CSS variables only; it must not encode business truth beyond the source kind.
- [ ] Build `DataSourceBadge` using theme tokens only. Use concise visible text plus an accessible title/description; hover-only source disclosure is not sufficient.
- [ ] Extend `PlatformSummaryCard` metrics to accept optional provenance without breaking existing callers.
- [ ] Add tests for each source kind and card metric rendering.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/lib/surface-data-provenance.test.ts apps/web/components/ui/DataSourceBadge.test.tsx apps/web/components/platform/PlatformSummaryCard.test.tsx
pnpm --filter web typecheck
```

Exit: affected pages can render provenance without bespoke badge logic.

## Chunk 2 - Portfolio Crash And Budget Trust

Purpose: fix broken portfolio clicks and stop seeded budget defaults from looking like discovered operational data.

Files:

- Modify `apps/web/lib/portfolio/completeness.ts`
- Modify or create `apps/web/lib/portfolio/completeness.test.ts`
- Create or modify `apps/web/lib/portfolio/budget-provenance.ts`
- Create `apps/web/lib/portfolio/budget-provenance.test.ts`
- Modify `apps/web/lib/portfolio/digital-product-view-model.ts` only if the portfolio detail view model needs matching provenance fields.
- Modify `apps/web/lib/evaluate/portfolio-data.ts`
- Modify or create `apps/web/lib/evaluate/portfolio-data.test.ts`
- Modify `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`
- Modify `apps/web/components/portfolio/PortfolioOverview.tsx`
- Modify `apps/web/components/portfolio/PortfolioNodeDetail.tsx`
- Modify `packages/db/src/seed.ts`
- Add a Prisma migration only if needed after design review

Tasks:

- [ ] Replace invalid `DigitalProduct` selections with schema-valid fields.
- [ ] Pull manufacturer/version metadata through `DigitalProduct.inventoryEntities`, not fake `DigitalProduct` columns. If existing governance required fields still say `manufacturer` or `observedVersion`, resolve them through an explicit alias map to the primary linked `InventoryEntity`; do not pretend those fields exist on `DigitalProduct`.
- [ ] Treat `enrichmentStatus` as unavailable until the schema actually adds it, or derive a separately named quality/readiness status from existing `PortfolioQualityIssue` data.
- [ ] Add a typed select guard, for example a `satisfies Prisma.DigitalProductSelect` or equivalent Prisma validator constant, so typecheck fails when completeness code selects fields not owned by `DigitalProduct`.
- [ ] Change portfolio budget view models to return a provenanced metric.
- [ ] Preferred repair: remove the four fictional `PORTFOLIO_BUDGETS` defaults from the seed/template path and render `No connected budget source` until a real finance/setup source exists.
- [ ] Pair seed removal with either the exact guarded data migration below or exact placeholder recognition in `budget-provenance.ts`; current installs must stop rendering the fictional numbers as plain live budget data.
- [ ] If the team chooses to retain the seed values for demo installs, classify them as `demo-placeholder` in `budget-provenance.ts` and keep that label visibly next to the number. Do not let seeded values render as plain `Budget`.
- [ ] If a data migration is chosen, only clear the exact known placeholder values for exact known portfolio slugs. Do not wipe user-entered budgets.
- [ ] Change UI copy from absolute budget language to source-aware labels such as `Planning placeholder`, `No connected budget source`, or `Live budget`, depending on provenance.

Possible migration guard:

```sql
UPDATE "Portfolio"
SET "budgetKUsd" = NULL
WHERE (slug = 'foundational' AND "budgetKUsd" = 2500)
   OR (slug = 'manufacturing_and_delivery' AND "budgetKUsd" = 1800)
   OR (slug = 'for_employees' AND "budgetKUsd" = 1200)
   OR (slug = 'products_and_services_sold' AND "budgetKUsd" = 3500);
```

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/lib/portfolio/completeness.test.ts apps/web/lib/portfolio/budget-provenance.test.ts apps/web/lib/evaluate/portfolio-data.test.ts
pnpm --filter web typecheck
pnpm --filter web build
```

UX verification:

- [ ] `/portfolio` loads without error.
- [ ] `/portfolio/foundational` loads without Prisma errors.
- [ ] Portfolio cards/details do not show large budgets without visible source context.
- [ ] Discovered products with inventory metadata show available manufacturer/version context from `InventoryEntity`.

Exit: portfolio is clickable, and budget numbers no longer pretend to be sourced from discovery or finance.

## Chunk 3 - Provider Cost Source Truth

Purpose: make provider cost panels honest about what is real internal usage, what is catalog/config, and what is not connected.

Files:

- Modify `apps/web/lib/inference/ai-provider-types.ts`
- Modify `apps/web/lib/inference/ai-provider-data.ts`
- Create or modify `apps/web/lib/inference/ai-provider-cost-view.ts`
- Create `apps/web/lib/inference/ai-provider-cost-view.test.ts`
- Modify or create `apps/web/lib/inference/ai-provider-data.test.ts`
- Modify `apps/web/app/(shell)/platform/ai/providers/page.tsx`
- Modify `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`
- Modify `apps/web/components/platform/ServiceRow.tsx`
- Modify `apps/web/components/platform/TokenSpendPanel.tsx`
- Review existing finance bridge files before adding new code:
  - `apps/web/lib/finance/ai-provider-finance.ts`
  - `apps/web/components/finance/AiProviderFinancePanel.tsx`

Tasks:

- [ ] Preserve the persisted/routing `costBand` field for routing internals, but stop using it as the primary operator billing label.
- [ ] Add a provider cost view model with distinct fields such as `routingCostBand`, `catalogPricing`, `configuredBillingProfile`, `internalTokenUsage`, and `externalProviderBilling`.
- [ ] Remove UI fallback that turns missing cost data into `free`.
- [ ] Show internal token spend as `Internal token usage`, with provenance `live-db` from `TokenUsage`.
- [ ] Show provider catalog/account configuration as `Provider catalog` or `Configured billing profile`, not as live account spend.
- [ ] Show external account billing as `Not connected` unless the finance bridge has a real reconciled source such as a contract usage snapshot with an account/provider source. A seeded `AiProviderFinanceProfile` alone is configuration, not billing evidence.
- [ ] Render blank or unknown `TokenUsage.providerId` rows as `Unknown provider` with `live-db` provenance instead of hiding them.
- [ ] Add provider detail source badges and action links to connect/reconcile when applicable.
- [ ] Replace hardcoded color fallbacks in touched provider components, including `ServiceRow` fallback backgrounds, with DPF theme tokens or `color-mix` against theme variables.
- [ ] Add tests for missing cost, catalog cost, internal usage, blank provider ids, finance-profile-backed configuration, and reconciled external billing display.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/lib/inference/ai-provider-data.test.ts apps/web/lib/inference/ai-provider-cost-view.test.ts
pnpm --filter web typecheck
pnpm --filter web build
```

UX verification:

- [ ] `/platform/ai/providers` distinguishes registered providers from billing/spend.
- [ ] A provider with no external billing no longer says `free` unless the provider itself is explicitly configured as free/local.
- [ ] Token spend charts/cards explain that the numbers come from DPF `TokenUsage`.

Exit: provider cost information is no longer fake-looking because missing external account data is explicitly missing.

## Chunk 4 - Platform Grants Authority Wording

Purpose: fix the misleading `Active grants 0` card without hiding useful governance state.

Files:

- Modify `apps/web/app/(shell)/platform/page.tsx`
- Modify `apps/web/app/(shell)/platform/audit/page.tsx`
- Modify or create a small platform authority summary loader if that keeps queries out of page components.
- Modify or create tests for platform summary data if existing patterns support it.
- Review `apps/web/lib/authority/effective-authority.ts`
- Review `apps/web/lib/tak/agent-grants.ts`

Tasks:

- [ ] Rename `Active grants` to `Temporary delegation grants` wherever the value is sourced from `DelegationGrant`.
- [ ] Add a separate `Standing tool grants` or `Governed tool grants` metric sourced from `AgentToolGrant`.
- [ ] If an operator-facing `Governed agents` count is shown, source it from distinct `AgentToolGrant.agentId` values or name the current `ToolExecution` source accurately. Do not conflate execution history with configured authority.
- [ ] Attach provenance to both metrics:
  - `DelegationGrant` count: `live-db`, temporary grants only.
  - `AgentToolGrant` count: `live-db`, standing configured grants.
- [ ] Add short description text so `0` temporary grants reads as healthy/neutral, not broken.
- [ ] Confirm `/platform/ai/authority` remains the detailed destination for tool execution/governance.

Verification:

```powershell
pnpm --filter web typecheck
pnpm --filter web build
```

UX verification:

- [ ] `/platform` no longer suggests all authority is inactive.
- [ ] `/platform/audit` separates temporary delegation from standing grants.

Exit: the platform hub is accurate and relevant to how authority currently works.

## Chunk 5 - Admin Navigation Canonical Homes

Purpose: stop Admin navigation from taking operators unexpectedly out of Admin.

Files:

- Modify `apps/web/components/admin/admin-nav.ts`
- Modify or create `apps/web/components/admin/admin-nav.test.tsx`
- Keep legacy redirects:
  - `apps/web/app/(shell)/admin/prompts/page.tsx`
  - `apps/web/app/(shell)/admin/skills/page.tsx`
  - `apps/web/app/(shell)/admin/business-context/page.tsx`
  - `apps/web/app/(shell)/admin/operating-hours/page.tsx`

Tasks:

- [ ] Remove `Prompts` and `Skills` as normal Admin menu entries.
- [ ] Add a clearly separated cross-area affordance only if an existing Admin pattern supports it; primary Admin navigation must not advertise destinations whose canonical home is Platform AI.
- [ ] Prefer a menu shape where every primary Admin option keeps the operator in Admin.
- [ ] Preserve permanent redirects for existing bookmarks and links.
- [ ] Add tests asserting redirect-only destinations are not rendered as normal Admin nav items.
- [ ] Cross-check `docs/superpowers/specs/2026-04-24-platform-ia-tools-ai-admin-refactor-design.md` so the final nav still matches canonical Platform AI ownership.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/components/admin/admin-nav.test.tsx
pnpm --filter web typecheck
pnpm --filter web build
```

UX verification:

- [ ] `/admin` menu no longer contains ordinary entries that immediately redirect to `/platform`.
- [ ] `/admin/prompts` still redirects to `/platform/ai/prompts` for legacy deep links.
- [ ] Platform AI pages remain reachable from Platform navigation.

Exit: Admin IA is predictable and aligned with canonical route ownership.

## Chunk 6 - Backlog To Build Studio Action

Purpose: let operators invoke or resume Build Studio work directly from backlog rows.

Files:

- Modify `apps/web/components/ops/BacklogItemRow.tsx`
- Modify parent ops/backlog components as needed for server-action wiring.
- Modify or create `apps/web/lib/actions/backlog-build.ts`
- Reuse `apps/web/lib/actions/build.ts`
- Reuse `apps/web/lib/governed-backlog-tee-up.ts`
- Reuse `apps/web/lib/governed-backlog-workflow.ts`
- Modify `apps/web/lib/explore/backlog.ts` and `apps/web/lib/backlog-data.ts` if row props need `triageOutcome`, `effortSize`, `activeBuildId`, or active build phase/build id.
- Modify `apps/web/app/(shell)/build/page.tsx` and `apps/web/components/build/BuildStudio.tsx` if the action introduces `/build?buildId=<id>` deep links.
- Modify or create tests for backlog row action states and server action behavior.

Tasks:

- [ ] Add a compact row action with states:
  - `Start build` when no `activeBuildId` exists and item is eligible according to the same rules as `promoteBacklogItemToBuildDraft`.
  - `Open build` when `activeBuildId` exists.
  - `Resume build` when active build is in progress.
  - `Build blocked` with reason when status/DoR prevents launch.
- [ ] Add a server action that passes the semantic `itemId` into `promoteBacklogItemToBuildDraft` inside a Prisma transaction. Do not call `createFeatureBuild` directly from the row.
- [ ] Preserve `originatingBacklogItemId` and `activeBuildId` so duplicate active builds are not created.
- [ ] Add `/build?buildId=<id>` support if it is still absent: `page.tsx` should accept `buildId`, and `BuildStudio` should select that build initially after validating it belongs to the current user's returned build list.
- [ ] Redirect or link to the canonical Build Studio deep-link pattern only after creation/opening is supported and tested.
- [ ] Add a confirmation/error state that does not require operators to leave backlog to discover failure.
- [ ] Keep buttons compact and icon-supported; avoid adding bulky cards inside rows.
- [ ] Record tool/execution evidence if implementation is invoked by a coworker or MCP workflow.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/components/ops/BacklogItemRow.test.tsx apps/web/lib/actions/backlog-build.test.ts
pnpm --filter web typecheck
pnpm --filter web build
```

UX verification:

- [ ] `/ops` shows a Build Studio action for eligible backlog items.
- [ ] Clicking `Start build` creates exactly one active build and navigates to it.
- [ ] Existing active build items show `Open build`, not a second create action.
- [ ] Blocked items explain why they cannot be sent to Build Studio.

Exit: backlog is an actual Build Studio intake surface, not a dead list.

## Chunk 7 - Build Studio Current Work Layout

Purpose: make current in-progress work scannable without waiting for the full redesign to land.

Files:

- Modify `apps/web/components/build/BuildStudio.tsx`
- Modify `apps/web/components/build/build-studio-layout.ts`
- Consider extracting `apps/web/components/build/BuildListItem.tsx`
- Modify `apps/web/app/(shell)/build/page.tsx` if selected-build deep-link support did not land in Chunk 6.
- Add or update tests where existing Build Studio component tests exist.

Tasks:

- [ ] Extract a compact build-list item component with stable height, two-line title clamp, status chip, and updated timestamp.
- [ ] Move full long titles into the detail header and accessible title text, but cap the visual detail header so it does not dominate the screen.
- [ ] Keep in-progress/current builds grouped and scannable in the sidebar.
- [ ] Fix layout helper direction issues, including graph/detail panel classes that should be column-oriented.
- [ ] If `buildId` deep-link support is part of this chunk, ensure selecting a build updates the URL or at least preserves a shareable/openable `buildId` query without breaking `?v=2`.
- [ ] Use theme tokens and existing component patterns only.
- [ ] Verify desktop and mobile widths. Long titles must not resize rows or push important controls off screen.
- [ ] Keep this as a tactical layout repair; do not migrate the whole page to the redesign shell in this chunk.

Verification:

```powershell
pnpm --filter web typecheck
pnpm --filter web build
```

UX verification:

- [ ] `/build` shows in-progress items as a compact list.
- [ ] Selecting a long-title build does not consume the entire screen.
- [ ] Mobile view preserves navigation, list, detail, and primary actions without overlapping text.

Exit: current Build Studio is usable while the larger redesign remains separately reviewable.

## Chunk 8 - QA, Backlog, And Evidence

Purpose: make the repair durable and traceable.

Files:

- Modify `tests/e2e/platform-qa-plan.md` if affected phase coverage needs updating.
- Add a short note to the owning spec only if implementation changes the design contract.
- Use DPF MCP backlog tools for any new/updated backlog records after review approval.

Tasks:

- [ ] Run focused unit tests from chunks above.
- [ ] Run `pnpm --filter web typecheck`.
- [ ] Run `pnpm --filter web build`.
- [ ] If a migration was added, run `pnpm --filter @dpf/db exec prisma migrate dev --name <name>` during development and verify deploy/restart path.
- [ ] For production-path UX verification, rebuild and restart the Docker app from the implementation worktree. If the worktree does not have its own `.env`, use the install root env file explicitly:

```powershell
docker compose --env-file D:\DPF\.env build --no-cache portal portal-init sandbox
docker compose --env-file D:\DPF\.env up -d
```

- [ ] Verify the running image/container contains the implementation worktree changes before trusting browser results.
- [ ] Verify affected paths against the Docker-served URL from `AUTH_URL`/`APP_URL`, not a stale dev server.
- [ ] Record execution evidence through MCP if available.
- [ ] Create or update backlog items only after this plan is reviewed, using live MCP tools first.

Exit: tests, build, browser evidence, and backlog state all tell the same story.

---

## Recommended PR Sequence

1. **PR 1: Portfolio reliability and budget provenance**
   - Chunks 0, 1, and 2.
   - Highest user impact because it fixes the click crash and the most visibly fake budget numbers.
2. **PR 2: Provider and authority source truth**
   - Chunks 3 and 4.
   - Makes cost/authority dashboards trustworthy without waiting for external billing reconciliation.
3. **PR 3: Navigation and workflow connection**
   - Chunks 5 and 6.
   - Repairs Admin IA and connects backlog to Build Studio.
4. **PR 4: Build Studio current-work layout**
   - Chunk 7 plus Chunk 8 QA updates.
   - Small, focused UI ergonomics improvement that does not collapse into the larger redesign.

## Review Checklist

- [ ] Every visible metric added or modified names its source kind.
- [ ] No placeholder value is presented as connected/live data.
- [ ] No UI component hardcodes colors outside existing theme-token exceptions.
- [ ] Admin primary navigation does not include redirect-only legacy destinations.
- [ ] Backlog launch action does not create duplicate active builds.
- [ ] Backlog launch action uses `promoteBacklogItemToBuildDraft` or the same governed transaction, not raw `createFeatureBuild`.
- [ ] `/build?buildId=<id>` is supported before any UI links to it.
- [ ] Portfolio completeness code matches the Prisma schema.
- [ ] Portfolio budget cleanup uses exact current slugs, including `manufacturing_and_delivery`.
- [ ] Build Studio long-title cases are verified on desktop and mobile.
- [ ] All implementation branches are created from current `main` in isolated worktrees and land by PR.

## First Slice Recommendation

Start with PR 1: Chunks 0, 1, and 2. It addresses the most trust-damaging symptoms first: broken portfolio clicks, astronomical seeded budgets, and missing data provenance. It also creates the shared provenance foundation needed by provider and authority panels, so later slices get simpler instead of inventing page-specific fixes.
