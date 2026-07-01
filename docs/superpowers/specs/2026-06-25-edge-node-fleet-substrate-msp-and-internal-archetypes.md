# Edge Node Fleet Substrate: MSP + Internal Company-Owned Archetypes

**Date:** 2026-06-25
**Status:** Substrate audit (evidence-backed; no schema change made)
**Scope:** How the edge-node fleet supports the two business archetypes the operator is
building toward, and what the in-flight workstreams depend on.
**Supersedes (in scope):** [2026-06-24-edge-node-across-100-separate-installs-feasibility.md](2026-06-24-edge-node-across-100-separate-installs-feasibility.md)
— the operator reframed away from "100 separate installs" to MSP-primary + internal company-owned.

---

## TL;DR

- **The scope model already names three ownership tiers as first-class vocabulary** —
  `organization` (internal estate), `customer-account`, `customer-site`
  ([apps/web/lib/edge-node/scope.ts:1-12](../../../apps/web/lib/edge-node/scope.ts)).
  Both archetypes exist in the type system.
- **Archetype A — MSP (primary): substantially done.** Customer×site scoping is modeled,
  minted, enforced (`strict-customer-scope`), and isolation between customers is real. This is
  production-shaped today.
- **Archetype B — internal company-owned (single org): done at *whole-org* granularity, missing
  at *per-site/per-location* granularity.** A node with no customer is treated as
  organization-scoped by convention. But there is **no organization-site axis** — an internal
  company with HQ + warehouse + N stores cannot scope nodes *per location* without either
  abusing `CustomerSite` (modeling itself as its own "customer") or building the org-site model.
- **This gap is already named and filed** under EP-EDGE-TOPOLOGY as the "retail per-location
  fleet" / "retail site model gap." Closing that *one* substrate audit unblocks **every**
  single-org-by-location archetype the workstreams need: retail, property management, HOA,
  field-service trades, municipalities.

---

## 1. The scope model (the linchpin)

[apps/web/lib/edge-node/scope.ts](../../../apps/web/lib/edge-node/scope.ts):

```ts
export type EdgeNodeOwnershipScope =
  | "organization"        // internal company-owned estate (Archetype B)
  | "customer-account"    // MSP customer (Archetype A)
  | "customer-site";      // MSP customer site (Archetype A)

export type EdgeNodeScopePolicy = {
  ownershipScope: EdgeNodeOwnershipScope;
  enforcement: "organization-scope" | "strict-customer-scope";
  source: "bootstrap-token";
  customerAccountId?: string | null;
  customerSiteId?: string | null;
};
```

The vocabulary is complete. The asymmetry is in what gets **minted** and what **sub-axes**
exist — see below.

## 2. Archetype A — MSP (IT service provider): substantially done

| Layer | State | Evidence |
|---|---|---|
| Data model | **DONE** | `EdgeNode.customerAccountId? / customerSiteId?` + FKs (`onDelete: SetNull`); `CustomerSite.account` is a **required** parent (`onDelete: Cascade`); `BootstrapToken.targetCustomerAccountId / targetCustomerSiteId`. [schema.prisma](../../../packages/db/prisma/schema.prisma) `model EdgeNode` / `model CustomerSite` / `model CustomerAccount`. |
| Scope minting | **DONE** | `defaultScopePolicy()` emits `customer-account` or `customer-site` with `strict-customer-scope`. [scope.ts:26-41](../../../apps/web/lib/edge-node/scope.ts) |
| Invariant | **DONE** | `normalizeEdgeNodeScopeBinding()` throws if `customerSiteId && !customerAccountId`. [scope.ts:49-51](../../../apps/web/lib/edge-node/scope.ts) |
| Customer isolation | **DONE** | `strict-customer-scope`; two customers reusing `192.168.x.x` don't collide. Customer-scoped discovery cannot mark another customer's devices **or the MSP internal estate** stale. [2026-05-22 segmentation spec §602](2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md) |
| Internal vs customer estate boundary | **RECOGNIZED** | [2026-04-23 MSP archetype spec §12](2026-04-23-it-service-provider-msp-archetype-design.md) "Internal Estate vs Customer Estate Separation". |

