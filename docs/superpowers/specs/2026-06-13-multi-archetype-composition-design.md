# Multi-Archetype Composition Design

**Date:** 2026-06-13
**Status:** Draft - pending operator review
**Author:** Claude with user direction (Mark Bodman)
**Related docs:**
- `packages/storefront-templates/src/types.ts` — `ArchetypeDefinition`, `ActivationProfile`, `ArchetypeModule`, `OperatingModelAxes`
- `packages/db/prisma/schema.prisma` — `StorefrontConfig` (single `archetypeId` FK today), `StorefrontArchetype`
- `apps/web/lib/storefront/archetype-vocabulary.ts` — `getVocabulary()`, `getCategorySuggestions()`
- `apps/web/lib/storefront/resolve-vocabulary.ts` — `resolveVocabularyKey()`
- `apps/web/lib/onboarding/archetype-business-context.ts` — `resolveBusinessProfile()`
- `apps/web/lib/tak/marketing-playbooks.ts` — `getPlaybook()`
- `apps/web/lib/storefront/capability-activation.ts` — `getEffectiveCapabilityActivations()`
- `apps/web/lib/storefront/archetype-activation.ts` — `readActivationProfile()`
- `apps/web/components/ui/report-kit/statusColors.ts` — shared status / severity color semantics
- `docs/architecture/archetype-business-value-streams.md` — archetype-to-value-stream business architecture view
- `docs/superpowers/specs/2026-06-12-value-stream-architecture-platform-design.md` — operational value stream model (OVSM)
- `docs/platform-usability-standards.md` — theme-aware UI and report-kit requirements
- Related epic: `EP-ARCH-8D4F2A` (Archetype Model V2)
- Related specs: `2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md`, `2026-06-04-partner-reseller-archetype-identity-design.md`, `2026-04-04-custom-archetype-creation-and-refinement-design.md`

---

## 1. Problem Statement

`StorefrontConfig.archetypeId` is a single required FK — one archetype per storefront. This works for businesses with a single operating model but blocks setup for businesses that span more than one:

| Business | Primary operating model | Second operating model | Today's outcome |
|---|---|---|---|
| Home builder | `new-home-builder` (production communities) | `custom-home-builder` (BYOL projects) | Must pick one; half the business is invisible |
| Bakery + custom cakes | `bakery` (retail goods) | Custom-order project model | Custom orders forced into the same storefront shape as bread loaves |
| Storage company | `self-storage` (asset-rental) | `equipment-rental` (also asset-rental, different workflow) | Must split into two installs or pick one |
| Walmart-style retail | `retail-goods` | `healthcare-wellness` (pharmacy) + `professional-services` (automotive) | No path |
| USAA-style | `banking-financial-services` | Insurance (no category today, but possible) | No path |
| Personal trainer | `fitness-recreation` | `retail-goods` (supplements) | Must pick one |
| Landscaper + snow removal | `trades-maintenance` | Same category, different seasonal service | Works today — same archetype, different items |

**Goal:** never block a business whose model spans archetypes. Two archetypes are the common case; three or more are rare but must be possible. Existing single-archetype installs must be entirely unchanged.

The hard part is not only schema cardinality. The composed business must still feel like one understandable operation to a non-technical owner: one primary identity, multiple service lines, clear operational context, obvious conflicts, and no requirement to understand "archetypes" as an architecture concept.

---

## 2. Live Backlog Context

MCP connector was not available in the authoring session (worktree had no `.mcp.json`; it is gitignored and must be bootstrapped per AGENTS.md section 4). The bullets below are **document-derived planning context, not canonical backlog state**. Canonical backlog status must be re-checked with `list_epics` / `list_backlog_items` before promotion.

- `EP-ARCH-8D4F2A` "Archetype Model V2: Unified Business Archetypes" — in-progress (confirmed by the civic/banking archetype specs, both 2026-06-09, which explicitly file against this epic). This spec belongs here; composition is an axis of the same v2 work.
- No existing multi-archetype or archetype-composition spec found under `docs/superpowers/specs/` (full glob search performed).
- No `StorefrontArchetypeComposition` or equivalent join table found in `packages/db/prisma/schema.prisma`.

**Action for canonical backlog before promotion:** re-run `list_epics` / `list_backlog_items` against the operator's populated backlog via the `dpf` MCP to confirm no concurrent composition work is in flight. If MCP is still unavailable, explicitly use DB fallback against the live Postgres database. Do not treat this section as canonical backlog evidence.

---

## 3. Research & Benchmarking

### 3.0 Standards grounding

