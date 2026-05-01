# Discovery → Portfolio Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the visible gap between Estate Discovery and the Foundational Portfolio by replacing the hardcoded promotion gate with a typed taxonomy-policy resolver, adding background classification + enrichment that reuses the existing `DiscoveryFingerprintRule` foundation, rendering the schema fields the detail UI already has, and giving the Estate Specialist + Portfolio Analyst a durable governance loop.

**Architecture:** Five vertical slices share three foundation pieces — a pure promotion policy resolver, a shared quality-issue writer, and a fingerprint-rule adapter. Each slice is independently shippable. UI changes consume server-side view models so raw JSON never reaches components. All inference flows through the existing OpenAI-compatible runtime in `apps/web/lib/ai-inference.ts`; no provider names are pinned.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL, TypeScript, Vitest, pnpm workspaces, existing `@dpf/db` discovery modules, existing queue-function conventions in `apps/web/lib/queue/functions/`.

**Spec:** [docs/superpowers/specs/2026-04-30-discovery-portfolio-gap-closure-design.md](../specs/2026-04-30-discovery-portfolio-gap-closure-design.md)

---

## Scope Boundary

**In scope.**
- Slice 0: Estate Specialist operator-identity rename (display + alias only; agent_id preserved).
- Slice 1: Promotion gate replaced by typed policy resolver; promotion-audit page; quality issues on every skip.
- Slice 2: Auto-classification (fingerprint rules + model-assisted fallback) for un-classified `InventoryEntity`.
- Slice 3: Auto-enrichment background pipeline (`enrich-digital-product` queue function + chain steps).
- Slice 4: Theme-aware detail rendering for `PortfolioNodeDetail` and a new `DigitalProduct` detail page.
- Slice 5: Portfolio Analyst governance loop (skill, three MCP tools, completeness strip, daily review task).
- Refactoring budget items from spec §9.

**Not in scope (deferred to other epics).**
- Populating `for_employees`, `manufacturing_and_delivery`, `products_and_services_sold` root portfolios.
- Renaming the durable `agent_id` `AGT-WS-INVENTORY` → `AGT-WS-ESTATE`.
- A second recognition catalog (must reuse `DiscoveryFingerprintRule`).
- Multi-source / remote discovery.
- Auto-creating new `TaxonomyNode` rows.

---

## Pre-Flight (one-time before Task 1)

