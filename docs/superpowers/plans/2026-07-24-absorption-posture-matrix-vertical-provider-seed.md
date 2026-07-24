# Plan — Absorption Posture Matrix + vertical provider seed (BI-ECO-001)

**Backlog item:** BI-ECO-001

| Field | Value |
|-------|-------|
| **Date** | 2026-07-24 |
| **Backlog item** | BI-ECO-001 (Ecosystem Absorption Architecture, `EP-ECOSYSTEM-ABSORPTION-ARCH`, open, priority 1) |
| **Design source** | `docs/superpowers/specs/2026-07-24-vertical-backlog-investment-architecture-design.md` §6 (the connector surface + ~100-provider inventory); `docs/superpowers/specs/2026-07-23-incumbent-application-coverage-design.md` §5.2/§5.4 (the verdict vocabulary + the posture-matrix matching stage) |
| **Kernel decision** | `DI-A80D7C589EEB` — shared-spine, config-driven (the absorption matrix is the shared classification the per-vertical and per-customer surfaces both consume) |
| **Status** | Draft for founder review / Build Studio intake. Non-gated: does not depend on the §11 sequencing questions. |

## 1. Why this, why now

BI-ECO-001 asks for a vendor ecosystem absorption matrix. The 2026-07-24 vertical-backlog analysis made it concrete and higher-value than first scoped: the 19 `EP-VERTICAL-*` integration/boundary-map BIs name **~100 vertical incumbents**, and every one needs the same classification the original BI defined for horizontal SaaS families (`native-now | adapter-bridge | generic-connector | provider-led | do-not-absorb`, plus `gap`). That classification is consumed by **three** surfaces:

1. the vertical boundary-map BIs (each vertical's providers get a posture),
2. the incumbent-application coverage per-customer assessment (`IncumbentCoverageAssessment`, spec 2026-07-23 §5.4 stage 1 explicitly reads "posture matrix (BI-ECO-001)" as its first matching stage), and
3. the incumbent-coverage onboarding prefill (`BI-E4162824` / D5), whose spec says the intake list is "prefilled from the archetype's replacement-boundary list" — i.e. these providers, per archetype.

Building it once as a shared matrix is the ratified path; it is the connective tissue between the vertical-readiness thread and the incumbent-coverage thread.

## 2. Substrate verification (live, 2026-07-24)

- **No absorption/posture table exists** (`AbsorptionPosture`, `VendorAbsorption`, `EcosystemAbsorption` all absent). This is a genuine new model.
- **`McpIntegration` exists, is archetype-aware, and is empty.** Columns: `id, registryId, slug, name, shortDescription, description, logoUrl, vendor, repositoryUrl, documentationUrl, category, subcategory, tags, pricingModel, rating, ratingCount, installCount, isVerified, archetypeIds, status, rawMetadata, lastSyncedAt, …`. It is a **registry-synced marketplace catalog** (note `registryId`, `lastSyncedAt`), 0 rows today.
- **`SUPPORTED_INTEGRATIONS`** (`packages/db/src/portfolio-sources/supported-integrations-manifest.ts`, 12 entries) is the DPF-native "we integrate with these" static manifest; it projects to portfolio `potential` products via the integration-registry projector.
- **`BI-PSC-002` connector kernel is DONE** — provider-neutral connector manifest + credential/auth/refresh/callback/health/audit/retry/sync contracts. Absorption verdicts point *at* connector categories; they do not re-implement plumbing.
- **Incumbent-coverage `IncumbentCoverageAssessment`** (the per-customer verdict model, spec 2026-07-23 §5.2) is **not yet built** (that is D3); its `verdict` enum is `native_now | adapter_bridge | generic_connector | provider_led | do_not_absorb | gap`. This plan's matrix must use the **same** vocabulary so the per-customer stage 1 can default from it.

### 2.1 Model decision — new `AbsorptionPosture`, not extend `McpIntegration`

The posture is **DPF-authored doctrine**; `McpIntegration` is **externally-synced catalog data** (`lastSyncedAt`). Mixing authored verdicts into a synced row risks a sync overwriting doctrine. Therefore: a **new `AbsorptionPosture` model**, with an optional FK to `McpIntegration` / `CatalogIdentity` when the provider is also cataloged. This honors `schema-audit-before-features` (don't overload a synced table) and keeps the doctrine authoritative.

## 3. Data model

```
AbsorptionPosture
  id
  providerName         // "Mindbody", "Toast", "QuickBooks"
  providerFamily?      // grouping key ("scheduling-fitness", "pos-food")
  integrationCategory  // payments | calendar | messaging | documents | accounting
                       // | crm | inventory | pos | maps | telematics | access-control
                       // | psa-rmm | ticketing | core-banking | lms | feature-flags | ...
  connectorTier        // "tier1-shared" | "tier2-semi" | "tier3-bespoke" (spec §6.1)
  archetypeIds         // string[] — which verticals name this incumbent
  verdict              // native_now | adapter_bridge | generic_connector
                       // | provider_led | do_not_absorb | gap   (== IncumbentCoverageAssessment vocab)
  coveringPrimitive?   // the DPF domain primitive that absorbs it (per original BI-ECO-001)
  reason               // why this verdict
  confidence           // 0..1
  source               // "seed" | "operator" | "ai" | "human_confirmed"
  mcpIntegrationId?    // FK when also in the marketplace catalog
  catalogIdentityId?   // FK when normalized (shared with SAM Phase A/B)
  status               // proposed | confirmed | superseded
  createdAt / updatedAt
  @@unique([providerName, integrationCategory])
```

Closed string enums (`verdict`, `connectorTier`, `source`, `status`, `integrationCategory`) follow AGENTS.md §3 strongly-typed-string-enums, guarded by a `isAbsorptionVerdict`-style predicate + a seed-parity test.

## 4. Phases

### P0 — Provider inventory as structured seed data (small)
Convert spec §6.2's ~100 providers into a checked-in seed manifest (`packages/db/data/vertical-incumbents.json` or a typed `.ts` manifest), each row: `providerName, integrationCategory, connectorTier, archetypeIds`. No verdicts yet — this is the raw inventory. **Acceptance:** manifest holds all ~100 providers; each maps to a valid category/tier; archetypeIds match real archetype ids; a parity test asserts every `EP-VERTICAL-*` boundary-map BI's named providers appear.

### P1 — `AbsorptionPosture` model + default seed (medium)
Hand-author the migration for the model (§3). Seed default `verdict` + `coveringPrimitive` for the horizontal families from the original BI-ECO-001 list (Workday/QuickBooks/Stripe/…) and a first pass for the Tier-1 categories. Vertical Tier-3 incumbents seed as `verdict=provider_led` or `gap` with `source=seed, status=proposed` (conservative default — no absorption overclaim, honoring the boundary-map BIs' "avoid replacement overclaim"). **Acceptance:** every P0 provider has a posture row; verdicts are `proposed` until human-confirmed; the seed is idempotent.

### P2 — Wire the matrix to its three consumers (medium)
1. **Boundary-map surface:** expose posture per archetype so a vertical epic can render its incumbents + verdicts (no new route — reuse the portfolio/coverage surface or an admin view).
2. **Incumbent-coverage default:** `IncumbentCoverageAssessment` stage 1 (when D3 builds) reads `AbsorptionPosture` as the `assessedVia=posture_matrix` default. This plan provides the table + a typed accessor; D3 consumes it.
3. **Onboarding prefill:** `BI-E4162824` reads `AbsorptionPosture` filtered by the org's archetype to prefill the "what do you run today" list. **Acceptance:** given an archetype, a typed query returns its incumbents + default verdicts; covered by a unit test.

### P3 — Seed the connector catalog for Tier-1 (medium, optional / parallel)
Seed `McpIntegration` (or extend `SUPPORTED_INTEGRATIONS`) for the **Tier-1 shared** categories (payments, calendar, messaging, documents, accounting, CRM, inventory) so the portfolio "potential" projection and the connector kernel have real targets — closing the `McpIntegration=0` readiness gap (spec §7). This is the first concrete step of the connector build-order and can proceed in parallel with P1/P2. **Acceptance:** Tier-1 categories have catalog entries; the integration-registry projector surfaces them; no duplication with the existing 12 `SUPPORTED_INTEGRATIONS`.

## 5. Verification

- Unit: enum predicates; the P0→P1 parity test (every boundary-map provider has a posture); the P2 per-archetype accessor.
- Migration: apply-clean against existing data (the model is additive — no tightening constraint on existing rows, so fleet-safe by construction; attest `data-safe` per AGENTS.md §Migration-safety).
- Production build + UX verification for any P2 surface.
- No absorption verdict reaches `confirmed` without human/authorized-coworker action (governance).

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Seeding ~100 verdicts risks replacement-overclaim (marketing sensitivity the boundary-map BIs explicitly warn against). | Default vertical incumbents to `provider_led`/`gap`, `status=proposed`; only horizontal families DPF genuinely absorbs get `native_now`; nothing is `confirmed` without a human. |
| R2 | Provider metadata (category/tier) drifts as the companion thread files new verticals. | P0 manifest + parity test fail CI when a boundary-map BI names a provider absent from the manifest, forcing the manifest to stay complete. |
| R3 | Overlap with `McpIntegration` marketplace sync. | §2.1: posture is a separate authored model with an optional FK, never a synced-catalog column. |
| R4 | Building ahead of `IncumbentCoverageAssessment` (D3). | P2 provides the table + accessor only; D3 consumes it later. No dependency inversion — the matrix is usable by the boundary-maps and prefill immediately. |

## 7. Sequencing

Independent of the `BI-PSC-010` keystone and of the §11 founder questions — it can start now. It is spec §7 priority #3 (after the keystone and Tier-1 connectors) but is the **most immediately buildable** slice because its substrate (the ~100 providers, the verdict vocabulary, the McpIntegration table) is fully in hand. P3 is the concrete first step of the Tier-1 connector priority (#2) and can run in parallel.