| Source | Relevant standard / pattern | What this spec adopts |
|---|---|---|
| Business Architecture Guild, *Business Architecture Metamodel Guide v3.0* ([PDF](https://cdn.ymaws.com/www.businessarchitectureguild.org/resource/resmgr/whitepapers/business_architecture_metamo.pdf)) | Value streams deliver one value proposition, value stream stages are enabled by capabilities, and an organization should maintain one coherent capability set. | Keep one storefront / one organization-level operating profile. Compose service lines as contributors to one capability and value-stream picture, not as unrelated mini-businesses. |
| Lean Enterprise Institute, *Value Stream Mapping* ([overview](https://www.lean.org/lexicon-terms/value-stream-mapping/)) | Useful value-stream views show material/service flow, information flow, and operational measures such as lead time, cycle time, uptime, inventory, and flow decisions. | Composition must be operationally visible: service lines need demand, queue, capacity, and blocker context, not just a list of selected archetypes. |
| The Open Group, ArchiMate 3.2 reference card ([PDF](https://www.opengroup.org/sites/default/files/docs/downloads/n221p.pdf)) | Composition means a thing consists of parts; aggregation combines related concepts. | Model primary + secondary as a composition of one storefront identity with service-line parts, while preserving the primary archetype as the identity source of truth. |
| DPF report-kit and platform usability standards | Status color semantics live in `statusColors.ts`; reporting UI composes report-kit and uses token-backed colors. | Any compatibility, health, or conflict status in the composition UI uses shared intents and visible icon/text labels. No local color maps. |

### 3.1 Shopify (multi-channel retail + services)

Shopify has evolved from a pure product-catalog platform to one that allows the same store to sell physical goods, digital downloads, subscriptions, and subscription/prepaid purchase options. Official selling-plan docs describe selling plans and selling plan groups as alternate ways products or variants can be sold ([Shopify docs](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/selling-plans)). There is no notion of a "second archetype"; the storefront shape is driven by products, variants, selling plans, and app extensions.

- **Adopted:** item-level CTA override is already present in DPF's `ItemTemplate.ctaType`. The Shopify model validates that vocabulary and portal identity should track the dominant (primary) model, not every item's type.
- **Rejected:** their approach to fusing radically different business models (product store + appointment booking + digital downloads) via a single flat catalog becomes confusing when the operating models genuinely differ — a pharmacy inside Walmart needs a different checkout flow, compliance posture, and portal vocabulary than the grocery aisles. Item-level CTA polymorphism is not enough when the *capability set* differs between service lines.

### 3.2 Mindbody (multi-modality wellness businesses)

Mindbody serves businesses that offer classes, appointments, retail, and memberships under one brand. Its public API endpoint catalog separates appointments, classes, clients, sales/products/packages, site/location/service-category resources, and staff ([Mindbody API endpoints](https://developers.mindbodyonline.com/Resources/Endpoints)). That is the useful pattern: different modalities share one business account and customer context while keeping modality-specific resources and rules.

- **Adopted:** the notion that a *service category* can carry its own CTA type, vocabulary, and capability surface is sound. In DPF's architecture this maps cleanly to a secondary archetype contributing its `itemTemplates`, `seededServiceCategories`, and `ArchetypeModule` list to the composition.
- **Adopted:** setup is primary-first — the business defines its dominant model first, then adds secondary service lines from a menu. This is more discoverable than asking "pick all archetypes upfront."
- **Rejected:** Mindbody's per-category vocabulary customization is granular to the label level. DPF's composition model resolves to primary-wins at the storefront level, with optional section-level overrides as a Phase 2 enhancement. The primary author's judgment: getting vocabulary right at the storefront level covers 95% of real-world conflicts.

### 3.3 Squarespace / Wix (multi-service small businesses)

Squarespace allows services, classes/workshops, appointments through Acuity Scheduling, member content, and physical products under one site ([Squarespace commerce overview](https://support.squarespace.com/hc/en-us/articles/206779077-Sell-on-Squarespace)). Its approach is closer to independent pages/tools linked by shared navigation than to a unified operating profile.

- **Adopted:** the insight that multiple service lines live under one portal with shared navigation is correct. In DPF terms, secondary archetypes contribute `sectionTemplates` (new portal sections) and `itemTemplates` (items seeded to those sections), not a separate storefront.
- **Rejected:** their block-independence model means there is no unified capability view, no consolidated customer record across service lines, and no merged playbook or WWWD context. DPF must present a unified operating profile (capability map, marketing playbook, WWWD corpus, business context) that spans all archetypes — blocks can't do this.

### 3.4 Patterns rejected across all references

- **"Service-line tagging" within one archetype** (Model C): viable only for same-category or single-CTA-type splits. Breaks down when capabilities differ materially between lines (a pharmacy has clinical compliance posture; the retail grocery does not). Vocabulary resolution at the item level is not surfaced as storefront identity. This model is a partial solution that creates internal inconsistency as the business grows.
- **Multiple storefronts per org** (Model B): `StorefrontConfig.organizationId` is `@unique` — a single org owns one storefront today. Removing this constraint requires a substantial schema change (org-level routing, brand-hub concept, cross-storefront customer graph), and is the right answer only for *genuinely separate brands* (USAA Insurance vs USAA Bank). For a bakery adding custom cake orders, it is vastly over-engineered. This model should be a separate epic for the multi-brand case.

---

## 4. Design Decision: Primary + Secondary Archetypes

**Recommended model: Primary + Secondary with same-category capability union shortcut**

One archetype is designated primary. It drives:
- Storefront identity (portal name, hero CTA type, vocabulary category)
- Setup wizard flow (runs entirely on the primary archetype, unchanged)
- `StorefrontConfig.archetypeId` (unchanged FK, always points to primary)
- Marketing playbook (primary category)
- WWWD corpus / `resolveBusinessProfile` base profile

Each secondary archetype contributes:
- Its `ArchetypeModule` list (unioned into the merged activation profile)
- Its `seededServiceCategories` (unioned)
- Its `itemTemplates` (seeded to `StorefrontItem` at the time the secondary is added)
- Its `sectionTemplates` (new sections appended to the storefront — operator can reorder/hide)
- Optionally its `vocabulary` leaf-level overrides for sections that clearly belong to the secondary operating model (Phase 2)

**Same-category shortcut:** when both archetypes share the same `category` (e.g., `new-home-builder` + `custom-home-builder` both in `real-estate-construction`, or `equipment-rental` + `self-storage` both in `asset-rental`):
- Vocabulary lookup is unchanged (same category key → same `VOCABULARY` entry)
- Marketing playbook is unchanged (same category key → same `CATEGORY_PLAYBOOKS` entry)
- `resolveVocabularyKey` is unchanged
- Only modules, service categories, and item templates union — the lightest-weight case

**Cross-category case** (personal trainer + retail-goods): primary archetype category drives all vocabulary and playbook lookups; secondary contributes capabilities and items. No vocabulary conflict at the storefront level — the primary is authoritative. Vocabulary conflict is a section-level concern resolved in Phase 2.

### 4.1 Enterprise / operations review corrections folded into this design

This spec is intentionally not a "many archetype ids on one row" design. It must satisfy three lenses:

| Lens | Requirement folded into the design |
|---|---|
| Enterprise architecture | `StorefrontConfig.archetypeId` remains the primary identity source of truth. Composition extends it with secondary service-line parts; it does not create parallel storefront identity, parallel business context, or a second capability model. |
| Operations | The operator sees one business with multiple service lines, each with current activity, capacity/demand cues, and conflicts. Adding a service line must explain what changes today, what becomes available, and what may need attention. |
| Archetype lens | Same-category combinations should feel lightweight. Cross-category combinations should remain possible but must surface vocabulary, capability, trust/compliance, and operating-axis differences clearly. |

### 4.2 Operational composition contract

The composed storefront needs a read model that can power both `/storefront` settings and the `/workspace` operating surface without teaching users the word "archetype":

```typescript
export type CompositionCompatibilityStatus =
  | "good"
  | "concern"
  | "acute"
  | "in-motion"
  | "unknown";

export interface StorefrontServiceLineView {
  compositionId: string;
  role: "primary" | "secondary";
  archetypeId: string;
  name: string;
  category: string;
  operatorLabel: string;
  visualPattern:
    | "standard-flow"
    | "slot-board"
    | "map-dispatch"
    | "asset-pool-board"
    | "stock-reorder-board"
    | "case-queue"
    | "trust-gate-board";
  status: CompositionCompatibilityStatus;
  statusLabel: string;
  statusIntent: "success" | "warning" | "danger" | "info" | "neutral" | "accent";
  statusIconName: string;
  contributedModules: ArchetypeModule[];
  contributedServiceCategories: string[];
  contributedItemCount: number;
  contributedSectionCount: number;
  warnings: string[];
}

export interface StorefrontCompositionView {
  storefrontId: string;
  primary: StorefrontServiceLineView;
  secondaries: StorefrontServiceLineView[];
  compatibilitySummary: {
    status: CompositionCompatibilityStatus;
    label: string;
    reasons: string[];
  };
}
```

Rules:

- This is a projection over `StorefrontArchetypeComposition`, `StorefrontConfig.archetype`, template metadata, and existing seeded items/sections. It is not a new source of truth.
- `operatorLabel` uses business language: "Custom cake orders", "Equipment rentals", "Supplements shop", "Pharmacy counter", not "secondary archetype".
- `visualPattern` is selected from operating context and can later feed the value-stream visual layer: map dispatch for field work, slot board for appointment capacity, asset pool for rentals, stock/reorder for goods, case queue for professional/care/MSP services, trust-gate for regulated/public lines.
- The first viewport should show the primary business model plus secondary service lines as a compact chain or lane group. It should not look like an architecture diagram or ask the operator to compare raw archetype slugs.

### 4.3 Compatibility and status semantics

Composition status uses the same operational status language as the value-stream workspace:

| Status | Meaning | Report-kit intent | Examples |
|---|---|---|---|
| `good` | Same category or low-conflict addition; safe to add with normal confirmation. | `success` | Bakery + custom cakes, salon + retail product shelf. |
| `concern` | Cross-category addition with vocabulary, capability, staffing, data, or customer-experience differences that the operator should review. | `warning` | Personal trainer + supplements; landscaper + snow removal if seasons/capacity conflict. |
| `acute` | Addition should be blocked until an explicit model exists because trust/compliance, customer identity, regulated workflow, or brand separation would be misleading. | `danger` | Bank + clinic; public-sector service + unrelated commercial storefront without governance decision. |
| `in-motion` | Add/remove operation is being applied or seeded. | `info` or `accent` | Sections seeding, items being hidden, capability profile recalculating. |
| `unknown` | Compatibility cannot be assessed because template metadata or composition rows are incomplete. | `neutral` | Custom archetype with missing activation profile. |

Implementation rules:

- Add `compositionCompatibility` or `operationalStatus` to `apps/web/components/ui/report-kit/statusColors.ts` if existing `readiness` / `severity` domains do not exactly fit. Do not define a page-local color map.
- Every status must render with icon + label + accessible name. Color alone is never the signal.
- `unknown` is not green. Missing metadata must be neutral and explain the missing source.
- `acute` is a UX block on the add-line action in Phase 2, not a database impossibility. The database stays additive; the operator workflow owns the guardrail.

### 4.4 Archetype composition examples through operator lenses

| Scenario | Model result | Operator-facing view | Main concern |
|---|---|---|---|
| Home builder: production communities + custom homes | Same-category composition; primary drives identity, custom line adds projects module and section/items. | "Production homes" plus "Custom build projects" as two service lines under one construction business. | Demand/capacity separation, not vocabulary. |
| Bakery + custom cakes | Primary bakery; secondary project/order line contributes inquiry/project capability and custom order section. | Retail goods board plus custom-order queue. | Keep bread/retail checkout separate from consult/design workflow. |
| Salon + booth rental + retail shelf | Primary appointment business; secondary retail goods and/or space rental line contributes inventory/asset cues. | Chair/slot board with small retail and booth/space occupancy side lanes. | Avoid making retail products look like appointment services. |
| Field service + supplies reorder | Primary trades/field service; secondary goods/supplies line contributes stock/reorder cues. | Dispatch map/schedule with supply markers and reorder warnings. | Stock line supports delivery; it should not become a separate storefront identity. |
| Self-storage + equipment rental | Same asset-rental category; line-specific asset pool boards. | Storage units and equipment classes as separate asset pools. | Return/inspection and agreement lifecycle differences. |
| Bank + insurance | Likely multi-brand or regulated multi-line; composition may be `concern` or `acute` depending on governance and customer identity. | Do not present as "just another service line" until trust model is clear. | Compliance, identity, disclosure, and brand separation. |

### 4.5 Why not Model B (multiple storefronts per org)?

`organizationId @unique` on `StorefrontConfig` means a full schema rewrite. More importantly, the multi-storefront model puts the customer graph, capability map, marketing playbook, and WWWD corpus in the wrong place — there is no unified org-level view. The primary+secondary model gives one coherent operating profile across all service lines, which is what a small business with two service lines actually needs. Multi-brand (USAA, Walmart) belongs in a separate epic.

### 4.6 Why not Model C (service-line tagging)?

A `serviceLineTag` on `StorefrontItem` tells the portal which section an item belongs to. It does not change the capability set, the compliance posture, the seeded service categories, or the WWWD context. A bakery's "custom cakes" line needs a different inquiry form and a `projects` module that the `bakery` archetype does not activate. Service-line tagging cannot express this without becoming a hidden archetype inside a tag. The primary+secondary model names the thing correctly.

---

## 5. Non-Goals

- Multi-brand / multiple storefronts per org (the USAA or Walmart multi-brand case) — separate epic
- Secondary archetype selection before primary setup is complete — wizard is primary-only
- Vocabulary conflict resolution at the section level (Phase 2)
- Custom archetype creation for secondaries (that is EP-ARCH-8D4F2A's existing custom archetype work)
- Changing how `StorefrontConfig.archetypeId` is used — it stays as the primary FK

---

## 6. Schema Delta

### 6.1 New model: `StorefrontArchetypeComposition`

```prisma
model StorefrontArchetypeComposition {
  id           String   @id @default(cuid())
  storefrontId String
  archetypeId  String   // references StorefrontArchetype.id (not archetypeId slug)
  role         String   // "primary" | "secondary"
  sortOrder    Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  storefront   StorefrontConfig    @relation(fields: [storefrontId], references: [id], onDelete: Cascade)
  archetype    StorefrontArchetype @relation(fields: [archetypeId], references: [id])

  @@unique([storefrontId, archetypeId])
  @@index([storefrontId, role])
}
```

Back-references to add:

```prisma
// on StorefrontConfig:
archetypeCompositions StorefrontArchetypeComposition[]

// on StorefrontArchetype:
compositionSlots      StorefrontArchetypeComposition[]
```

`StorefrontConfig.archetypeId` remains required, unchanged — no migration touch needed for existing storefront rows.

Closed values:

- `role`: `"primary" | "secondary"`

Invariants:

- Every storefront has exactly one primary composition row.
- The primary composition row's `archetypeId` must equal `StorefrontConfig.archetypeId`.
- A storefront may have 0..N secondary rows, with v1 enforcing the maximum in application validation.
- These invariants are enforced in the setup/add/remove server actions and covered by tests. Prisma cannot express "one primary plus many secondaries" as a simple unique constraint without blocking secondaries.

### 6.2 Migration

```sql
-- migration: add StorefrontArchetypeComposition table
-- (Prisma generates the DDL; this is the backfill inline per AGENTS.md doctrine)

-- Backfill: every existing StorefrontConfig becomes a primary composition row
INSERT INTO "StorefrontArchetypeComposition" (id, "storefrontId", "archetypeId", role, "sortOrder", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  sc.id,
  sc."archetypeId",
  'primary',
  0,
  NOW(),
  NOW()
FROM "StorefrontConfig" sc
ON CONFLICT ("storefrontId", "archetypeId") DO NOTHING;
```

Migration name: `add_storefront_archetype_composition`

No existing query paths change — `StorefrontConfig.archetypeId` is still the authoritative primary FK read by all current consumers.

### 6.3 What does NOT change in Phase 1

- `StorefrontConfig.archetypeId` — required FK, unchanged
- `StorefrontArchetype` model — no changes
- `StorefrontItem`, `StorefrontSection`, `StorefrontBooking`, all other storefront relations — no changes in Phase 1
- Any existing migration — immutable per AGENTS.md

### 6.4 Phase 2 provenance schema for add/remove service line

Phase 2 cannot safely remove or hide a secondary service line using only an item `serviceLineTag` string. The action needs provenance on both items and sections created from a secondary composition. Before the visible "Add service line" / "Remove service line" UI ships, add provenance fields:

```prisma
// on StorefrontItem:
sourceCompositionId String?
sourceComposition   StorefrontArchetypeComposition? @relation(fields: [sourceCompositionId], references: [id], onDelete: SetNull)

// on StorefrontSection:
sourceCompositionId String?
sourceComposition   StorefrontArchetypeComposition? @relation(fields: [sourceCompositionId], references: [id], onDelete: SetNull)
```

Back-references:

```prisma
// on StorefrontArchetypeComposition:
seededItems    StorefrontItem[]
seededSections StorefrontSection[]
```

Rules:

- Primary setup may leave `sourceCompositionId` null for existing records; Phase 2 only needs reliable provenance for records seeded by secondary add-line actions.
- Removing a secondary sets its seeded items inactive and hides its seeded sections before marking the composition inactive or deleting it. If the row is deleted, `onDelete: SetNull` preserves historical storefront rows without breaking referential integrity.
- Do not use a free-text `serviceLineTag` as the cleanup key. A slug can still be displayed, but cleanup must key from `sourceCompositionId`.

---

## 7. Vocabulary Resolution Rules

**Rule:** primary archetype category + its `customVocabulary` (as seeded into `StorefrontArchetype.customVocabulary`) continues to be the sole input to `getVocabulary()`. No signature change.

**Why this is correct:** the storefront presents one coherent identity to the customer. If the primary model is `fitness-recreation`, the portal says "Members", "Classes & Memberships", "Instructors" everywhere — even if there is a secondary `retail-goods` line for supplements. The retail line's items appear in their own section but use the same vocabulary context. Vocabulary collision at the section level (e.g., wanting "Products" in the supplements section while keeping "Classes" everywhere else) is a Phase 2 enhancement using `StorefrontSection.vocabularyOverrides: Json?`.

**Conflict examples and resolution:**

| Primary (wins) | Secondary | Conflict field | Resolution |
|---|---|---|---|
| `fitness-recreation` → "Members" | `retail-goods` → "Customers" | `stakeholderLabel` | "Members" wins — primary |
| `real-estate-construction` → "Home Buyers" | `real-estate-construction` → "Clients" (custom leaf) | `stakeholderLabel` | Same category — primary leaf `customVocabulary` wins |
| `professional-services` → "Clients" | `retail-goods` → "Customers" | `stakeholderLabel` | "Clients" wins — primary |
| `banking-financial-services` → "Banking Portal" | `healthcare-wellness` → "Patient Portal" | `portalLabel` | "Banking Portal" wins — primary |

**`resolveVocabularyKey` change:** none. Its signature and behaviour are unchanged.

---

## 8. Capability Union Logic

### 8.1 New pure function: `mergeActivationProfiles`

```typescript
// packages/storefront-templates/src/composition.ts (new file)

import type { ActivationProfile, ArchetypeModule } from "./types";

/**
 * Merge a sequence of activation profiles (primary first) into one composite
 * profile. Primary drives all scalar fields; secondaries contribute their
 * modules and seeded catalogue entries additively.
 *
 * Pure — no Prisma, no side effects. The consumer (setup seed, admin add-line
 * action) calls this and then writes the result as the effective profile.
 */
export function mergeActivationProfiles(
  profiles: ActivationProfile[],
): ActivationProfile {
  if (profiles.length === 0) throw new Error("mergeActivationProfiles: empty");
  const [primary, ...secondaries] = profiles;
  if (secondaries.length === 0) return primary;

  const allModules = Array.from(
    new Set<ArchetypeModule>([
      ...primary.modules,
      ...secondaries.flatMap((s) => s.modules),
    ]),
  );

  const allServiceCategories = Array.from(
    new Set([
      ...(primary.seededServiceCategories ?? []),
      ...secondaries.flatMap((s) => s.seededServiceCategories ?? []),
    ]),
  );

  const mergeByKey = <T extends { key: string }>(values: T[]): T[] => {
    const byKey = new Map<string, T>();
    for (const value of values) {
      if (!byKey.has(value.key)) byKey.set(value.key, value);
    }
    return Array.from(byKey.values());
  };

  // capabilityOverrides: primary wins on any conflicting capabilityKey.
  const secondaryOverrides = secondaries.flatMap((s) => s.capabilityOverrides ?? []);
  const primaryKeys = new Set((primary.capabilityOverrides ?? []).map((o) => o.capabilityKey));
  const mergedOverrides = [
    ...(primary.capabilityOverrides ?? []),
    ...secondaryOverrides.filter((o) => !primaryKeys.has(o.capabilityKey)),
  ];

  return {
    ...primary,
    modules: allModules,
    billingReadinessMode: profiles.some((p) => p.billingReadinessMode === "prepared-not-prescribed")
      ? "prepared-not-prescribed"
      : primary.billingReadinessMode,
    customerGraph: profiles.some((p) => p.customerGraph === "separate-customer-projection")
      ? "separate-customer-projection"
      : primary.customerGraph,
    estateSeparation: profiles.some((p) => p.estateSeparation === "strict")
      ? "strict"
      : primary.estateSeparation,
    seededServiceCategories: allServiceCategories,
    seededConfigurationItemTypes: mergeByKey([
      ...(primary.seededConfigurationItemTypes ?? []),
      ...secondaries.flatMap((s) => s.seededConfigurationItemTypes ?? []),
    ]),
    seededBillingUnitTypes: mergeByKey([
      ...(primary.seededBillingUnitTypes ?? []),
      ...secondaries.flatMap((s) => s.seededBillingUnitTypes ?? []),
    ]),
    seededChargeModels: mergeByKey([
      ...(primary.seededChargeModels ?? []),
      ...secondaries.flatMap((s) => s.seededChargeModels ?? []),
    ]),
    capabilityOverrides: mergedOverrides.length > 0 ? mergedOverrides : undefined,
  };
}
```

### 8.2 ActivationProfile scalar fields — primary wins

| Field | Resolution |
|---|---|
| `profileType` | Primary wins |
| `billingReadinessMode` | Monotonic union: if any profile is `prepared-not-prescribed`, composite is `prepared-not-prescribed`. A secondary should not lose billing-readiness obligations just because it is not the primary. |
| `customerGraph` | Monotonic union: if any profile requires `separate-customer-projection`, composite uses it. |
| `estateSeparation` | Monotonic union: if any profile is `strict`, composite is `strict`. |
| `axes` | Primary wins as the dominant operating model, but axis differences are emitted into the `StorefrontCompositionView.compatibilitySummary.reasons` so the UI can show concern/acute warnings. |
| `portfolios` | Primary wins; secondary `seededServiceCategories` surface in the `manufactureAndDeliver` portfolio at setup |
| `billingProfile` | Primary wins |
| `seededConfigurationItemTypes` | Union (deduplicated by `key`) |
| `seededBillingUnitTypes` | Union (deduplicated by `key`) |
| `seededChargeModels` | Union (deduplicated by `key`) |
| `modules` | Union |
| `seededServiceCategories` | Union |
| `capabilityOverrides` | Union, primary wins on conflict |

### 8.3 Secondary capability escalation rule

If a secondary archetype contributes a capability override with `applicability: "required"` for a capability that the primary marks `"not-applicable"`, the composite profile keeps that capability required for the service line and records the source as the secondary composition. The primary business model does not suddenly depend on that capability, but the enabled service line does.

If the platform cannot currently support that capability, the add-line workflow shows `concern` or `acute` before confirmation:

- `concern`: capability exists but may require setup, data, or staffing.
- `acute`: capability is absent or unsafe for the combination; the add action is blocked until a supporting design exists.

Do not downgrade a secondary's required capability to `recommended` merely to preserve the primary's simpler shape. That hides real operating obligations.

---

## 9. Setup Wizard UX Flow

**Principle:** setup wizard is unchanged for single-archetype installs. Multi-archetype setup is additive, not a wizard replacement.

### 9.1 Primary setup (unchanged)

1. Operator picks one archetype → setup wizard runs exactly as today
2. Items, sections, vocabulary, WWWD corpus, capability profile all seeded from primary
3. A `StorefrontArchetypeComposition` row is written with `role=primary` as a side-effect of setup completion (via the existing setup seed code)

### 9.2 Adding a secondary (new admin action)

Post-setup, in `/storefront` settings (`/admin/storefront` remains only a legacy redirect):

1. **"Add service line" button** — visible once setup is complete
2. Operator selects a secondary archetype from a filtered picker
   - Same-category archetypes appear first (no capability conflicts)
   - Cross-category archetypes are available but flagged "adds [X] capability"
   - Already-selected archetypes are greyed out
3. Confirmation shows: "This will add [N] new service categories, [M] new section templates, and enable [X] additional capabilities"
4. On confirm:
   - Write `StorefrontArchetypeComposition` row with `role=secondary`
   - Seed secondary's `itemTemplates` to `StorefrontItem` with `sourceCompositionId` pointing to the composition row
   - Append secondary's `sectionTemplates` to the end of the portal's section list with `sourceCompositionId` pointing to the composition row (hidden by default; operator reveals them)
   - Merge the activation profiles and persist the merged capability set via `mergeActivationProfiles`
   - No re-running of setup wizard; no vocabulary change

### 9.3 Removing a secondary

A secondary can be removed from the same admin panel. Items seeded by that secondary are soft-deleted (marked inactive). Sections added by that secondary are hidden. The cleanup key is `sourceCompositionId`, not label/category matching. The `StorefrontArchetypeComposition` row may then be marked inactive or deleted; if deleted, related item/section provenance uses `onDelete: SetNull`.

### 9.4 UI considerations

- The setup wizard entry point asks "What best describes your business?" — still single-select, still picks the primary
- After setup, the settings page shows "Your business model: [Primary Service Line] + [Secondary Service Line]" as a badge/lane chain using operator labels, not raw archetype slugs
- Each service-line marker uses the shared compatibility/status semantics: icon + label + report-kit intent, never color alone
- Same-category suggestions are visually grouped as the easiest additions; cross-category suggestions show the concrete capability or operational difference before the operator confirms
- Maximum 3 archetypes (primary + 2 secondaries) enforced in v1; 3+ are rare and the UX complexity of presenting more is not yet designed

---

## 10. Function Changes

### 10.1 `resolveBusinessProfile` — extend, backwards compatible

```typescript
// apps/web/lib/onboarding/archetype-business-context.ts

export function resolveBusinessProfile(input: {
  archetypeId?: string | null;
  industry?: string | null;
  // New optional fields — ignored if absent, full backwards compat:
  secondaryArchetypeIds?: string[];
  secondaryIndustries?: string[];
}): ArchetypeBusinessProfile {
  // Existing resolution for primary (unchanged):
  const base: ArchetypeBusinessProfile =
    (input.industry ? INDUSTRY_PROFILES[input.industry] : undefined) ?? GENERIC_BUSINESS_PROFILE;
  const override = input.archetypeId ? ARCHETYPE_PROFILES[input.archetypeId] : undefined;
  const primary = override ? { ...base, ...override } : base;

  // New: secondary enrichment if provided:
  if (!input.secondaryArchetypeIds?.length && !input.secondaryIndustries?.length) {
    return primary;
  }

  // Blend secondary whoWeServe and supplyChain into the primary profile.
  // Primary missionTheme, businessModel, howWeDecide are unchanged —
  // those describe the dominant operating model.
  const secondaryProfiles = [
    ...(input.secondaryArchetypeIds ?? []).map((id) => ARCHETYPE_PROFILES[id]).filter(Boolean),
    ...(input.secondaryIndustries ?? [])
      .map((ind) => INDUSTRY_PROFILES[ind])
      .filter(Boolean),
  ] as Partial<ArchetypeBusinessProfile>[];

  if (secondaryProfiles.length === 0) return primary;

  // Append secondary whoWeServe context (as a second paragraph):
  const secondaryWhoWeServe = secondaryProfiles
    .map((p) => p.whoWeServe)
    .filter(Boolean)
    .join(" ");

  // Append secondary supplyChain context:
  const secondarySupplyChain = secondaryProfiles
    .map((p) => p.supplyChain)
    .filter(Boolean)
    .join(" ");

  return {
    ...primary,
    whoWeServe: secondaryWhoWeServe
      ? `${primary.whoWeServe}\n\n${secondaryWhoWeServe}`
      : primary.whoWeServe,
    supplyChain: secondarySupplyChain
      ? `${primary.supplyChain}\n\n${secondarySupplyChain}`
      : primary.supplyChain,
  };
}
```

### 10.2 `getVocabulary` — no change

Signature and behaviour unchanged. Callers pass the primary archetype's category and its `customVocabulary`.

### 10.3 `getPlaybook` — no change for Phase 1

Signature and behaviour unchanged. Primary category drives the playbook. Phase 2 enhancement: a `getCompositePlaybook(primaryCategory, secondaryCategories[])` helper that blends `campaignTypes` and `agentSkills` from secondaries as supplemental context.

### 10.4 `resolveCapabilityActivation` pipeline — unchanged consumers, new input

`readActivationProfile` reads `StorefrontArchetype.activationProfile` from the DB. Callers today pass the activation profile of the single primary archetype. After multi-archetype composition is enabled, the server action that resolves the activation profile should:

```typescript
// apps/web/lib/storefront/archetype-activation.ts (new helper)

import { mergeActivationProfiles } from "@dpf/storefront-templates";

/**
 * Load and merge activation profiles for a storefront's full archetype
 * composition (primary + any secondaries). Single-archetype storefronts
 * return the primary profile unchanged — no behaviour difference.
 */
export async function getCompositeActivationProfile(
  storefrontId: string,
): Promise<ActivationProfile | null> {
  const compositions = await prisma.storefrontArchetypeComposition.findMany({
    where: { storefrontId },
    orderBy: [{ sortOrder: "asc" }],
    include: { archetype: true },
  });

  if (compositions.length === 0) return null;

  const ordered = [
    ...compositions.filter((c) => c.role === "primary"),
    ...compositions.filter((c) => c.role === "secondary"),
  ];

  const profiles = ordered
    .map((c) => c.archetype.activationProfile)
    .filter(Boolean) as ActivationProfile[];

  return mergeActivationProfiles(profiles);
}
```

The downstream `getEffectiveCapabilityActivations(organizationId, derived)` receives the merged profile's derived applicabilities and folds the org's stored choices over them — **no change to this function**. Tests must assert that the helper explicitly orders primary before secondaries and rejects or logs a malformed composition with zero or multiple primaries.

### 10.5 `resolveVocabularyKey` — no change

Returns `archetypeCategory || industry || null`. Primary category is the input. No change.

### 10.6 `getVocabularyForStorefront` — new server helper (Phase 1)

```typescript
// apps/web/lib/storefront/archetype-vocabulary.ts (new export)

/**
 * Server-side helper: resolve vocabulary for a storefront from its primary
 * archetype. Identical to calling getVocabulary(category, customVocabulary)
 * today — exists as a named entry point so future multi-archetype section
 * overrides (Phase 2) can be injected here without touching all callers.
 */
export function getVocabularyForStorefront(
  primaryCategory: string | null | undefined,
  primaryCustomVocabulary: Record<string, string> | null | undefined,
): ArchetypeVocabulary {
  return getVocabulary(primaryCategory, primaryCustomVocabulary);
}
```

### 10.7 `deriveStorefrontCompositionView` — new pure helper

```typescript
// apps/web/lib/storefront/composition-view.ts

export function deriveStorefrontCompositionView(input: {
  storefrontId: string;
  primary: StorefrontCompositionTemplateRef;
  secondaries: StorefrontCompositionTemplateRef[];
  seededCountsByCompositionId?: Record<string, { items: number; sections: number }>;
}): StorefrontCompositionView {
  // Pure projection only. No Prisma import.
}
```

Responsibilities:

- Select the operator label and visual pattern for each service line.
- Resolve same-category, cross-category, axis, vocabulary, trust/compliance, and missing-template concerns into `compatibilitySummary`.
- Resolve status intents through report-kit status semantics (`compositionCompatibility` or `operationalStatus`), not a local map.
- Return `unknown` when template metadata is missing instead of fabricating a healthy state.
- Feed both `/storefront` settings and future `/workspace` operating surfaces.

---

## 11. Seeding Changes

### 11.1 `seedStorefrontArchetypes` — no change

The seeder operates on `StorefrontArchetype` rows only. Composition rows are written at setup/admin time, not at seed time.

### 11.2 Setup seed side-effect (new)

The existing setup completion action is `apps/web/app/api/storefront/admin/setup/route.ts` (`POST`). It creates `StorefrontConfig` and nested `StorefrontSection` / `StorefrontItem` rows from the primary archetype. It should additionally write a `StorefrontArchetypeComposition` row for the primary in the same setup transaction/success path:

```typescript
await prisma.storefrontArchetypeComposition.upsert({
  where: { storefrontId_archetypeId: { storefrontId, archetypeId: archetype.id } },
  create: { storefrontId, archetypeId: archetype.id, role: "primary", sortOrder: 0 },
  update: {},
});
```

This is a pure append — no existing seeding behaviour changes.

### 11.3 `customVocabulary` — no change

Secondary archetypes' `customVocabulary` is not merged into the primary's. Each leaf's vocabulary override applies only when that leaf is the primary.

---

## 12. Category-Level Shortcut Analysis

For businesses where the composition stays within one archetype category, the shortcut is:

| Category | Example combination | Vocabulary change? | Playbook change? | Module union needed? |
|---|---|---|---|---|
| `real-estate-construction` | `new-home-builder` + `custom-home-builder` | No — same category key | No — same playbook key | Yes (`projects` in custom-home-builder vs `billing-readiness` only in new-home-builder) |
| `asset-rental` | `equipment-rental` + `self-storage` | No — same category key; both use `customVocabulary` leaf overrides | No — same playbook key | Yes (self-storage uses `rental-fleet` + `rental-agreements`; equipment-rental same) |
| `trades-maintenance` | `landscaping` + `snow-removal` | No — same category key | No | Likely no — same modules; just different items |
| `professional-services` | `accounting` + `consulting` | No — same category key | No | Likely no |

**Conclusion:** the same-category shortcut means vocabulary and playbook resolution is a no-op. The only work at composition time is the module union (`mergeActivationProfiles`) and the item/section seed from the secondary. This is the zero-ceremony case and should be the nudge the UX gives when a business identifies two same-category archetypes.

---

## 13. Edge Cases and Constraints

### 13.1 Existing single-archetype installs

`StorefrontConfig.archetypeId` is unchanged. All existing resolution paths (`getVocabulary`, `getPlaybook`, `resolveBusinessProfile`, `readActivationProfile`) read the primary archetype and behave identically. The new `StorefrontArchetypeComposition` table is additive. Installs that never use the "Add service line" feature are completely unaffected.

### 13.2 Maximum archetypes per storefront

v1 enforces a maximum of 3 (primary + 2 secondaries) at the admin UI layer. This is a soft limit implemented as a validation rule, not a DB constraint, so it can be raised without a migration.

### 13.3 Archetype compatibility validation

Not all combinations are sensible. Phase 1 does not enforce this — the operator is trusted to make a reasonable business-model choice. Phase 2 could introduce a `compatibleWith: string[]` field on `ArchetypeDefinition` to surface warnings in the picker (e.g., a `nonprofit-community` archetype warning when combined with `banking-financial-services`).

### 13.4 `resolveCapabilityActivation` — conflicting `axes`

The composition model merges activation profiles and primary's `axes` win. Two archetypes with radically different `axes` (e.g., `commercialModel: "transactional"` vs `commercialModel: "recurring-agreement"`) may produce a merged profile that describes neither well. Phase 1 accepts this and documents it as a known gap — the operator's WWWD corpus and custom capability choices govern the runtime. Phase 2 introduces axis-conflict detection and surfacing in the admin UI.

### 13.5 `StorefrontArchetypeComposition` and the backfill

The backfill SQL is inline in the migration per AGENTS.md doctrine. If the migration is run against a DB with 0 `StorefrontConfig` rows (fresh install), the backfill is a no-op — composition rows are written by the setup seed path instead. No data loss either way.

### 13.6 Schema.prisma `BusinessContext.archetypeId`

`BusinessContext.archetypeId` (deprecated, per `@deprecated` annotation in schema) is a read of `StorefrontConfig.archetypeId`. It remains unchanged — the primary archetype is the correct source for backward compat reads.

---

## 14. Implementation Plan

**Total scope estimate:** medium (3 phases, each independently shippable)

### Phase 1 — Schema + Pure Logic (low risk, no UX change)

1. Write Prisma migration: `add_storefront_archetype_composition` (schema + backfill SQL inline)
2. Write `packages/storefront-templates/src/composition.ts` with `mergeActivationProfiles`
3. Export from `@dpf/storefront-templates` package index
4. Write `getCompositeActivationProfile` helper in `apps/web/lib/storefront/archetype-activation.ts`
5. Add `getVocabularyForStorefront` helper export to `archetype-vocabulary.ts`
6. Write `deriveStorefrontCompositionView` pure helper in `apps/web/lib/storefront/composition-view.ts`
7. Update setup completion action to write the primary `StorefrontArchetypeComposition` row
8. Tests:
   - `mergeActivationProfiles`: module union, keyed seed union, monotonic readiness/customerGraph/estateSeparation, secondary required capability preservation, same-profile passthrough
   - composition invariants: exactly one primary; primary composition matches `StorefrontConfig.archetypeId`
   - `deriveStorefrontCompositionView`: same-category `good`, cross-category `concern`, missing metadata `unknown`, high-risk trust/compliance mismatch `acute`
9. Gate: `pnpm --filter @dpf/storefront-templates exec vitest run` + targeted web tests + `pnpm --filter web typecheck`

**Blocking design decision before Phase 1 starts:** none — Phase 1 is pure schema + pure functions, no UI change.

### Phase 2 — Admin UX: "Add service line" (medium risk, visible to operator)

1. Add Phase 2 provenance migration: `StorefrontItem.sourceCompositionId`, `StorefrontSection.sourceCompositionId`, and back-relations to `StorefrontArchetypeComposition`
2. Extend `statusColors.ts` with `compositionCompatibility` or `operationalStatus` if existing domains do not exactly cover good/concern/acute/in-motion/unknown
3. New server action: `addStorefrontServiceLine(storefrontId, archetypeId)` — validates compatibility, writes composition row, seeds items and sections with `sourceCompositionId`, merges and persists activation profile
4. New server action: `removeStorefrontServiceLine(storefrontId, archetypeId)` — uses `sourceCompositionId` to soft-delete items and hide sections, then marks/deletes the composition row
5. `/storefront` settings UI: "Active service lines" section with add/remove controls, filtered archetype picker, visual pattern/iconography, and compatibility statuses
6. Extend `resolveBusinessProfile` with optional secondary fields (per section 10.1)
7. Gate: production build + UX verification path (settings page -> add secondary -> verify items appear in items manager -> remove secondary -> verify only that line's items/sections are hidden)

**Blocking design decision before Phase 2 starts:** decide whether secondary composition rows are soft-inactivated or deleted after remove-line cleanup. Deletion is simpler, but soft-inactivation preserves service-line history for support/audit.

### Phase 3 — Resolution Enrichment (low risk, data quality improvement)

1. `getCompositePlaybook` helper for multi-category playbook blending
2. Section-level vocabulary overrides: `StorefrontSection.vocabularyOverrides: Json?` schema addition
3. Archetype compatibility hints in the picker (`compatibleWith` field on `ArchetypeDefinition`)
4. Axis-conflict detection and admin warning surface

**Phase 3 is advisory** — the platform works correctly without it. Schedule when operator feedback identifies a real vocabulary or playbook conflict.

---

## 15. Open Questions (block Phase 2, not Phase 1)

1. **Remove-line lifecycle:** should removing a secondary soft-inactivate the `StorefrontArchetypeComposition` row or delete it after cleanup? The spec leans soft-inactive for support/audit, but Phase 2 must decide before migration.
2. **Acute compatibility thresholds:** which cross-category combinations are true blocks rather than warnings? The first implementation should hard-code only obvious trust/compliance/identity blocks and route the rest to `concern`.
3. **3-archetype UX:** the "max 3" limit is an arbitrary v1 choice. The spec author recommends revisiting after seeing real operator composition patterns — a landscaper with snow removal, pressure washing, and irrigation might plausibly want all three. The limit should be configurable, not hard-coded.

---

## 16. Acceptance Criteria

- Existing single-archetype installs behave exactly as before. `StorefrontConfig.archetypeId` remains the primary archetype source of truth.
- Every storefront has exactly one primary composition row, and it matches `StorefrontConfig.archetypeId`.
- Phase 1 adds the composition table, backfill, pure merge logic, composite activation helper, and composition view helper without changing visible setup UX.
- `mergeActivationProfiles` unions modules and keyed seed arrays, preserves secondary required capabilities, and uses monotonic readiness/customerGraph/estateSeparation rules.
- `/storefront` can display service lines in operator language with icon + label + status semantics. It does not expose raw archetype mechanics as the main mental model.
- Good/concern/acute/in-motion/unknown composition statuses use report-kit `STATUS_INTENT` and token-backed styles. No local color maps or color-only markers.
- Phase 2 add/remove service-line actions use `sourceCompositionId` provenance on seeded items and sections. Cleanup does not rely on labels, categories, or free-text tags.
- Same-category compositions are easy and low-ceremony. Cross-category compositions remain possible but surface the concrete capability, vocabulary, operational, or trust/compliance differences before confirmation.
- Missing metadata renders as `unknown`, not `good`.
- UX verification covers at least: same-category construction, bakery + custom orders, salon/appointment + retail or rental, asset-rental pair, and one high-risk regulated cross-category example.

## 17. Risks

| Risk | Mitigation |
|---|---|
| The spec becomes a hidden multi-storefront rewrite. | Keep `StorefrontConfig.organizationId @unique` and `StorefrontConfig.archetypeId` unchanged; composition is service-line parts under one storefront. |
| Primary identity hides secondary obligations. | Use monotonic merge rules for readiness/customer graph/estate separation and preserve secondary required capabilities. |
| Remove-secondary cleanup hides the wrong records. | Add `sourceCompositionId` provenance to items and sections before Phase 2 UI ships. |
| Non-technical operators see architecture terms instead of business lines. | Render operator labels, visual patterns, icons, and concise status labels; raw archetype ids remain admin/test details. |
| Cross-category combinations become unsafe. | Compatibility view emits `concern`/`acute`; obvious trust/compliance/identity blocks prevent confirmation in Phase 2. |
| UI grows a one-off status/color system. | Use report-kit `STATUS_INTENT`, `StatusBadge`, and token-backed primitives only. |
| The max-3 rule becomes hidden product policy. | Keep the limit as configurable validation and revisit with real operator composition data. |
| Backlog context is mistaken for live truth. | Re-run MCP backlog lookup, or explicit live DB fallback, before promotion. |

---

## 18. Summary

| Question | Answer |
|---|---|
| Which model handles bakery without over-engineering? | Primary + secondary. Bakery with standard goods (primary: `bakery`/`food-hospitality`) + custom orders adds inquiry-typed items from a secondary archetype, contributes `projects` module, no wizard re-run needed. |
| Vocabulary conflict: "Customers" vs "Clients"? | Primary wins at storefront level. Section-level override is Phase 2. In practice, same-category compositions never conflict; cross-category conflicts surface the primary's label everywhere. |
| Minimum schema change? | Phase 1: one new join table (`StorefrontArchetypeComposition`) + inline backfill SQL. Phase 2: provenance fields on `StorefrontItem` and `StorefrontSection` before visible add/remove service-line UX. `StorefrontConfig.archetypeId` unchanged. |
| Setup wizard: pick-all-upfront or primary-first? | Primary-first. Secondary is added post-setup via "Add service line" admin action. |
| What happens to `resolveBusinessProfile`, `getVocabulary`, `getPlaybook`, `resolveCapabilityActivation`? | `getVocabulary`, `getPlaybook`, `resolveVocabularyKey`: no change. `resolveBusinessProfile`: extends with optional secondary fields, backwards compat. `resolveCapabilityActivation` pipeline: unchanged consumers, new `getCompositeActivationProfile` server helper feeds the merged profile as input. |
| Seeding / `customVocabulary` for multi-archetype? | Secondary archetype's `itemTemplates` and `sectionTemplates` are seeded at add-line time with composition provenance. `customVocabulary` applies only when that leaf is primary; secondary vocabulary is not merged at storefront level (Phase 2 section-level overrides address this). |
| Same-category shortcut? | Yes. `asset-rental + self-storage`, `new-home-builder + custom-home-builder` — vocabulary and playbook unchanged; only module union and item/section seed happen. Zero-ceremony case. |