**Two routes converge here.** A scheduled remote routine (`trig_01XYgmpsiMdZaZF5VRvePMoY`, fires 2026-05-07 14:00 UTC) handles the GitHub-side checks (PR #361 merge status, concurrent-PR collisions, open-question decisions) and posts its report as a PR comment. The four items below are the **operator-run, machine-local** checks the remote routine cannot reach.

### Local pre-flight (operator-run, requires Docker + psql access)

- [ ] Re-run the audit query against the install's Postgres to confirm spec §1 numbers still hold; record current counts under `docs/superpowers/specs/2026-04-30-discovery-portfolio-gap-closure-design.md` §1 evidence note.
- [ ] Confirm no concurrent open PR is touching `packages/db/src/discovery-promotion.ts` or `apps/web/components/portfolio/PortfolioNodeDetail.tsx` (`gh pr list --search 'discovery-promotion OR PortfolioNodeDetail'`).
- [ ] Verify pre-commit typecheck hook is active: `git config core.hooksPath` returns `.githooks`.
- [ ] Confirm fingerprint foundation tables have at least one seed row (`SELECT count(*) FROM "DiscoveryFingerprintCatalogVersion"`); if empty, the fingerprint contribution slice has not landed and Chunks 4–5 must wait. **Action if empty:** seed via the canonical fingerprint seed path (e.g. `pnpm --filter @dpf/db exec ts-node src/seed-fingerprints.ts`), or coordinate with the author of the upstream fingerprint contribution PR before proceeding.

---

## File Structure

### Refactoring foundation (Chunk 1)
- Create: `packages/db/src/discovery-promotion-policy.ts`
- Create: `packages/db/src/discovery-promotion-policy.test.ts`
- Create: `packages/db/src/portfolio-quality-issue-writer.ts`
- Create: `packages/db/src/portfolio-quality-issue-writer.test.ts`
- Create: `packages/db/src/discovery-fingerprint-adapter.ts`
- Create: `packages/db/src/discovery-fingerprint-adapter.test.ts`
- Modify: `packages/db/src/index.ts` — re-export new helpers
- Create: `apps/web/lib/coworker-identity.ts`
- Create: `apps/web/lib/coworker-identity.test.ts`

### Slice 1 — promotion gate + audit (Chunk 2)
- Modify: `packages/db/src/discovery-promotion.ts`
- Modify: `packages/db/src/discovery-promotion.test.ts`
- Modify: `packages/db/src/seed.ts` — promotability defaults under `TaxonomyNode.governance`
- Create: `apps/web/lib/discovery/promotion-audit.ts`
- Create: `apps/web/lib/discovery/promotion-audit.test.ts`
- Create: `apps/web/app/(shell)/platform/tools/discovery/promotion-audit/page.tsx`

### Slice 4 — detail rendering (Chunk 3)
- Create: `apps/web/lib/portfolio/portfolio-node-view-model.ts`
- Create: `apps/web/lib/portfolio/portfolio-node-view-model.test.ts`
- Create: `apps/web/lib/portfolio/digital-product-view-model.ts`
- Create: `apps/web/lib/portfolio/digital-product-view-model.test.ts`
- Modify: `apps/web/components/portfolio/PortfolioNodeDetail.tsx`
- Create: `apps/web/components/portfolio/PortfolioNodeAbout.tsx`
- Create: `apps/web/components/portfolio/PortfolioNodeGovernance.tsx`
- Create: `apps/web/components/portfolio/PortfolioNodeEnrichment.tsx`
- Create: `apps/web/app/(shell)/portfolio/[[...slug]]/products/[productId]/page.tsx`
- Create: `apps/web/components/portfolio/DigitalProductDetail.tsx`
- Create: `apps/web/components/portfolio/FreshnessBadge.tsx`

### Slice 3 — auto-enrichment (Chunk 4)
- Modify: `packages/db/prisma/schema.prisma` — add `InventoryEntity.freshness`, `DigitalProduct.enrichmentStatus`, `DigitalProduct.lastEnrichedAt`
- Create: `packages/db/prisma/migrations/<timestamp>_freshness_and_enrichment_status/migration.sql`
- Create: `packages/db/src/version-normalize.ts`
- Create: `packages/db/src/version-normalize.test.ts`
- Create: `apps/web/lib/enrichment/enrichment-types.ts`
- Create: `apps/web/lib/enrichment/fingerprint-enricher.ts`
- Create: `apps/web/lib/enrichment/fingerprint-enricher.test.ts`
- Create: `apps/web/lib/enrichment/version-enricher.ts`
- Create: `apps/web/lib/enrichment/version-enricher.test.ts`
- Create: `apps/web/lib/enrichment/description-enricher.ts`
- Create: `apps/web/lib/enrichment/description-enricher.test.ts`
- Create: `apps/web/lib/enrichment/vendor-probe-enricher.ts`
- Create: `apps/web/lib/enrichment/vendor-probe-enricher.test.ts`
- Create: `apps/web/lib/queue/functions/enrich-digital-product.ts`
- Create: `apps/web/lib/queue/functions/enrich-digital-product.test.ts`
- Create: `apps/web/lib/queue/functions/age-inventory-freshness.ts`
- Create: `apps/web/lib/queue/functions/age-inventory-freshness.test.ts`
- Modify: `packages/db/src/discovery-promotion.ts` — post-promotion enqueue hook
- Modify: `apps/web/lib/queue/functions/index.ts` — register new functions

### Slice 2 — auto-classification (Chunk 5)
- Create: `packages/db/src/discovery-classification.ts`
- Create: `packages/db/src/discovery-classification.test.ts`
- Create: `apps/web/lib/queue/functions/classify-inventory-entity.ts`
- Create: `apps/web/lib/queue/functions/classify-inventory-entity.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts` — add `classify_inventory_entity` and `enrich_digital_product`
- Modify: `apps/web/lib/agent-grants.ts` (or `TOOL_TO_GRANTS`) — map new tools

### Slice 0 — operator identity (Chunk 6)
- Create: `prompts/route-persona/estate-specialist.prompt.md` (new copy with display name)
- Modify: `prompts/route-persona/inventory-specialist.prompt.md` — keep as compatibility alias OR remove if alias resolver covers seed
- Modify: `packages/db/data/agent_registry.json` — add `aliases: ["estate-specialist", "inventory-specialist"]` to `AGT-WS-INVENTORY`, update `displayName`
- Modify: `packages/db/src/seed.ts` — emit display name + aliases
- Modify: any peer-reference prompts that describe `AGT-WS-INVENTORY`
- Tests: `apps/web/lib/coworker-identity.test.ts` (already in Chunk 1) — alias resolution

### Slice 5 — Portfolio Analyst governance (Chunk 7)
- Create: `skills/route-persona/portfolio-completeness-review.skill.md`
- Modify: `apps/web/lib/mcp-tools.ts` — add `approve_taxonomy_gap_proposal`, `set_node_required_fields`, `request_re_enrichment`
- Create: `apps/web/lib/portfolio/completeness.ts`
- Create: `apps/web/lib/portfolio/completeness.test.ts`
- Create: `apps/web/components/portfolio/CompletenessStrip.tsx`
- Modify: `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` — render `CompletenessStrip`
- Create: `apps/web/lib/queue/functions/portfolio-completeness-review.ts`
- Create: `apps/web/lib/queue/functions/portfolio-completeness-review.test.ts`
- Modify: scheduled task config — register 08:30 UTC daily run

### Documentation
- Modify: `docs/superpowers/specs/2026-04-30-discovery-portfolio-gap-closure-design.md` — append "Implementation Status" section as each chunk lands

---

## Chunk 1: Refactoring Foundation

Lands the pure helpers that Chunks 2–7 depend on. No production behavior change in this chunk.

### Task 1.1: Promotion policy resolver

**Files:**
- Create: `packages/db/src/discovery-promotion-policy.ts`
- Create: `packages/db/src/discovery-promotion-policy.test.ts`

- [ ] **Step 1: Write failing tests for `resolvePromotionDecision`**

```ts
// packages/db/src/discovery-promotion-policy.test.ts
import { describe, expect, it } from "vitest";
import { resolvePromotionDecision, LEGACY_PROMOTABLE_TYPES } from "./discovery-promotion-policy";

describe("resolvePromotionDecision", () => {
  const baseEntity = {
    entityType: "host",
    attributionStatus: "attributed" as const,
    attributionConfidence: 0.95,
    digitalProductId: null,
    taxonomyNodeId: "tn_1",
  };
  const taxonomyNode = { id: "tn_1", nodeId: "foundational/compute/servers", governance: null };
  const portfolio = { id: "p_1", slug: "foundational" };

  it("approves when policy is auto and all gates pass", () => {
    const node = { ...taxonomyNode, governance: { promotion: { mode: "auto" } } };
    expect(resolvePromotionDecision(baseEntity, node, portfolio)).toEqual({
      decision: "promote",
      classifyAs: undefined,
      evidence: { source: "node-policy" },
    });
  });

  it("falls back to legacy PROMOTABLE_TYPES when governance.promotion is missing", () => {
    expect(resolvePromotionDecision(baseEntity, taxonomyNode, portfolio).decision).toBe("promote");
    const ne = { ...baseEntity, entityType: "network_client" };
    const skip = resolvePromotionDecision(ne, taxonomyNode, portfolio);
    expect(skip.decision).toBe("skip");
    expect(skip.reason).toBe("type_not_promotable");
  });

  it("skips with reason 'low_confidence_promotion' below threshold", () => {
    const e = { ...baseEntity, attributionConfidence: 0.5 };
    expect(resolvePromotionDecision(e, taxonomyNode, portfolio).reason).toBe("low_confidence_promotion");
  });

  it("skips with reason 'no_taxonomy' when taxonomyNode is null", () => {
    const e = { ...baseEntity, taxonomyNodeId: null };
    expect(resolvePromotionDecision(e, null, portfolio).reason).toBe("no_taxonomy");
  });

  it("skips with reason 'no_portfolio_root' when portfolio not found", () => {
    expect(resolvePromotionDecision(baseEntity, taxonomyNode, null).reason).toBe("no_portfolio_root");
  });

  it("emits classifyAs from policy when provided", () => {
    const node = { ...taxonomyNode, governance: { promotion: { mode: "auto", classifyAs: "infrastructure_endpoint" } } };
    const e = { ...baseEntity, entityType: "network_client" };
    expect(resolvePromotionDecision(e, node, portfolio).classifyAs).toBe("infrastructure_endpoint");
  });
});

describe("LEGACY_PROMOTABLE_TYPES", () => {
  it("matches the historical list exactly", () => {
    expect(LEGACY_PROMOTABLE_TYPES).toEqual([
      "host","runtime","container","database","monitoring_service","ai_service",
      "application","subnet","gateway","network_interface","docker_host","router",
    ]);
  });
});
```

- [ ] **Step 2:** `pnpm --filter @dpf/db exec vitest run discovery-promotion-policy` — confirm all six tests fail.
- [ ] **Step 3: Implement `discovery-promotion-policy.ts`** — pure function, no DB calls. Export the legacy types list, `AUTO_PROMOTE_THRESHOLD = 0.90`, type `PromotionDecision = { decision: "promote", classifyAs?: string, evidence: object } | { decision: "skip", reason: PromotionSkipReason, evidence: object }`. Resolution order: no taxonomy → low confidence → no portfolio → policy lookup (governance.promotion → fallback to legacy types) → already-linked → emit decision.
- [ ] **Step 4:** Re-run tests — all green.
- [ ] **Step 5: Commit** — `feat(db): pure promotion policy resolver`

### Task 1.2: Shared quality-issue writer

**Files:**
- Create: `packages/db/src/portfolio-quality-issue-writer.ts`
- Create: `packages/db/src/portfolio-quality-issue-writer.test.ts`

- [ ] **Step 1: Write failing tests** for `openOrUpdateQualityIssue({ db, scope, issueType, severity, summary, details, links })`. Cover: opens new with computed `issueKey`; refreshes `lastDetectedAt` when `(scope, issueType)` already open; resolves automatically when same key is reported with `status:"resolve"`; rejects unknown `issueType` against the canonical constants list.
- [ ] **Step 2:** Run vitest — fails.
- [ ] **Step 3: Implement** with a typed `QualityIssueType` union: `"type_not_promotable" | "no_taxonomy" | "no_portfolio_root" | "low_confidence_promotion" | "taxonomy_gap_proposal" | "incomplete_detail" | "enrichment_failed"`. `issueKey` = stable hash of `(issueType, primary scope FK)`. Use a Prisma upsert.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(db): shared portfolio quality issue writer`

### Task 1.3: Fingerprint-rule adapter

**Files:**
- Create: `packages/db/src/discovery-fingerprint-adapter.ts`
- Create: `packages/db/src/discovery-fingerprint-adapter.test.ts`

- [ ] **Step 1: Write failing tests.** Adapter exposes `matchInventoryEntity(entity, { rules })` and returns `{ ruleId, taxonomyNodeId, identityConfidence, taxonomyConfidence, manufacturer?, productModel?, technicalClass?, iconKey? } | null`. Cover: returns null when no rules match; returns highest-confidence match when multiple match; ignores rules whose `status !== "active"`; respects `requiredEvidenceFamilies`.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3: Implement** by reusing `evaluateRules` from `discovery-fingerprint-rules.ts` (already shipped). Adapter is the *interpretation* layer that maps a successful match into classification + enrichment hints. No web code should call rules directly.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(db): fingerprint adapter for classification + enrichment`

### Task 1.4: Coworker identity alias resolver

**Files:**
- Create: `apps/web/lib/coworker-identity.ts`
- Create: `apps/web/lib/coworker-identity.test.ts`

- [ ] **Step 1: Write failing tests** for `resolveCoworkerIdentity(input)` where `input` is an `agentId`, `personaName`, or `alias`. Cover: `"AGT-WS-INVENTORY"` → canonical record; `"inventory-specialist"` → canonical via alias; `"estate-specialist"` → canonical via alias; unknown returns null. Snapshot `displayName` is `"Digital Product Estate Specialist"`. **Tests should use a local fixture registry — the actual `agent_registry.json` patch lands in Chunk 6 Task 6.1, so the resolver is built and unit-tested against a fixture first.**
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement** — accept an injected registry source (default: read from `agent_registry.json`). Build alias map, expose `resolveCoworkerIdentity` and `getCanonicalAgentId(alias)`. Until Chunk 6 lands, callers in Chunks 4–5 wire through the fixture in tests; production reads still hit the not-yet-aliased registry harmlessly because the canonical `agent_id` already exists.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(web): coworker identity alias resolver`

### Task 1.5: Run full Chunk-1 build gate

- [ ] **Step 1:** `pnpm --filter @dpf/db exec vitest run` — green.
- [ ] **Step 2:** `pnpm --filter web exec vitest run lib/coworker-identity` — green.
- [ ] **Step 3:** `cd apps/web && npx next build` — zero errors. Note any pre-existing failures in commit message.
- [ ] **Step 4: Append to spec §Implementation Status** — add a Chunk 1 line with date, commit SHAs, and any deviations from the plan.
- [ ] **Step 5: Commit** with `[chunk-1-complete]` tag.

---

## Chunk 2: Slice 1 — Promotion Gate Fix + Audit Visibility

Replaces the inline filter inside `promoteInventoryEntities` with the policy resolver from Task 1.1, adds quality issues for every skip, and ships the audit page.

### Task 2.1: Promotion uses policy resolver

**Files:**
- Modify: `packages/db/src/discovery-promotion.ts`
- Modify: `packages/db/src/discovery-promotion.test.ts`

- [ ] **Step 1: Add failing tests** to `discovery-promotion.test.ts`: a `network_client` entity with no governance.promotion is now skipped with `type_not_promotable` AND a `PortfolioQualityIssue` row appears via injected writer. A `network_client` whose taxonomy node has `{ governance: { promotion: { mode: "auto", classifyAs: "infrastructure_endpoint" } } }` is promoted and the resulting `DigitalProduct.observationConfig.classifyAs` is set.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Refactor** `promoteInventoryEntities` to call `resolvePromotionDecision` per entity. On `skip` decisions call `openOrUpdateQualityIssue` (injected via `db` arg to keep purity at the unit-test boundary). On `promote` decisions write `classifyAs` into `DigitalProduct.observationConfig`. Keep the upsert + back-link logic.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `refactor(db): promotion uses policy resolver, writes quality issues on skip`

### Task 2.2: Seed default promotion governance

**Files:**
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1: Add seed test (skip if absent)** confirming foundational subtree taxonomy nodes carry `governance.promotion.mode = "auto"` after seed; nodes for endpoint-class types (`network_client`, `access_point`, `vlan`, `switch`, `service`) carry `classifyAs: "infrastructure_endpoint"`.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3: Patch seed** — backfill `governance.promotion` on every existing `TaxonomyNode` if missing. Idempotent.
- [ ] **Step 4:** Re-seed locally: `pnpm --filter @dpf/db exec ts-node src/seed.ts` (or whatever the canonical path is). Spot-check via psql that one foundational node now has the policy.
- [ ] **Step 5: Commit** — `feat(db): seed default taxonomy promotion governance`

### Task 2.3: Promotion-audit query helper

**Files:**
- Create: `apps/web/lib/discovery/promotion-audit.ts`
- Create: `apps/web/lib/discovery/promotion-audit.test.ts`

- [ ] **Step 1: Write failing tests** for `getPromotionAudit(db)` returning `{ counts: { discovered, attributed, promoted, blocked }, blockedByReason: Record<reason, { count, sample: EntitySummary[] }> }`. Cover empty DB and DB with one of each skip reason.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement.** Counts come from `InventoryEntity` and `PortfolioQualityIssue` joined on `inventoryEntityId`. Single SQL view not introduced yet — use Prisma queries.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(web): promotion audit query helper`

### Task 2.4: Promotion-audit page

**Files:**
- Create: `apps/web/app/(shell)/platform/tools/discovery/promotion-audit/page.tsx`

- [ ] **Step 1: Write a server-component snapshot test** (or a manual UX checklist if no snapshot infra) covering: top counts strip, grouped blockers section per reason, drill-in table with name/type/taxonomy/confidence/last-seen.
- [ ] **Step 2:** UI scaffolds; no logic.
- [ ] **Step 3: Implement page** using `getPromotionAudit`. All styling theme-aware per AGENTS.md §12 — only `var(--dpf-*)` tokens; no hex; no Tailwind grays. Empty-state copy distinguishes "nothing discovered" vs "all promoted" vs "blocked-with-reason".
- [ ] **Step 4: Manual UX verification** against the running portal: navigate to `/platform/tools/discovery/promotion-audit`, log in as `admin@dpf.local`, confirm counts match psql results. Document in commit body.
- [ ] **Step 5: Commit** — `feat(web): promotion audit page`

### Task 2.5: Chunk 2 build gate

- [ ] **Step 1:** Vitest, full filter — green.
- [ ] **Step 2:** `cd apps/web && npx next build` — green.
- [ ] **Step 3: Append to spec §Implementation Status** — Chunk 2 line with date, commit SHAs, deviations.
- [ ] **Step 4: Commit** any drift fixes; tag `[chunk-2-complete]`.

---

## Chunk 3: Slice 4 — Detail Page Rendering

Pairs with Chunk 2 so newly-promoted items have a real detail UI immediately. Theme-token cleanup is in-scope for this chunk per spec §6.4.

### Task 3.1: Portfolio node view model

**Files:**
- Create: `apps/web/lib/portfolio/portfolio-node-view-model.ts`
- Create: `apps/web/lib/portfolio/portfolio-node-view-model.test.ts`

- [ ] **Step 1: Failing tests** for `toPortfolioNodeViewModel(node)` mapping raw `TaxonomyNode` (with `description`, `governance`, `enrichment` JSON) into typed `{ about: string|null, governance: GovernanceFields, enrichment: EnrichmentFields }` where unknown JSON keys are dropped and known keys are typed.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement** with a strict Zod schema (or hand-rolled type-guard) for governance/enrichment shapes. Unknown shapes log a `[view-model]` warning and emit `null`.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(web): portfolio node view model`

### Task 3.2: Theme-token cleanup of `PortfolioNodeDetail`

**Files:**
- Modify: `apps/web/components/portfolio/PortfolioNodeDetail.tsx`

- [ ] **Step 1: Audit pass** — list every hardcoded color (`PORTFOLIO_COLOURS`, inline `style={{ color: ... }}`, `text-[#…]`, `text-white`, `text-gray-*`, `bg-white`). Record line numbers in commit body.
- [ ] **Step 2: Replace** each with the appropriate `var(--dpf-*)` token per AGENTS.md §12 table. The only retained `text-white` is on accent buttons.
- [ ] **Step 3: Manual UX:** light + dark + a non-default brand token override. Confirm contrast.
- [ ] **Step 4:** `cd apps/web && npx next build` — green.
- [ ] **Step 5: Commit** — `refactor(web): theme-aware tokens in PortfolioNodeDetail`

### Task 3.3: About / Governance / Enrichment sections

**Files:**
- Create: `apps/web/components/portfolio/PortfolioNodeAbout.tsx`
- Create: `apps/web/components/portfolio/PortfolioNodeGovernance.tsx`
- Create: `apps/web/components/portfolio/PortfolioNodeEnrichment.tsx`
- Modify: `apps/web/components/portfolio/PortfolioNodeDetail.tsx`

- [ ] **Step 1: Write component snapshot tests** for each section: empty-state when field is null; populated-state renders labeled fields, not raw JSON.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement** as full-width bands (no nested cards per spec §6.4). Pass typed view-model props.
- [ ] **Step 4:** Wire into `PortfolioNodeDetail` after the existing summary strip.
- [ ] **Step 5: Manual UX:** view a foundational node with description/governance present and one without.
- [ ] **Step 6: Commit** — `feat(web): about/governance/enrichment sections on portfolio node`

### Task 3.4: Digital product detail page

**Files:**
- Create: `apps/web/lib/portfolio/digital-product-view-model.ts` + test
- Create: `apps/web/components/portfolio/DigitalProductDetail.tsx`
- Create: `apps/web/components/portfolio/FreshnessBadge.tsx`
- Create: `apps/web/app/(shell)/portfolio/[[...slug]]/products/[productId]/page.tsx`

- [ ] **Step 1: View-model failing test** mapping `DigitalProduct + InventoryEntity[] + recent PortfolioQualityIssue[]` into render-ready shape.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement view model** — pure function, no DB.
- [ ] **Step 4: Implement page** — fetches product + linked entities, calls view model, renders `DigitalProductDetail`. Sections: name + version, description, taxonomy lineage (breadcrumb), manufacturer/model badge, technical class, icon, lifecycle stage/status, freshness badge, linked inventory entities table with attribution evidence, enrichment status, recent quality issues, recent change items. All theme-aware.
- [ ] **Step 5: Manual UX:** drill into an existing promoted product (e.g. `host-2ac308458df7`), confirm all sections render.
- [ ] **Step 6: Commit** — `feat(web): digital product detail page`

### Task 3.5: Chunk 3 build gate

- [ ] vitest + next build green.
- [ ] Append to spec §Implementation Status — Chunk 3 line.
- [ ] Tag `[chunk-3-complete]`.

---

## Chunk 4: Slice 3 — Auto-Enrichment Background Pipeline

Adds the schema columns, the enrichment chain, and the queue function. Triggered post-promotion + weekly + on demand.

### Task 4.1: Schema migration — freshness + enrichment status

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_freshness_and_enrichment_status/migration.sql`

- [ ] **Step 1: Add fields** to `schema.prisma`:
  - `InventoryEntity.freshness String @default("fresh")`
  - `DigitalProduct.enrichmentStatus String @default("pending")`
  - `DigitalProduct.lastEnrichedAt DateTime?`
- [ ] **Step 2:** `pnpm --filter @dpf/db exec prisma migrate dev --name freshness_and_enrichment_status` — confirm migration applies cleanly.
- [ ] **Step 3: Add backfill SQL** inline in the migration: `UPDATE "InventoryEntity" SET "freshness" = CASE WHEN "status" = 'stale' THEN 'stale' ELSE 'fresh' END;`
- [ ] **Step 4: Verify** the generated `migration.sql` includes both the schema changes AND the backfill UPDATE in the same file before commit (per AGENTS.md §2: "Backfill SQL for any data-moving migration goes inline in the same migration file, not a separate script"). If Prisma split them, merge manually.
- [ ] **Step 5: Add canonical-enum tests** in a new `packages/db/src/freshness-enum.test.ts` asserting the typed-enum-strings rule per AGENTS.md §3 (`fresh|stale|retired`, `pending|enriched|partial|failed`).
- [ ] **Step 6: Commit** — `feat(db): freshness + enrichment status columns + migration`

### Task 4.2: Version normalizer

**Files:**
- Create: `packages/db/src/version-normalize.ts` + test

- [ ] **Step 1: Failing tests** covering semver (`1.2.3-beta.1`), calver (`2024.04.30`), debian-style (`2:8.2-1ubuntu0.1`), prefixed (`v1.2.3`), and unparseable (returns null). Output shape: `{ canonical: string, family: "semver"|"calver"|"debian"|"raw", major?: number, minor?: number, patch?: number }`.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement** as pure functions. No external dependency beyond what's already in the db package.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(db): version normalizer`

### Task 4.3: Enricher adapters

Each adapter is a small pure function returning a partial enrichment patch. Fail-soft (returns null on failure, never throws).

**Files:**
- Create: `apps/web/lib/enrichment/enrichment-types.ts`
- Create: `apps/web/lib/enrichment/fingerprint-enricher.ts` + test
- Create: `apps/web/lib/enrichment/version-enricher.ts` + test
- Create: `apps/web/lib/enrichment/description-enricher.ts` + test
- Create: `apps/web/lib/enrichment/vendor-probe-enricher.ts` + test

- [ ] **Step 1:** Define `EnrichmentPatch = Partial<{ manufacturer, productModel, technicalClass, iconKey, normalizedVersion, description, taxonomyNodeId, evidence }>` and `Enricher = (entity, ctx) => Promise<EnrichmentPatch | null>`.
- [ ] **Step 2: TDD each enricher** in turn:
  - `fingerprint-enricher` — calls `matchInventoryEntity` from Task 1.3.
  - `version-enricher` — pure normalization via Task 4.2.
  - `description-enricher` — calls `apps/web/lib/ai-inference.ts` with the configured small inference profile; cache by `(entityId, observationFingerprint)`; output ≤ 2 sentences, validated. **Quota guard:** check a per-install daily counter (default `DPF_DESCRIPTION_ENRICH_DAILY_QUOTA=200`, env-overridable per Open Question #2) before each inference call; on quota exhaustion return `null` and emit an `enrichment_failed` quality issue with reason `quota_exhausted`. The decision on the actual quota number must be logged in the plan's "Open Question Decisions" section before this step starts.
  - `vendor-probe-enricher` — off by default via `process.env.DPF_ENABLE_VENDOR_PROBE !== "1"`; banner-grab + container-inspect adapters; redacts secrets per existing fingerprint redaction helpers.
- [ ] **Step 3: Each commits separately** — `feat(enrichment): <adapter>` per adapter.

### Task 4.4: `enrich-digital-product` queue function

**Files:**
- Create: `apps/web/lib/queue/functions/enrich-digital-product.ts` + test
- Modify: `apps/web/lib/queue/functions/index.ts`

- [ ] **Step 1: Failing test** covering: pulls product + linked entities; runs the four enrichers in order; merges patches with later enrichers winning only when previous is null; writes to DB; sets `enrichmentStatus` based on which fields ended up populated; writes `incomplete_detail` quality issue when `requiredFields` (from `TaxonomyNode.governance.requiredFields`) remain unset; updates `lastEnrichedAt`.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement** following the existing queue-function shape (look at `brand-extract.ts` for conventions). Idempotent.
- [ ] **Step 4: Register** in `index.ts`.
- [ ] **Step 5:** Tests green.
- [ ] **Step 6: Commit** — `feat(queue): enrich-digital-product background function`

### Task 4.5: Post-promotion enqueue hook

**Files:**
- Modify: `packages/db/src/discovery-promotion.ts` — add the injected `onPromote` callback parameter
- Modify: the web-layer caller(s) of `promoteInventoryEntities` — wire the actual enqueue. Locations to update: `apps/web/lib/actions/inventory.ts` (calls at lines 276, 314, 469 per spec §3.1) and `apps/web/lib/discovery/discovery-runner.ts` (bulk sweep). Grep for `promoteInventoryEntities(` before editing to confirm the full caller list.

- [ ] **Step 1: Failing test** confirming successful promotion enqueues an `enrich-digital-product` job for the new productId via the injected callback (mock the queue client; assert call args).
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Add hook** to `discovery-promotion.ts` as an injected callback param so the db package stays free of queue dependencies. Default to a no-op when not provided to preserve existing test behavior.
- [ ] **Step 4: Wire the web-layer callers** identified above to pass the real enqueue function. Each call site should pass the same wrapper from `apps/web/lib/queue/index.ts` (or wherever the queue client is exported).
- [ ] **Step 5:** Tests green; manual: trigger a triage decision, watch the queue logs for an `enrich-digital-product` job.
- [ ] **Step 6: Commit** — `feat(db): post-promotion enrichment enqueue hook`

### Task 4.6: `age-inventory-freshness` queue function

**Files:**
- Create: `apps/web/lib/queue/functions/age-inventory-freshness.ts` + test
- Modify: scheduled task config — register daily run

- [ ] **Step 1: Failing test** covering: entity not seen in `>= 1` discovery run since last sweep flips `fresh` → `stale`; not seen in `>= 14 days` flips `stale` → `retired`; thresholds configurable via `process.env.DPF_FRESHNESS_STALE_RUNS` / `DPF_FRESHNESS_RETIRE_DAYS`.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement** — straightforward `updateMany` queries.
- [ ] **Step 4: Register** as a daily scheduled run.
- [ ] **Step 5:** Tests green.
- [ ] **Step 6: Commit** — `feat(queue): age inventory freshness`

### Task 4.7: Chunk 4 build gate

- [ ] vitest, next build, migration apply check.
- [ ] Append to spec §Implementation Status — Chunk 4 line.
- [ ] Tag `[chunk-4-complete]`.

---

## Chunk 5: Slice 2 — Auto-Classification

Sweeps un-classified `InventoryEntity` rows. Rules first; small inference fallback; ambiguous → triage queue.

### Task 5.1: `classifyInventoryEntity` library

**Files:**
- Create: `packages/db/src/discovery-classification.ts` + test

- [ ] **Step 1: Failing tests** covering: rule-match returns the rule's taxonomy node and high confidence; no rule match + good model response returns model-derived node + reasoning recorded in evidence; model returns nonexistent taxonomy node → file under closest existing parent + emit `taxonomy_gap_proposal` quality issue with proposed node; confidence < 0.75 → returns `{ status: "needs_review" }` and adds the entity to triage queue.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement** using the fingerprint adapter from Task 1.3 and `apps/web/lib/ai-inference.ts` for the fallback. Output writes evidence to `attributionEvidence`. Uses `openOrUpdateQualityIssue` for the proposal/needs-review side-effects.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(db): auto-classify inventory entities`

### Task 5.2: `classify-inventory-entity` queue function

**Files:**
- Create: `apps/web/lib/queue/functions/classify-inventory-entity.ts` + test

- [ ] **Step 1: Failing test** covering daily sweep behavior: only entities with `taxonomyNodeId IS NULL` processed; rate-limited by `DPF_CLASSIFY_BATCH_SIZE` (default 50); idempotent.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement** wrapping `classifyInventoryEntity` per row.
- [ ] **Step 4: Register** in scheduled tasks for 08:15 UTC (after 08:00 triage).
- [ ] **Step 5:** Tests green.
- [ ] **Step 6: Commit** — `feat(queue): daily classification sweep`

### Task 5.3: MCP tool surface for classification + manual enrichment

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/agent-grants.ts` (or `TOOL_TO_GRANTS`)

- [ ] **Step 1: Failing tests** — schema validation + grant resolution for `classify_inventory_entity` and `enrich_digital_product`.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement.** Both tools resolve through `AGT-WS-INVENTORY` (estate-specialist alias). `classify_inventory_entity` accepts `entityId` and returns the classification result. `enrich_digital_product` accepts `productId` and enqueues the queue job.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(mcp): classify_inventory_entity + enrich_digital_product tools`

### Task 5.4: Chunk 5 build gate

- [ ] vitest + next build green.
- [ ] Append to spec §Implementation Status — Chunk 5 line.
- [ ] Tag `[chunk-5-complete]`.

---

## Chunk 6: Slice 0 — Operator Identity Rename (Compatibility-Safe)

Display + alias only. `agent_id` `AGT-WS-INVENTORY` preserved.

### Task 6.1: Add `estate-specialist` alias

**Files:**
- Modify: `packages/db/data/agent_registry.json`
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1: Failing test** — `resolveCoworkerIdentity("estate-specialist")` returns the `AGT-WS-INVENTORY` record with `displayName` `"Digital Product Estate Specialist"`.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Patch** registry: add `aliases: ["estate-specialist", "inventory-specialist"]`, set `displayName: "Digital Product Estate Specialist"`. Patch seed to emit aliases. Re-seed locally.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(coworker): estate-specialist alias on AGT-WS-INVENTORY`

### Task 6.2: New prompt file with estate-specialist copy

**Files:**
- Create: `prompts/route-persona/estate-specialist.prompt.md`
- Modify: `prompts/route-persona/inventory-specialist.prompt.md` — front-matter alias note + display name update

- [ ] **Step 1:** Copy `inventory-specialist.prompt.md` → `estate-specialist.prompt.md`. Update displayName, perspective, and role title to "Digital Product Estate Specialist". Preserve `agent_id: AGT-WS-INVENTORY`.
- [ ] **Step 2:** Update peer-reference language in other prompts where this agent is described — change "Product Manager" → "Estate Specialist" only when the line is about discovered-estate ownership.
- [ ] **Step 3: Verification** — re-seed prompts (`packages/db/data/PromptTemplate` seed), open Admin > Prompts, confirm both names route to the same agent.
- [ ] **Step 4: Commit** — `docs(prompts): estate-specialist persona copy`

### Task 6.3: Chunk 6 build gate

- [ ] vitest + next build + manual UX (Admin > Prompts shows new display name; route prompts route to right agent).
- [ ] Append to spec §Implementation Status — Chunk 6 line.
- [ ] Tag `[chunk-6-complete]`.

---

## Chunk 7: Slice 5 — Portfolio Analyst Governance Loop

Standing workflow over the outputs of chunks 2–6.

### Task 7.1: Completeness scoring

**Files:**
- Create: `apps/web/lib/portfolio/completeness.ts` + test

- [ ] **Step 1: Failing tests** for `computePortfolioCompleteness(portfolio)` returning `{ requiredFieldsScore, enrichmentScore, openIssuesByType }`. `requiredFieldsScore` reads `TaxonomyNode.governance.requiredFields` per node.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement** with two SQL aggregations.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(portfolio): completeness scoring`

### Task 7.2: `CompletenessStrip` component

**Files:**
- Create: `apps/web/components/portfolio/CompletenessStrip.tsx`
- Modify: `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`

- [ ] **Step 1: Component snapshot test** — renders three numbers with theme-token styling.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement** + wire into the portfolio page above the existing tree.
- [ ] **Step 4: Manual UX** confirm the strip shows on `/portfolio/foundational`.
- [ ] **Step 5: Commit** — `feat(web): completeness strip on portfolio page`

### Task 7.3: Portfolio Analyst MCP tools

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/agent-grants.ts`

- [ ] **Step 1: Failing tests** for `approve_taxonomy_gap_proposal`, `set_node_required_fields`, `request_re_enrichment`. Validation + grant resolution to `AGT-WS-PORTFOLIO`.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement.** `approve_taxonomy_gap_proposal` creates the proposed `TaxonomyNode` and resolves the originating quality issue. `set_node_required_fields` writes to `TaxonomyNode.governance.requiredFields`. `request_re_enrichment` enqueues the Chunk 4 queue job.
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(mcp): portfolio analyst governance tools`

### Task 7.4: `portfolio-completeness-review` skill

**Files:**
- Create: `skills/route-persona/portfolio-completeness-review.skill.md`

- [ ] **Step 1:** Author skill following the AI Coworker Operator Pattern (`docs/superpowers/specs/2026-04-30-ai-coworker-operator-pattern.md` §3.2). Inputs: `portfolioRoot`, `windowDays`. Steps: pull newly promoted products, taxonomy-gap proposals, completeness score per node. Outputs: a `PortfolioReview` work product.
- [ ] **Step 2: Seed** — re-run skill seed pass; confirm `SkillAssignment` row exists for `AGT-WS-PORTFOLIO`.
- [ ] **Step 3: Commit** — `docs(skills): portfolio completeness review`

### Task 7.5: Daily review queue function + scheduling

**Files:**
- Create: `apps/web/lib/queue/functions/portfolio-completeness-review.ts` + test

- [ ] **Step 1: Failing test** covering: invokes the skill with the four root portfolios; outputs `PortfolioReview` rows; idempotent on same-day re-run.
- [ ] **Step 2:** Fails.
- [ ] **Step 3: Implement.** Schedule for 08:30 UTC (after 08:00 Estate Specialist triage and 08:15 classification sweep).
- [ ] **Step 4:** Tests green.
- [ ] **Step 5: Commit** — `feat(queue): daily portfolio analyst review`

### Task 7.6: Chunk 7 build gate

- [ ] vitest + next build + manual UX (run `request_re_enrichment` from MCP, confirm queue job lands).
- [ ] Append to spec §Implementation Status — Chunk 7 line; mark spec as Implemented if all chunks landed.
- [ ] Tag `[chunk-7-complete]`.

---

## Final Verification (per AGENTS.md §5)

- [ ] Full vitest run: `pnpm --filter @dpf/db exec vitest run && pnpm --filter web exec vitest run`.
- [ ] Production build: `cd apps/web && npx next build`.
- [ ] Manual UX walkthrough on the running portal:
  - `/platform/tools/discovery` → see all discovered entities with attribution status
  - `/platform/tools/discovery/promotion-audit` → counts match psql; blockers grouped by reason
  - `/portfolio/foundational` → completeness strip visible; product count > 200 (was 100)
  - Drill into a foundational node → about/governance/enrichment sections render
  - Drill into a single product → enrichment fields populated for at least one bootstrap product (Postgres, Neo4j, etc.)
- [ ] DB sanity: `SELECT COUNT(*) FROM "DigitalProduct" WHERE "description" IS NOT NULL` ≥ 95% of total.
- [ ] Migration applies cleanly on a fresh install (`docker compose down -v && docker compose up`).
- [ ] Update spec §1.1–1.4 evidence numbers with post-implementation counts.
- [ ] Append "Implementation Status" section to spec.

---

## Refactoring Budget Tracking (spec §9)

These items are *embedded* in the chunks above, not deferred. Verify each landed:

| Item | Lands in |
| - | - |
| 1. Promotion policy extraction | Task 1.1 + Task 2.1 |
| 2. Shared quality issue writer | Task 1.2 |
| 3. Fingerprint-rule adapter | Task 1.3 |
| 4. Portfolio detail view model | Task 3.1, 3.4 |
| 5. Coworker identity compatibility | Task 1.4 + Chunk 6 |

Refactoring time spent should land near 20% of total chunk effort. If any chunk exceeds 30%, stop and reassess scope with the spec author before continuing.

---

## Open Question Decisions Required Before Execution

These map to spec §11. Each needs a one-line answer logged in this plan before the relevant chunk starts.

1. **Agent ID migration follow-up.** Do we file a separate epic for `AGT-WS-INVENTORY` → `AGT-WS-ESTATE` migration? (Chunk 6 ships compatibility-safe regardless.)
2. **Model cost guardrail.** Quota or cadence-scaling? **Required before Chunk 4 Task 4.3 description-enricher.**
3. **Signature seed scope.** Hand-curate which fingerprints first? Proposal: ~30 covering DPF stack (Postgres, Neo4j, Qdrant, Docker, Ollama, Grafana). **Required before Chunk 4 Task 4.3 fingerprint-enricher.**
4. **Required-field gates default.** Strict-everywhere or opt-in per node? **Required before Task 7.3 `set_node_required_fields`.**
5. **Freshness thresholds.** Defaults: stale = 1 missed run, retired = 14 days. Configurable via env. **Required before Task 4.6.**
6. **Empty portfolios follow-up.** File epic now or wait? Recommend: wait until foundational pipeline is healthy; capture as backlog item only.

---

## References

- Spec: [2026-04-30 Discovery → Portfolio Gap Closure](../specs/2026-04-30-discovery-portfolio-gap-closure-design.md)
- Foundation: [2026-03-13 Bootstrap Discovery](../specs/2026-03-13-bootstrap-infrastructure-discovery-and-portfolio-quality-foundation-design.md), [2026-04-25 Discovery Fingerprint Contribution Pipeline](./2026-04-25-discovery-fingerprint-contribution-pipeline.md)
- Operator pattern: [2026-04-30 AI Coworker Operator Pattern](../specs/2026-04-30-ai-coworker-operator-pattern.md)
- AGENTS.md §3 (typed enums), §4 (PR/DCO), §5 (build gate), §10 (research), §12 (theme tokens)
