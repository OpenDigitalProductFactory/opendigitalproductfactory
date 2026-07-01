# Substrate Audit: Internal Company-Owned Edge-Node Scoping (Per-Location)

**Date:** 2026-06-25
**Status:** Substrate audit + decision (the gate the topology spec blocks on)
**Epic:** EP-EDGE-TOPOLOGY — discharges §13 item 6 / §15 gap #4 / §7.2 `[J]`
**Predecessor:** [2026-06-25-edge-node-fleet-substrate-msp-and-internal-archetypes.md](2026-06-25-edge-node-fleet-substrate-msp-and-internal-archetypes.md)
**Successor plan:** [2026-06-25-edge-node-internal-estate-per-location-implementation-plan.md](2026-06-25-edge-node-internal-estate-per-location-implementation-plan.md)
**Rule honored:** the topology spec says *"do not assume a table — file the substrate audit first."* This is that audit.

---

## 1. Problem

The MSP archetype (one Authority, many customers × sites) has full edge-node scope isolation.
The **internal company-owned** archetype (a single org managing its *own* estate — HQ +
warehouse + N stores/offices/facilities) works **only at whole-org granularity** today. There is
no way to scope a node to *a specific internal location* and have the platform enforce that
boundary. This blocks every single-org-by-location archetype: retail, property management, HOA,
field-service trades (yards/branches), municipalities (facilities).

## 2. The decisive substrate fact

**Edge request scoping is enforced on the `customerAccountId` / `customerSiteId` *columns*, not
on the `scopePolicy` Json.** Evidence — the adapters route builds its `WHERE` purely from the
authenticated node's two columns:

```ts
// apps/web/app/api/v1/edge/adapters/route.ts:31-56
function buildAdapterScopeWhere(authResult: {
  edgeNodeRowId: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
}) { /* OR over targetEdgeNodeId + (customerAccountId, customerSiteId) matches */ }
```

The auth context carries only those two columns; `scopePolicy` is descriptive metadata that the
enforcement path never reads. **Therefore any "org-site key" stored only in `scopePolicy` Json
would look configured but would not isolate** — a node so "scoped" would still receive the
all-null organization adapter set. That is worse than no feature: it is a security-shaped
control that does not enforce.

**Consequence:** real per-location internal scoping requires a *column the route can filter on*,
i.e. a structural (schema) change. This is exactly why the topology spec frames the answer as
*"extend the site concept,"* not *"add Json."*

## 3. Options considered

| # | Option | Enforced? | Migration | Verdict |
|---|---|---|---|---|
| A | **Extend `CustomerSite` to be org-ownable** — make `accountId` nullable, add `organizationId`, invariant "exactly one owner"; internal locations are `CustomerSite` rows owned by the org; `EdgeNode.customerSiteId` already points at them; extend `buildAdapterScopeWhere` with an org-owner branch. | ✅ (reuses the `customerSiteId` column the route already filters) | Yes — nullable + new FK + backfill-safe | **CHOSEN** |
| B | New `Location` / `OrganizationSite` table + new `EdgeNode.organizationSiteId` column + parallel scope-where branch. | ✅ | Yes — new table + new column + new index | Rejected: spec says *prefer extending the existing site concept rather than a new "location" table*; duplicates `CustomerSite`'s address/CI/relation surface. |
| C | Org-site key in `scopePolicy` Json only. | ❌ (route never reads Json) | No | **Rejected** — non-enforcing (§2). |
| (Phase 1) | **Explicit `organization` ownership minting** — distinguish a deliberately internal-estate node from an unscoped one; columns stay null. | n/a (no per-site claim) | No | **Landed** (this PR) — foundation, not the full feature. |

## 4. Decision

**Adopt Option A (extend `CustomerSite` to be org-ownable).** Rationale:

1. **Enforcement reuse.** `EdgeNode.customerSiteId` and the adapters/discovery scope-where
   already pivot on the site column. An org-owned `CustomerSite` flows through the *same*
   enforcement path with one added branch — minimal new attack surface.