The MSP archetype is the one DPF is genuinely built for, and the substrate reflects that.

## 3. Archetype B — internal company-owned (single org): partial

### 3a. Whole-org granularity — WORKS

A node with `customerAccountId = NULL` and `customerSiteId = NULL` is treated as
**organization-scoped** by convention:

- `defaultScopePolicy()` returns `null` when both are absent ([scope.ts:30](../../../apps/web/lib/edge-node/scope.ts)); the scope test names this "keeps organization-scoped nodes unbound" ([scope.test.ts:6](../../../apps/web/lib/edge-node/scope.test.ts)).
- The edge adapters route routes these to "the legacy all-null adapter path" with the comment *"Organization-scoped nodes keep the legacy all-null adapter path"* ([api/v1/edge/adapters/route.ts:118](../../../apps/web/app/api/v1/edge/adapters/route.ts)).
- The enforcement engine in [customer-estate/scope-policy.ts](../../../apps/web/lib/customer-estate/scope-policy.ts) explicitly mints `mode: "organization-scope"` and *"passes organization-scoped work without a customer account"* ([scope-policy.test.ts:74](../../../apps/web/lib/customer-estate/scope-policy.test.ts)).

So: **an internal company can deploy edge nodes across its own estate today — at the granularity
of "the whole organization."**

### 3b. Per-site / per-location granularity — MISSING (and filed)

There is **no organization-site axis**. The only structured site concept is `CustomerSite`,
which **requires** a `CustomerAccount` parent. There is no standalone `Site` / `Location` model
(`grep "^model (Site|Location)"` → none). And `defaultScopePolicy()` never emits
`ownershipScope: "organization"` with a sub-location key — the union member exists but is
inferred from null, not minted with location granularity.

Consequence: an internal company with **HQ + warehouse + 5 stores** cannot scope nodes per
location without one of:
1. **Abuse `CustomerSite`** — model the company as its own `CustomerAccount` and each location
   as a `CustomerSite`. Works, but conflates "internal estate" with "customer," polluting the
   estate-separation boundary §2 relies on.
2. **Build the org-site model** — extend the site concept to be org-ownable, or add an org-site
   key to `EdgeNode` scope, and have `defaultScopePolicy()` mint organization-site scope.

This is **explicitly named and filed**, not a surprise:

- [2026-06-19 topology spec §7.2](2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md) marked `[J]` (open) — line 221: *"retail does not yet have a per-location site model wired the way MSP does — this is the retail-specific gap to file."*
- Line 356: *"For retail, prefer extending the existing site concept rather than a new 'location' table — substrate-audit before any schema add."*
- §13 item 6: **"Retail per-location fleet"** — substrate-audit the retail site model; scope retail edge nodes by location; fleet-by-location view (`workType=feature`).
- §15 gap #4: **"Retail site model gap."**

## 4. The single highest-leverage move

Close the **"retail per-location fleet" substrate audit** (topology spec §13 item 6). It is
mislabeled "retail" — it is in fact the **single-org-by-location** scope model, and the same
spec says so:

> "The same pattern serves any archetype that operates across physical contexts — property
> management (per building), HOA (per community), field-service trades (per yard/branch),
> municipalities (per facility)." — [§ generalization, 2026-06-19 spec](2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md)

Concretely, the audit must decide between *extend the site concept to be org-ownable* vs *add an
org-site key to `EdgeNode.scopePolicy`*, then wire `defaultScopePolicy()` to mint
organization-site scope and add fleet-by-location grouping. **Do not pre-commit a schema/table**
— the spec is explicit that the audit comes first.

## 5. In-flight workstreams that depend on this archetype