2. **Spec-aligned.** Matches topology spec §356 explicitly.
3. **Surface reuse.** `CustomerSite` already carries address, `CustomerConfigurationItem`,
   discovery relations, and `siteType` — everything an internal location needs.
4. **Future axis.** The owner becomes a small discriminated set
   (`customer-account` | `organization` | later `partner-account`), so the incoming
   partner/reseller axis ([2026-06-04 spec](2026-06-04-partner-reseller-archetype-identity-design.md))
   slots in without re-architecting.

### 4.1 Required schema shape (Phase 2 — NOT yet applied)

- `CustomerSite.accountId` → **nullable**.
- `CustomerSite.organizationId` → **new nullable FK** to `Organization`.
- Invariant (app-layer + DB check): **exactly one of** `accountId` / `organizationId` is set.
- `EdgeNode` / `BootstrapToken`: no new column — `customerSiteId` /
  `targetCustomerSiteId` already reach an org-owned site. `scopePolicy.ownershipScope` becomes
  `"organization"` with the site id recorded for display/audit.

### 4.2 Required enforcement shape

- Extend `buildAdapterScopeWhere` (and the equivalent discovery/metrics/events scope filters)
  with an **organization-owned-site** branch: when the node's site is org-owned, match rows for
  that org-site and the org's unbound estate, and **never** customer-owned rows.
- **Invariant test (non-negotiable):** an organization-scoped node must never receive a
  customer-owned adapter/discovery row, and a customer-scoped node must never receive an
  org-owned row. This is the [segmentation spec line 602](2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md)
  isolation rule applied to the internal estate.

## 5. What landed tonight (Phase 1)

Explicit `organization` ownership minting in
[apps/web/lib/edge-node/scope.ts](../../../apps/web/lib/edge-node/scope.ts) +
[enrollment.ts](../../../apps/web/lib/edge-node/enrollment.ts):

- `normalizeEdgeNodeScopeBinding({ organizationScoped: true })` now mints an explicit
  `{ ownershipScope: "organization", enforcement: "organization-scope" }` policy instead of a
  bare null binding; `issueBootstrapToken({ organizationScoped: true })` threads it.
- Enforcement columns stay null → **no behavior change** to request scoping (org nodes keep the
  legacy all-null adapter path); the gain is that the platform can now *distinguish a
  deliberately internal-estate node from an unscoped/unknown one* — needed by the fleet view,
  audit trail, and the estate-separation boundary.
- Mixing `organizationScoped` with a customer target throws; bare bindings stay null
  (back-compat). 8 new/updated unit assertions, all green.

Phase 1 is the safe, no-migration foundation. It does **not** deliver per-location isolation —
that is Phase 2 (the schema + enforcement work above), which must be reviewed before applying a
migration.

## 6. Risks / invariants to carry into Phase 2

1. **Estate cross-contamination** (§4.2 invariant) — the single most important test.
2. **Backfill safety** — existing `CustomerSite` rows all have `accountId`; making it nullable
   must not orphan them; the "exactly one owner" check must tolerate the all-customer present.
3. **UI ambiguity** — the `/platform/edge-nodes` "add a node" flow must offer *internal
   location* vs *customer site* as distinct, non-confusable choices.
4. **Partner axis** — design the owner discriminator as an enum from day one.

## 7. Ready-to-file backlog (file against the canonical backlog; see plan doc for full specs)

- **BI — internal-estate per-location schema** (`workType=feature`): the §4.1 migration.
- **BI — org-owned-site scope enforcement + isolation tests** (`workType=feature`): §4.2.
- **BI — provisioning UX for internal location** (`workType=feature`): §6.3.
- **BI — fleet-by-location view for single-org estate** (`workType=feature`).
- (Phase 1 BI — explicit organization minting — satisfied by this PR; file for record + link.)

All link **EP-EDGE-TOPOLOGY** (may cross-link EP-ARCH-8D4F2A); the isolation-test BI also
relates to **EP-ESTATE-SOVEREIGNTY**.