| Workstream / Epic | Dependency on edge-fleet archetype substrate |
|---|---|
| **EP-EDGE-TOPOLOGY** ([2026-06-19 spec](2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md)) | The umbrella: opt-in local, easy remote, **fleet-per-archetype**. Carries the retail/internal site-model gap (§13 item 6, §15 #4). |
| **EP-ARCH-8D4F2A** (archetype model) | Archetype-fleet BIs link here; the per-location fleet feature (§13 item 6) "may link EP-ARCH-8D4F2A." |
| **EP-ESTATE-SOVEREIGNTY** | Compliance posture over edge — depends on the internal-vs-customer estate boundary being clean (which §3b's `CustomerSite`-abuse workaround would muddy). |
| **EP-ARCH-GRAPH-LIVE** | SysML / live-graph projection of the deployment topology. |
| **MSP archetype** ([2026-04-23 spec](2026-04-23-it-service-provider-msp-archetype-design.md)) | §12 internal vs customer estate separation. |
| **Archetype segmentation** ([2026-05-22 spec](2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md)) | `organization-internal` segment (line 372); network/topology surfaces hidden for non-MSP profiles but org-internal inventory still used (line 603). |
| **Partner / reseller archetype** ([2026-06-04 spec](2026-06-04-partner-reseller-archetype-identity-design.md)) | Introduces a **fourth** scope axis (`partner-account`, `strict-partner-scope`, downstream sub-customers). Whatever shape §4's audit lands in should anticipate this. |
| Enforcement engine | [customer-estate/scope-policy.ts](../../../apps/web/lib/customer-estate/scope-policy.ts) — already understands `organization-scope` vs `strict-customer-scope`; the org-site work extends this, not replaces it. |

## 6. Bottom line for the operator

- **MSP is ready** to build the dependent workstreams on. Customer×site scope, isolation, and
  the internal/customer estate boundary are wired.
- **Internal company-owned works at whole-org granularity today.** If any dependent workstream
  needs internal nodes scoped **per site/location** (almost certainly — that's the whole point
  of an estate), the **one prerequisite** is the single-org-by-location substrate audit, already
  filed under EP-EDGE-TOPOLOGY §13 item 6. That audit is the unlock for *all* single-org-by-
  location archetypes at once.
- **Recommended sequencing:** run the substrate audit (decide *extend-site* vs *org-site-key*)
  **before** any dependent workstream hard-codes the `CustomerSite`-as-customer workaround,
  because unwinding that later would violate the estate-separation invariant EP-ESTATE-
  SOVEREIGNTY depends on.

## 7. Evidence index (verified 2026-06-25)

- [apps/web/lib/edge-node/scope.ts](../../../apps/web/lib/edge-node/scope.ts) — three-tier ownership scope; `defaultScopePolicy` mints customer-* only
- [apps/web/lib/customer-estate/scope-policy.ts](../../../apps/web/lib/customer-estate/scope-policy.ts) — `organization-scope` vs `strict-customer-scope` enforcement
- [apps/web/app/api/v1/edge/adapters/route.ts:118](../../../apps/web/app/api/v1/edge/adapters/route.ts) — organization-scoped = legacy all-null path
- [packages/db/prisma/schema.prisma](../../../packages/db/prisma/schema.prisma) — `EdgeNode` (`customerAccountId?`/`customerSiteId?`/`scopePolicy Json?`, no `organizationId`), `CustomerSite` (required `CustomerAccount` parent), no `Site`/`Location` model
- [2026-06-19 topology spec](2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md) §7.2 `[J]`, §13 item 6, §15 #4 — the filed gap
- [2026-04-23 MSP archetype spec](2026-04-23-it-service-provider-msp-archetype-design.md) §12 — estate separation
- [2026-05-22 segmentation spec](2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md) — `organization-internal` segment, isolation invariants
- [2026-06-04 partner/reseller spec](2026-06-04-partner-reseller-archetype-identity-design.md) — incoming fourth scope axis
