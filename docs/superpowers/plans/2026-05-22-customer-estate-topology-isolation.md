# Customer Estate Topology Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent MSP customer inventory and network topology from cross-contaminating when customers reuse the same private IP ranges, hostnames, device identifiers, or network layouts.

**Architecture:** Treat customer estate topology as a scoped identity problem, not a UI filtering problem. Discovery ingestion derives scope from the authenticated Edge Node, persists scope onto discovery runs, inventory entities, relationships, and Neo4j projections, and requires topology graph queries to start from a `TopologyScopeContext`. The customer topology workbench is also an MSP-type capability gate, not a universal portal feature.

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL, Neo4j, pnpm, Vitest, DPF Edge Node discovery APIs.

---

## Context

Spec: `docs/superpowers/specs/2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md`

Current state on `origin/main` after PR #988:

- `EdgeNode.customerAccountId`, `EdgeNode.customerSiteId`, and `EdgeNode.scopePolicy` exist.
- `BootstrapToken.targetCustomerAccountId`, `BootstrapToken.targetCustomerSiteId`, and `BootstrapToken.scopePolicy` exist.
- `DiscoveryConnection.customerAccountId`, `DiscoveryConnection.customerSiteId`, and `DiscoveryConnection.targetEdgeNodeId` exist.
- `DiscoveryRun.customerAccountId` and `DiscoveryRun.customerSiteId` exist.
- `InventoryEntity` and `InventoryRelationship` do not yet have scope columns.
- `buildInventoryEntityKey()` still produces global keys such as `host:arp:192.168.1.1`.
- `persistBootstrapDiscoveryRun()` currently builds the stale set from all inventory rows, which would let a Customer A run mark Customer B rows stale.
- `getNetworkTopologyData()` queries Neo4j without customer/site scope.

The first code slice must fix identity, persistence, and query scoping before polishing the UI.

Research update: NetBox models overlapping IP address spaces through VRF and tenant boundaries; Auvik, N-able N-central, and NinjaOne all frame network maps or device operations around customer/site/organization contexts. DPF should follow the same separation. The storage and query safeguards are platform hygiene, but the customer network topology route itself belongs only to MSP-type profiles whose normalized capabilities make customer-estate, network-inventory, and edge-node customer deployment required.

## File Structure

- Create `apps/web/lib/customer-estate/topology-applicability.ts`
  - Owns `canUseCustomerNetworkTopology()` and keeps route/UI gating out of scattered components.
- Create `apps/web/lib/customer-estate/topology-applicability.test.ts`
  - Proves MSP-type activation passes and salon/retail/optional-network profiles do not.
- Create `packages/db/src/discovery-scope.ts`
  - Owns `DiscoveryScopeContext`, `buildDiscoveryScopeKey()`, `buildScopedInventoryEntityKey()`, and `buildScopedRelationshipKey()`.
- Create `packages/db/src/discovery-scope.test.ts`
  - Proves duplicate private IPs stay distinct across Customer A, Customer B, and internal MSP scopes.
- Modify `packages/db/src/discovery-identity.ts`
  - Accept optional scope keys when building discovered keys and inventory keys.
- Modify `packages/db/src/discovery-identity.test.ts`
  - Adds backward-compatible unscoped tests plus new scoped-key tests.
- Modify `packages/db/src/discovery-normalize.ts`
  - Adds `discoveryScope` to `NormalizeDiscoveryOptions` and writes scoped keys into normalized entities and relationships.
- Modify `packages/db/src/discovery-sync.ts`
  - Persists scope fields to `InventoryEntity` and `InventoryRelationship`, and makes stale detection scope-local.
- Modify `packages/db/src/persist-submitted-discovery-run.ts`
  - Builds discovery scope from server-authenticated Edge Node fields before normalization.
- Modify `packages/db/src/neo4j-sync.ts` and `packages/db/src/neo4j-sync.test.ts`
  - Projects `scopeKey`, `customerAccountId`, and `customerSiteId` to `InfraCI` nodes and relationships.
- Modify `packages/db/src/neo4j-graph.ts`
  - Adds scoped topology query helpers.
- Modify `packages/db/prisma/schema.prisma`
  - Adds scope metadata to `InventoryEntity` and `InventoryRelationship`.
- Create Prisma migration under `packages/db/prisma/migrations/<timestamp>_customer_topology_scope/migration.sql`
  - Adds columns, indexes, and optional FKs.
- Modify `apps/web/lib/actions/graph.ts`
  - Requires topology scope for customer network graph reads.
- Create `apps/web/lib/actions/graph.customer-scope.test.ts`
  - Proves scoped graph reads pass scope filters into Neo4j and do not call global topology queries for customer contexts.
- Modify `apps/web/components/inventory/DiscoveryOperationsPage.tsx`
  - Keeps the global inventory page aggregate-only unless no customer-estate isolation is active.
- Create `apps/web/components/inventory/CustomerTopologyScopeBar.tsx`
  - Displays active customer/site/internal scope in the topology workbench.
- Create `apps/web/components/inventory/CustomerTopologyScopeBar.test.tsx`
  - Verifies customer, site, and internal labels render with theme-aware classes.

Refactoring allocation: Tasks 0, 1, 4, 7, and 8 are refactoring-heavy and account for at least 20 percent of the implementation. They remove global identity assumptions, centralize applicability gating, and split graph scope/style responsibilities before adding more UI.

## Task 0: Gate Customer Topology By MSP-Type Capability Applicability

**Files:**
- Create: `apps/web/lib/customer-estate/topology-applicability.ts`
- Create: `apps/web/lib/customer-estate/topology-applicability.test.ts`

- [ ] **Step 1: Write the failing applicability tests**

Create `apps/web/lib/customer-estate/topology-applicability.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { readActivationProfile } from "@/lib/storefront/archetype-activation";
import { canUseCustomerNetworkTopology } from "./topology-applicability";

const baseProfile = {
  modules: [],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
} as const;

describe("canUseCustomerNetworkTopology", () => {
  it("allows MSP-type managed network profiles", () => {
    const profile = readActivationProfile({
      ...baseProfile,
      profileType: "managed-service-provider",
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
      axes: {
        form: "services",
        delivery: "hybrid",
        primaryConsumer: "business",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "recurring-agreement",
        provisioning: "account-and-entitlement",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: {
          scope: "primary",
          it4itStages: ["detect-to-correct", "deploy-to-operate", "request-to-fulfill"],
        },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
    });

    expect(canUseCustomerNetworkTopology(profile)).toBe(true);
  });

  it("blocks appointment-service archetypes such as hair salons", () => {
    const profile = readActivationProfile({
      ...baseProfile,
      profileType: "standard",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "individual",
        consumptionChannel: "physical",
        commercialModel: "appointment-checkout",
        provisioning: "account-with-billing",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "minimal" },
        forEmployees: { scope: "minimal" },
        productsAndServicesSold: { scope: "primary" },
      },
    });

    expect(canUseCustomerNetworkTopology(profile)).toBe(false);
  });

  it("blocks optional facilities-style network inventory", () => {
    const profile = readActivationProfile({
      ...baseProfile,
      profileType: "standard",
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "household",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "recurring-agreement",
        provisioning: "account-and-entitlement",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "standard" },
        forEmployees: { scope: "minimal" },
        productsAndServicesSold: { scope: "primary" },
      },
    });

    expect(canUseCustomerNetworkTopology(profile)).toBe(false);
  });
});
```

Run:

```powershell
pnpm --filter web exec vitest run lib/customer-estate/topology-applicability.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Implement the helper**

Create `apps/web/lib/customer-estate/topology-applicability.ts`:

```ts
import {
  getCapabilityActivation,
  type ArchetypeActivationProfile,
} from "@/lib/storefront/archetype-activation";

function isRequiredStrictCapability(
  profile: ArchetypeActivationProfile | null | undefined,
  capabilityKey: string,
): boolean {
  const capability = getCapabilityActivation(profile, capabilityKey);
  return capability?.applicability === "required" && capability.isolation === "strict-customer-scope";
}

export function canUseCustomerNetworkTopology(
  profile: ArchetypeActivationProfile | null | undefined,
): boolean {
  return (
    isRequiredStrictCapability(profile, "customer-estate") &&
    isRequiredStrictCapability(profile, "network-inventory") &&
    getCapabilityActivation(profile, "edge-node-customer-deployment")?.applicability === "required"
  );
}
```

Do not branch on `archetypeId`. The initial built-in archetype expected to pass is `it-managed-services`, but the test should prove the capability combination, not the string id.

- [ ] **Step 3: Run the tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/customer-estate/topology-applicability.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/lib/customer-estate/topology-applicability.ts apps/web/lib/customer-estate/topology-applicability.test.ts
git commit -s -m "feat(customer-estate): gate network topology by MSP capability"
```

## Task 1: Add Discovery Scope Helpers

**Files:**
- Create: `packages/db/src/discovery-scope.ts`
- Create: `packages/db/src/discovery-scope.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/discovery-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildDiscoveryScopeKey,
  buildScopedInventoryEntityKey,
  buildScopedRelationshipKey,
  type DiscoveryScopeContext,
} from "./discovery-scope";

const customerA: DiscoveryScopeContext = {
  mode: "customer-site",
  customerAccountId: "cust_a",
  customerSiteId: "site_austin",
};

const customerB: DiscoveryScopeContext = {
  mode: "customer-site",
  customerAccountId: "cust_b",
  customerSiteId: "site_round_rock",
};

describe("discovery scope helpers", () => {
  it("builds stable keys for internal, customer account, and customer site scopes", () => {
    expect(buildDiscoveryScopeKey({ mode: "organization-internal" })).toBe("organization:internal");
    expect(buildDiscoveryScopeKey({ mode: "customer-account", customerAccountId: "cust_a" })).toBe(
      "customer:cust_a",
    );
    expect(buildDiscoveryScopeKey(customerA)).toBe("customer:cust_a:site:site_austin");
  });

  it("keeps the same private IP distinct across customer estates", () => {
    const a = buildScopedInventoryEntityKey({
      scope: customerA,
      entityType: "host",
      naturalKey: "arp:192.168.1.1",
    });
    const b = buildScopedInventoryEntityKey({
      scope: customerB,
      entityType: "host",
      naturalKey: "arp:192.168.1.1",
    });
    const internal = buildScopedInventoryEntityKey({
      scope: { mode: "organization-internal" },
      entityType: "host",
      naturalKey: "arp:192.168.1.1",
    });

    expect(a).toBe("customer:cust_a:site:site_austin:host:arp:192.168.1.1");
    expect(b).toBe("customer:cust_b:site:site_round_rock:host:arp:192.168.1.1");
    expect(internal).toBe("organization:internal:host:arp:192.168.1.1");
    expect(new Set([a, b, internal]).size).toBe(3);
  });

  it("builds relationship keys from scoped endpoint keys", () => {
    expect(
      buildScopedRelationshipKey({
        scope: customerA,
        relationshipType: "ROUTES_THROUGH",
        fromEntityKey: "customer:cust_a:site:site_austin:host:arp:192.168.1.22",
        toEntityKey: "customer:cust_a:site:site_austin:gateway:arp:192.168.1.1",
      }),
    ).toBe(
      "customer:cust_a:site:site_austin:ROUTES_THROUGH:customer:cust_a:site:site_austin:host:arp:192.168.1.22->customer:cust_a:site:site_austin:gateway:arp:192.168.1.1",
    );
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/discovery-scope.test.ts
```

Expected: FAIL because `packages/db/src/discovery-scope.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `packages/db/src/discovery-scope.ts`:

```ts
export type DiscoveryScopeContext =
  | { mode: "organization-internal" }
  | { mode: "customer-account"; customerAccountId: string }
  | { mode: "customer-site"; customerAccountId: string; customerSiteId: string };

export type DiscoveryScopeFields = {
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
};

function normalizeScopePart(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

export function buildDiscoveryScopeKey(scope: DiscoveryScopeContext): string {
  if (scope.mode === "organization-internal") return "organization:internal";
  if (scope.mode === "customer-account") {
    return `customer:${normalizeScopePart(scope.customerAccountId)}`;
  }
  return `customer:${normalizeScopePart(scope.customerAccountId)}:site:${normalizeScopePart(scope.customerSiteId)}`;
}

export function scopeFieldsFromContext(scope: DiscoveryScopeContext): DiscoveryScopeFields {
  if (scope.mode === "organization-internal") {
    return {
      scopeKey: buildDiscoveryScopeKey(scope),
      customerAccountId: null,
      customerSiteId: null,
    };
  }

  return {
    scopeKey: buildDiscoveryScopeKey(scope),
    customerAccountId: scope.customerAccountId,
    customerSiteId: scope.mode === "customer-site" ? scope.customerSiteId : null,
  };
}

export function buildScopedInventoryEntityKey(input: {
  scope: DiscoveryScopeContext;
  entityType: string;
  naturalKey: string;
}): string {
  return [buildDiscoveryScopeKey(input.scope), input.entityType, input.naturalKey]
    .map(normalizeScopePart)
    .join(":");
}

export function buildScopedRelationshipKey(input: {
  scope: DiscoveryScopeContext;
  relationshipType: string;
  fromEntityKey: string;
  toEntityKey: string;
}): string {
  return [
    buildDiscoveryScopeKey(input.scope),
    normalizeScopePart(input.relationshipType),
    `${input.fromEntityKey}->${input.toEntityKey}`,
  ].join(":");
}

export function resolveDiscoveryScopeFromIds(input: {
  customerAccountId?: string | null;
  customerSiteId?: string | null;
}): DiscoveryScopeContext {
  if (input.customerAccountId && input.customerSiteId) {
    return {
      mode: "customer-site",
      customerAccountId: input.customerAccountId,
      customerSiteId: input.customerSiteId,
    };
  }

  if (input.customerAccountId) {
    return {
      mode: "customer-account",
      customerAccountId: input.customerAccountId,
    };
  }

  return { mode: "organization-internal" };
}
```

- [ ] **Step 4: Run the tests**

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/discovery-scope.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/db/src/discovery-scope.ts packages/db/src/discovery-scope.test.ts
git commit -s -m "feat(discovery): add topology scope key helpers"
```

## Task 2: Scope Discovery Identity Normalization

**Files:**
- Modify: `packages/db/src/discovery-identity.ts`
- Modify: `packages/db/src/discovery-identity.test.ts`
- Modify: `packages/db/src/discovery-normalize.ts`
- Modify: `packages/db/src/discovery-normalize.test.ts`

- [ ] **Step 1: Write failing identity tests**

Add to `packages/db/src/discovery-identity.test.ts`:

```ts
it("prefixes inventory keys with scope when a scopeKey is supplied", () => {
  expect(
    buildInventoryEntityKey({
      scopeKey: "customer:cust_a:site:site_austin",
      entityType: "host",
      naturalKey: "arp:192.168.1.1",
    }),
  ).toBe("customer:cust_a:site:site_austin:host:arp:192.168.1.1");
});
```

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/discovery-identity.test.ts
```

Expected: FAIL because `scopeKey` is not part of `InventoryEntityKeyInput`.

- [ ] **Step 2: Implement scoped identity keys**

Modify `packages/db/src/discovery-identity.ts`:

```ts
export type InventoryEntityKeyInput = {
  entityType: string;
  naturalKey: string;
  scopeKey?: string | null;
};

export function buildInventoryEntityKey(input: InventoryEntityKeyInput): string {
  const parts = [
    input.scopeKey ? normalizeKeyPart(input.scopeKey) : null,
    normalizeKeyPart(input.entityType),
    normalizeKeyPart(input.naturalKey),
  ].filter((part): part is string => Boolean(part));

  return parts.join(":");
}
```

Keep `buildDiscoveredKey()` backward-compatible; discovered items are run-local and already guarded by `@@unique([discoveryRunId, observedKey])`.

- [ ] **Step 3: Add failing normalize test for duplicate customer IPs**

Add to `packages/db/src/discovery-normalize.test.ts`:

```ts
it("uses customer scope when normalizing inventory entity keys", () => {
  const output = {
    items: [
      {
        sourceKind: "edge_node" as const,
        itemType: "host",
        name: "Default Gateway",
        externalRef: "arp:192.168.1.1",
        attributes: { ip: "192.168.1.1" },
      },
    ],
    relationships: [],
    warnings: [],
  };

  const normalized = normalizeDiscoveredFacts(output, {
    discoveryScope: {
      mode: "customer-site",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    },
  });

  expect(normalized.inventoryEntities[0]?.entityKey).toBe(
    "customer:cust_a:site:site_austin:host:arp:192.168.1.1",
  );
  expect(normalized.inventoryEntities[0]?.properties).toMatchObject({
    scopeKey: "customer:cust_a:site:site_austin",
    customerAccountId: "cust_a",
    customerSiteId: "site_austin",
  });
});
```

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/discovery-normalize.test.ts
```

Expected: FAIL because `NormalizeDiscoveryOptions` does not accept `discoveryScope`.

- [ ] **Step 4: Implement normalize scope threading**

Modify `packages/db/src/discovery-normalize.ts`:

```ts
import {
  scopeFieldsFromContext,
  type DiscoveryScopeContext,
} from "./discovery-scope";

export type NormalizeDiscoveryOptions = {
  taxonomyNodes?: TaxonomyNodeCandidate[];
  softwareIdentities?: SoftwareIdentityCandidate[];
  softwareRules?: SoftwareNormalizationRuleInput[];
  discoveryScope?: DiscoveryScopeContext;
};
```

Inside `normalizeItem()`, compute scope fields before `buildInventoryEntityKey()`:

```ts
const scopeFields = options.discoveryScope
  ? scopeFieldsFromContext(options.discoveryScope)
  : null;

const entityKey = buildInventoryEntityKey({
  entityType,
  naturalKey: item.naturalKey ?? externalRef,
  scopeKey: scopeFields?.scopeKey,
});
```

When assigning `properties`, preserve existing attributes and add scope metadata:

```ts
properties: {
  ...(item.attributes ?? {}),
  ...(scopeFields
    ? {
        scopeKey: scopeFields.scopeKey,
        customerAccountId: scopeFields.customerAccountId,
        customerSiteId: scopeFields.customerSiteId,
      }
    : {}),
},
```

- [ ] **Step 5: Run identity and normalize tests**

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/discovery-identity.test.ts src/discovery-normalize.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/db/src/discovery-identity.ts packages/db/src/discovery-identity.test.ts packages/db/src/discovery-normalize.ts packages/db/src/discovery-normalize.test.ts
git commit -s -m "feat(discovery): scope normalized inventory identity"
```

## Task 3: Add Inventory Scope Columns

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_customer_topology_scope/migration.sql`

- [ ] **Step 1: Add failing schema assertion**

Add a regression check to the existing schema guard if one is present for inventory models. If no dedicated schema guard exists, add a focused test to `packages/db/src/discovery-sync.test.ts` after Task 4 instead. The expected fields are:

```ts
expect(Prisma.InventoryEntityScalarFieldEnum.scopeKey).toBe("scopeKey");
expect(Prisma.InventoryEntityScalarFieldEnum.customerAccountId).toBe("customerAccountId");
expect(Prisma.InventoryEntityScalarFieldEnum.customerSiteId).toBe("customerSiteId");
expect(Prisma.InventoryRelationshipScalarFieldEnum.scopeKey).toBe("scopeKey");
expect(Prisma.InventoryRelationshipScalarFieldEnum.customerAccountId).toBe("customerAccountId");
expect(Prisma.InventoryRelationshipScalarFieldEnum.customerSiteId).toBe("customerSiteId");
```

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/discovery-sync.test.ts
```

Expected: FAIL until Prisma schema and generated client are updated.

- [ ] **Step 2: Modify Prisma schema**

Add to `InventoryEntity`:

```prisma
  scopeKey          String           @default("organization:internal")
  customerAccountId String?
  customerSiteId    String?
  customerAccount   CustomerAccount? @relation(fields: [customerAccountId], references: [id], onDelete: SetNull)
  customerSite      CustomerSite?    @relation(fields: [customerSiteId], references: [id], onDelete: SetNull)

  @@index([scopeKey])
  @@index([customerAccountId])
  @@index([customerSiteId])
```

Add to `InventoryRelationship`:

```prisma
  scopeKey          String           @default("organization:internal")
  customerAccountId String?
  customerSiteId    String?
  customerAccount   CustomerAccount? @relation(fields: [customerAccountId], references: [id], onDelete: SetNull)
  customerSite      CustomerSite?    @relation(fields: [customerSiteId], references: [id], onDelete: SetNull)

  @@index([scopeKey])
  @@index([customerAccountId])
  @@index([customerSiteId])
```

If Prisma reports ambiguous relation names to `CustomerAccount` or `CustomerSite`, name these relations `InventoryEntityCustomerAccount`, `InventoryEntityCustomerSite`, `InventoryRelationshipCustomerAccount`, and `InventoryRelationshipCustomerSite`, and add matching inverse arrays on `CustomerAccount` and `CustomerSite`.

- [ ] **Step 3: Create migration**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name customer_topology_scope
```

Expected: migration is created and applies to the development database.

The migration body should be equivalent to:

```sql
ALTER TABLE "InventoryEntity"
  ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'organization:internal',
  ADD COLUMN "customerAccountId" TEXT,
  ADD COLUMN "customerSiteId" TEXT;

ALTER TABLE "InventoryRelationship"
  ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'organization:internal',
  ADD COLUMN "customerAccountId" TEXT,
  ADD COLUMN "customerSiteId" TEXT;

CREATE INDEX "InventoryEntity_scopeKey_idx" ON "InventoryEntity"("scopeKey");
CREATE INDEX "InventoryEntity_customerAccountId_idx" ON "InventoryEntity"("customerAccountId");
CREATE INDEX "InventoryEntity_customerSiteId_idx" ON "InventoryEntity"("customerSiteId");
CREATE INDEX "InventoryRelationship_scopeKey_idx" ON "InventoryRelationship"("scopeKey");
CREATE INDEX "InventoryRelationship_customerAccountId_idx" ON "InventoryRelationship"("customerAccountId");
CREATE INDEX "InventoryRelationship_customerSiteId_idx" ON "InventoryRelationship"("customerSiteId");

ALTER TABLE "InventoryEntity"
  ADD CONSTRAINT "InventoryEntity_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryEntity"
  ADD CONSTRAINT "InventoryEntity_customerSiteId_fkey"
  FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryRelationship"
  ADD CONSTRAINT "InventoryRelationship_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryRelationship"
  ADD CONSTRAINT "InventoryRelationship_customerSiteId_fkey"
  FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Generate Prisma client and run typecheck for db**

Run:

```powershell
pnpm --filter @dpf/db generate
pnpm --filter @dpf/db typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/discovery-sync.test.ts
git commit -s -m "feat(db): add customer topology scope to inventory"
```

## Task 4: Make Discovery Persistence Scope-Local

**Files:**
- Modify: `packages/db/src/discovery-sync.ts`
- Modify: `packages/db/src/discovery-sync.test.ts`
- Modify: `packages/db/src/persist-submitted-discovery-run.ts`
- Modify: `packages/db/src/persist-submitted-discovery-run.test.ts`

- [ ] **Step 1: Write failing stale-isolation test**

Add to `packages/db/src/discovery-sync.test.ts`:

```ts
it("only marks inventory stale inside the current discovery scope", async () => {
  const entityFindMany = vi.fn().mockResolvedValue([
    { entityKey: "customer:cust_a:site:site_austin:host:arp:192.168.1.1" },
  ]);
  const entityUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const relationshipFindMany = vi.fn().mockResolvedValue([]);
  const relationshipUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  const db = {
    inventoryEntity: { findMany: entityFindMany, updateMany: entityUpdateMany },
    inventoryRelationship: { findMany: relationshipFindMany, updateMany: relationshipUpdateMany },
    $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> =>
      fn({
        discoveryRun: { create: async () => ({ id: "run-a" }) },
        inventoryEntity: {
          findMany: entityFindMany,
          upsert: async ({ where }: { where: { entityKey: string } }) => ({
            id: `entity:${where.entityKey}`,
            entityKey: where.entityKey,
          }),
          updateMany: entityUpdateMany,
        },
        discoveredItem: {
          create: async ({ data }: { data: { observedKey: string } }) => ({
            id: `discovered:${data.observedKey}`,
          }),
        },
        discoveredSoftwareEvidence: { upsert: async () => ({}) },
        inventoryRelationship: {
          findMany: relationshipFindMany,
          upsert: async ({ where }: { where: { relationshipKey: string } }) => ({
            id: `relationship:${where.relationshipKey}`,
            relationshipKey: where.relationshipKey,
          }),
          updateMany: relationshipUpdateMany,
        },
        discoveredRelationship: { create: async () => ({}) },
        portfolioQualityIssue: {
          findMany: async () => [],
          upsert: async () => ({}),
        },
      }),
  };

  await persistBootstrapDiscoveryRun(
    db,
    {
      discoveredItems: [],
      inventoryEntities: [
        {
          entityKey: "customer:cust_a:site:site_austin:host:arp:192.168.1.22",
          entityType: "host",
          name: "Customer A workstation",
          discoveredKey: "edge_node:host:arp:192.168.1.22",
          attributionStatus: "attributed",
          providerView: "foundational",
          properties: {
            scopeKey: "customer:cust_a:site:site_austin",
            customerAccountId: "cust_a",
            customerSiteId: "site_austin",
          },
        },
      ],
      inventoryRelationships: [],
      softwareEvidence: [],
    },
    {
      runKey: "run-a",
      sourceSlug: "edge-node:node-a",
      trigger: "edge_node",
      status: "completed",
      edgeNodeId: "edge-a",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    },
    { projectInventoryEntity: vi.fn(), projectInventoryRelationship: vi.fn() },
  );

  expect(entityFindMany).toHaveBeenCalledWith({
    where: { scopeKey: "customer:cust_a:site:site_austin" },
    select: { entityKey: true },
  });
  expect(entityUpdateMany).toHaveBeenCalledWith({
    where: {
      scopeKey: "customer:cust_a:site:site_austin",
      entityKey: { in: ["customer:cust_a:site:site_austin:host:arp:192.168.1.1"] },
    },
    data: expect.objectContaining({ status: "stale" }),
  });
});
```

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/discovery-sync.test.ts
```

Expected: FAIL because `findMany` and `updateMany` are currently global.

- [ ] **Step 2: Implement scope-local persistence**

In `packages/db/src/discovery-sync.ts`, add:

```ts
function scopeFieldsFromRunMeta(runMeta: DiscoveryRunMeta): {
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
} {
  const customerAccountId = runMeta.customerAccountId ?? null;
  const customerSiteId = runMeta.customerSiteId ?? null;
  const scopeKey = customerAccountId
    ? customerSiteId
      ? `customer:${customerAccountId}:site:${customerSiteId}`
      : `customer:${customerAccountId}`
    : "organization:internal";

  return { scopeKey, customerAccountId, customerSiteId };
}
```

At the start of `persistBootstrapDiscoveryRun()` after `now`:

```ts
const runScope = scopeFieldsFromRunMeta(runMeta);
const scopeWhere = { scopeKey: runScope.scopeKey };
```

Change existing-key reads:

```ts
const existingEntityKeys = new Set(
  (await tx.inventoryEntity.findMany({
    where: scopeWhere,
    select: { entityKey: true },
  })).map((entity) => entity.entityKey),
);
const existingRelationshipKeys = new Set(
  (await tx.inventoryRelationship.findMany({
    where: scopeWhere,
    select: { relationshipKey: true },
  })).map((relationship) => relationship.relationshipKey),
);
```

Add scope fields to entity create/update:

```ts
scopeKey: runScope.scopeKey,
customerAccount: runScope.customerAccountId
  ? { connect: { id: runScope.customerAccountId } }
  : undefined,
customerSite: runScope.customerSiteId
  ? { connect: { id: runScope.customerSiteId } }
  : undefined,
```

For update, set scalar nulls explicitly when no customer scope:

```ts
scopeKey: runScope.scopeKey,
customerAccount: runScope.customerAccountId
  ? { connect: { id: runScope.customerAccountId } }
  : { disconnect: true },
customerSite: runScope.customerSiteId
  ? { connect: { id: runScope.customerSiteId } }
  : { disconnect: true },
```

Add scope fields to relationship create/update the same way.

Change stale updates:

```ts
await tx.inventoryEntity.updateMany({
  where: { ...scopeWhere, entityKey: { in: staleEntityKeys } },
  data: { status: "stale", lastSeenAt: now },
});
```

and:

```ts
await tx.inventoryRelationship.updateMany({
  where: { ...scopeWhere, relationshipKey: { in: staleRelationshipKeys } },
  data: { status: "stale", lastSeenAt: now },
});
```

- [ ] **Step 3: Make submitted runs normalize with authenticated scope**

In `packages/db/src/persist-submitted-discovery-run.ts`, import:

```ts
import { resolveDiscoveryScopeFromIds } from "./discovery-scope";
```

Change normalization to:

```ts
const discoveryScope = resolveDiscoveryScopeFromIds({
  customerAccountId: input.customerAccountId,
  customerSiteId: input.customerSiteId,
});

const normalized = normalizeDiscoveredFacts(input.submittedOutput, {
  discoveryScope,
});
```

- [ ] **Step 4: Run persistence tests**

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/discovery-sync.test.ts src/persist-submitted-discovery-run.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/db/src/discovery-sync.ts packages/db/src/discovery-sync.test.ts packages/db/src/persist-submitted-discovery-run.ts packages/db/src/persist-submitted-discovery-run.test.ts
git commit -s -m "feat(discovery): keep customer stale detection scope-local"
```

## Task 5: Scope Neo4j Projection

**Files:**
- Modify: `packages/db/src/neo4j-sync.ts`
- Modify: `packages/db/src/neo4j-sync.test.ts`
- Modify: `packages/db/src/neo4j-graph.ts`

- [ ] **Step 1: Write failing Neo4j projection tests**

Add to `packages/db/src/neo4j-sync.test.ts`:

```ts
it("projects customer scope onto InfraCI nodes", async () => {
  await syncInventoryEntityAsInfraCI({
    entityKey: "customer:cust_a:site:site_austin:host:arp:192.168.1.1",
    name: "Default Gateway",
    entityType: "gateway",
    status: "active",
    properties: {
      scopeKey: "customer:cust_a:site:site_austin",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    },
  });

  expect(runCypher).toHaveBeenCalledWith(
    expect.stringContaining("ci.scopeKey = $scopeKey"),
    expect.objectContaining({
      scopeKey: "customer:cust_a:site:site_austin",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    }),
  );
});
```

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/neo4j-sync.test.ts
```

Expected: FAIL because `syncInfraCI()` does not project scope properties.

- [ ] **Step 2: Implement node projection**

Extend `InfraCIExtendedProps`:

```ts
  scopeKey?: string;
  customerAccountId?: string | null;
  customerSiteId?: string | null;
```

In `syncInfraCI()`, add conditional setters for all three fields:

```ts
if (extendedProps.scopeKey !== undefined) {
  setClauses.push("ci.scopeKey = $scopeKey");
  params.scopeKey = extendedProps.scopeKey;
}
if (extendedProps.customerAccountId !== undefined) {
  setClauses.push("ci.customerAccountId = $customerAccountId");
  params.customerAccountId = extendedProps.customerAccountId;
}
if (extendedProps.customerSiteId !== undefined) {
  setClauses.push("ci.customerSiteId = $customerSiteId");
  params.customerSiteId = extendedProps.customerSiteId;
}
```

In `syncInventoryEntityAsInfraCI()`, map from `entity.properties`:

```ts
if (props.scopeKey != null) extendedProps.scopeKey = props.scopeKey as string;
if (props.customerAccountId !== undefined) {
  extendedProps.customerAccountId = props.customerAccountId as string | null;
}
if (props.customerSiteId !== undefined) {
  extendedProps.customerSiteId = props.customerSiteId as string | null;
}
```

- [ ] **Step 3: Add scoped graph helper contract**

In `packages/db/src/neo4j-graph.ts`, add:

```ts
export type Neo4jTopologyScope = {
  scopeKey: string;
  customerAccountId?: string | null;
  customerSiteId?: string | null;
};
```

Add a scoped variant rather than changing all existing callers at once:

```ts
export async function getNetworkTopologyAtLayerForScope(
  osiLayer: number,
  scope: Neo4jTopologyScope,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const rows = await runCypher<GraphRow>(
    `MATCH (ci:InfraCI)
     WHERE ci.osiLayer = $osiLayer
       AND ci.scopeKey = $scopeKey
     OPTIONAL MATCH (ci)-[r]->(to:InfraCI {scopeKey: $scopeKey})
     RETURN ci, r, to`,
    { osiLayer, scopeKey: scope.scopeKey },
  );
  return rowsToGraph(rows);
}
```

Use the existing row mapper names from `neo4j-graph.ts`; do not duplicate mapping logic. If the existing mapper is private, extract it in the same file.

- [ ] **Step 4: Run db tests**

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/neo4j-sync.test.ts
pnpm --filter @dpf/db typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/db/src/neo4j-sync.ts packages/db/src/neo4j-sync.test.ts packages/db/src/neo4j-graph.ts
git commit -s -m "feat(graph): project customer topology scope to neo4j"
```

## Task 6: Require Scope in Customer Topology Server Actions

**Files:**
- Modify: `apps/web/lib/actions/graph.ts`
- Create: `apps/web/lib/actions/graph.customer-scope.test.ts`

- [ ] **Step 1: Write failing server-action tests**

Create `apps/web/lib/actions/graph.customer-scope.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  getNetworkTopologyAtLayerForScope: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  getNetworkTopologyAtLayer: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  getInfraCIs: vi.fn().mockResolvedValue([]),
  getNeighbours: vi.fn(),
  getDownstreamImpact: vi.fn(),
  getLayeredDependencyStack: vi.fn(),
  runCypher: vi.fn().mockResolvedValue([]),
  prisma: {
    digitalProduct: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    portfolio: { findMany: vi.fn().mockResolvedValue([]) },
    taxonomyNode: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

const db = await import("@dpf/db");
const graph = await import("./graph");

describe("customer topology graph actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the scoped Neo4j query for customer topology", async () => {
    await graph.getCustomerNetworkTopologyData({
      mode: "customer-site",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    });

    expect(db.getNetworkTopologyAtLayerForScope).toHaveBeenCalledWith(3, {
      scopeKey: "customer:cust_a:site:site_austin",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    });
    expect(db.getNetworkTopologyAtLayer).not.toHaveBeenCalled();
  });
});
```

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/graph.customer-scope.test.ts
```

Expected: FAIL because `getCustomerNetworkTopologyData()` does not exist.

- [ ] **Step 2: Implement scoped graph action**

In `apps/web/lib/actions/graph.ts`, import:

```ts
import { getNetworkTopologyAtLayerForScope } from "@dpf/db";
import {
  buildDiscoveryScopeKey,
  scopeFieldsFromContext,
  type DiscoveryScopeContext,
} from "@dpf/db/discovery-scope";
```

If `@dpf/db/discovery-scope` is not exported, add that export in `packages/db/package.json` and `packages/db/src/index.ts`.

Add:

```ts
export type TopologyScopeContext = DiscoveryScopeContext;

export async function getCustomerNetworkTopologyData(
  scope: TopologyScopeContext,
): Promise<GraphData> {
  if (scope.mode === "organization-internal") {
    return getNetworkTopologyData();
  }

  const scopeFields = scopeFieldsFromContext(scope);
  const { nodes: ciNodes, edges: ciEdges } = await getNetworkTopologyAtLayerForScope(3, {
    scopeKey: buildDiscoveryScopeKey(scope),
    customerAccountId: scopeFields.customerAccountId,
    customerSiteId: scopeFields.customerSiteId,
  });

  const nodeMap = new Map<string, GraphData["nodes"][0]>();
  for (const ci of ciNodes) {
    nodeMap.set(ci.id, infraCIToGraphNode(ci));
  }

  const links = ciEdges
    .filter((edge) => nodeMap.has(edge.from) && nodeMap.has(edge.to))
    .map((edge) => ({ source: edge.from, target: edge.to, type: edge.type }));

  return { nodes: Array.from(nodeMap.values()), links };
}
```

- [ ] **Step 3: Run web action tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/graph.customer-scope.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/lib/actions/graph.ts apps/web/lib/actions/graph.customer-scope.test.ts packages/db/package.json packages/db/src/index.ts
git commit -s -m "feat(graph): require scope for customer topology reads"
```

## Task 7: Add Scope Bar and Keep Global Inventory Aggregate-Only

**Files:**
- Create: `apps/web/components/inventory/CustomerTopologyScopeBar.tsx`
- Create: `apps/web/components/inventory/CustomerTopologyScopeBar.test.tsx`
- Modify: `apps/web/components/inventory/DiscoveryOperationsPage.tsx`
- Use: `apps/web/lib/customer-estate/topology-applicability.ts`

- [ ] **Step 1: Write the scope bar tests**

Create `apps/web/components/inventory/CustomerTopologyScopeBar.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CustomerTopologyScopeBar } from "./CustomerTopologyScopeBar";

describe("CustomerTopologyScopeBar", () => {
  it("shows customer and site context for customer-site topology", () => {
    const html = renderToStaticMarkup(
      <CustomerTopologyScopeBar
        scopeLabel="Acme Dental"
        siteLabel="Austin Office"
        mode="customer-site"
        lastRunLabel="Last discovery 4m ago"
      />,
    );

    expect(html).toContain("Acme Dental");
    expect(html).toContain("Austin Office");
    expect(html).toContain("Last discovery 4m ago");
    expect(html).toContain("text-[var(--dpf-text)]");
    expect(html).toContain("border-[var(--dpf-border)]");
  });

  it("makes internal MSP topology explicit", () => {
    const html = renderToStaticMarkup(
      <CustomerTopologyScopeBar scopeLabel="MSP Internal" mode="organization-internal" />,
    );

    expect(html).toContain("MSP Internal");
    expect(html).toContain("Internal estate");
  });
});
```

Run:

```powershell
pnpm --filter web exec vitest run components/inventory/CustomerTopologyScopeBar.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the scope bar**

Create `apps/web/components/inventory/CustomerTopologyScopeBar.tsx`:

```tsx
import { Building2, Network, ShieldCheck } from "lucide-react";

type Props = {
  mode: "organization-internal" | "customer-account" | "customer-site";
  scopeLabel: string;
  siteLabel?: string | null;
  edgeNodeLabel?: string | null;
  lastRunLabel?: string | null;
};

export function CustomerTopologyScopeBar({
  mode,
  scopeLabel,
  siteLabel,
  edgeNodeLabel,
  lastRunLabel,
}: Props) {
  const modeLabel = mode === "organization-internal" ? "Internal estate" : "Customer estate";

  return (
    <div className="flex flex-wrap items-center gap-3 border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 text-[var(--dpf-text)]">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {mode === "organization-internal" ? <Building2 size={16} /> : <ShieldCheck size={16} />}
        <span>{scopeLabel}</span>
      </div>
      <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
        {modeLabel}
      </span>
      {siteLabel ? (
        <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
          {siteLabel}
        </span>
      ) : null}
      {edgeNodeLabel ? (
        <span className="inline-flex items-center gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
          <Network size={14} />
          {edgeNodeLabel}
        </span>
      ) : null}
      {lastRunLabel ? <span className="ml-auto text-xs text-[var(--dpf-muted)]">{lastRunLabel}</span> : null}
    </div>
  );
}
```

- [ ] **Step 3: Make the global discovery page explicit**

Modify `apps/web/components/inventory/DiscoveryOperationsPage.tsx` so the global page labels the existing graph as internal/global exploration and does not imply it is a customer estate view. Add `CustomerTopologyScopeBar` above the existing `TopologyGraph` call with:

```tsx
<CustomerTopologyScopeBar
  mode="organization-internal"
  scopeLabel="MSP Internal"
  lastRunLabel="Global discovery view"
/>
```

Do not add customer selection to this page in this task. Customer topology entry belongs under customer/site routes after scoped persistence is in place.

When the customer/site route is added, render the `Network` tab only if `canUseCustomerNetworkTopology(profile)` returns true. For non-MSP archetypes such as salons or retail shops, do not render the tab, do not show an empty-state upsell, and do not expose a customer topology action through command menus. Those businesses can still use organization-internal inventory/posture surfaces where applicable.

- [ ] **Step 4: Run component tests**

Run:

```powershell
pnpm --filter web exec vitest run components/inventory/CustomerTopologyScopeBar.test.tsx
pnpm --filter web exec vitest run lib/customer-estate/topology-applicability.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/components/inventory/CustomerTopologyScopeBar.tsx apps/web/components/inventory/CustomerTopologyScopeBar.test.tsx apps/web/components/inventory/DiscoveryOperationsPage.tsx
git commit -s -m "feat(inventory): show explicit topology scope context"
```

## Task 8: Refactor Graph Styling Away From Server Hex Values

**Files:**
- Modify: `apps/web/lib/actions/graph.ts`
- Modify: `apps/web/components/inventory/TopologyGraph.tsx`
- Create: `apps/web/lib/graph/graph-style-tokens.ts`
- Create: `apps/web/lib/graph/graph-style-tokens.test.ts`

- [ ] **Step 1: Write style-token tests**

Create `apps/web/lib/graph/graph-style-tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { resolveGraphColorRole } from "./graph-style-tokens";

describe("resolveGraphColorRole", () => {
  it("maps graph labels and statuses to semantic color roles", () => {
    expect(resolveGraphColorRole({ label: "InfraCI", status: "offline" })).toBe("danger");
    expect(resolveGraphColorRole({ label: "InfraCI", status: "degraded" })).toBe("warning");
    expect(resolveGraphColorRole({ label: "DigitalProduct", status: "active" })).toBe("success");
    expect(resolveGraphColorRole({ label: "Portfolio" })).toBe("accent");
  });
});
```

Run:

```powershell
pnpm --filter web exec vitest run lib/graph/graph-style-tokens.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Implement style-token helper**

Create `apps/web/lib/graph/graph-style-tokens.ts`:

```ts
export type GraphColorRole = "accent" | "success" | "warning" | "danger" | "info" | "muted";

export function resolveGraphColorRole(input: {
  label: string;
  status?: string | null;
}): GraphColorRole {
  if (input.status === "offline") return "danger";
  if (input.status === "degraded") return "warning";
  if (input.status === "active" || input.status === "operational") return "success";
  if (input.label === "Portfolio" || input.label === "Agent") return "accent";
  if (input.label === "InfraCI") return "info";
  return "muted";
}
```

- [ ] **Step 3: Change `GraphData` to carry color roles**

In `apps/web/lib/actions/graph.ts`, add `colorRole` while keeping `color` temporarily for compatibility:

```ts
colorRole?: "accent" | "success" | "warning" | "danger" | "info" | "muted";
```

Set `colorRole` from `resolveGraphColorRole()` in server mapping. Leave existing `color` fields during this task so the renderer does not break.

- [ ] **Step 4: Resolve roles in `TopologyGraph`**

In `TopologyGraph.tsx`, resolve `node.colorRole` through CSS variables before drawing:

```ts
function resolveCanvasColor(role: string | undefined, fallback: string): string {
  if (typeof window === "undefined" || !role) return fallback;
  const styles = getComputedStyle(document.documentElement);
  const token =
    role === "success" ? "--dpf-success" :
    role === "warning" ? "--dpf-warning" :
    role === "danger" ? "--dpf-danger" :
    role === "info" ? "--dpf-accent" :
    role === "accent" ? "--dpf-accent" :
    "--dpf-muted";
  return styles.getPropertyValue(token).trim() || fallback;
}
```

Use `resolveCanvasColor(node.colorRole, node.color)` where the canvas fill/stroke is set.

- [ ] **Step 5: Run graph tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/graph/graph-style-tokens.test.ts components/inventory/TopologyGraph.test.tsx components/inventory/__tests__/TopologyGraph.subnet.test.tsx
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/actions/graph.ts apps/web/components/inventory/TopologyGraph.tsx apps/web/lib/graph/graph-style-tokens.ts apps/web/lib/graph/graph-style-tokens.test.ts
git commit -s -m "refactor(graph): use semantic topology color roles"
```

## Task 9: Verification And PR Readiness

**Files:**
- All changed files.

- [ ] **Step 1: Run focused db tests**

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/discovery-scope.test.ts src/discovery-identity.test.ts src/discovery-normalize.test.ts src/discovery-sync.test.ts src/persist-submitted-discovery-run.test.ts src/neo4j-sync.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/graph.customer-scope.test.ts components/inventory/CustomerTopologyScopeBar.test.tsx lib/graph/graph-style-tokens.test.ts components/inventory/TopologyGraph.test.tsx components/inventory/__tests__/TopologyGraph.subnet.test.tsx
pnpm --filter web exec vitest run lib/customer-estate/topology-applicability.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typechecks**

Run:

```powershell
pnpm --filter @dpf/db typecheck
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```powershell
pnpm --filter web build
```

Expected: PASS with zero TypeScript or Next.js build errors.

- [ ] **Step 5: Verify migration applies**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate deploy
```

Expected: PASS. If local dev database already applied the migration through `migrate dev`, deploy reports no unapplied migrations.

- [ ] **Step 6: UX verification**

Use the Docker-served app, not a stale dev server.

1. Rebuild and start the portal if code changed:

   ```powershell
   docker compose build --no-cache portal portal-init sandbox
   docker compose up -d portal portal-init sandbox
   ```

2. Log in as `admin@dpf.local` using `ADMIN_PASSWORD` from repo-root `.env`.
3. Open `/platform/tools/discovery`.
4. Confirm the topology panel shows the internal/MSP scope bar and does not imply it is a customer estate view.
5. Confirm a non-MSP archetype profile such as hair salon does not expose a customer/site `Network` tab or customer topology action.
6. Seed or submit two synthetic scoped discovery runs with the same `arp:192.168.1.1` under two different customer/site scopes.
7. Confirm the DB has two distinct `InventoryEntity.entityKey` rows, one per customer scope.
8. Confirm the customer-scoped graph action only returns the selected customer's scoped node.

- [ ] **Step 7: Final commit if verification fixes were needed**

```powershell
git status --short
git add <verified changed files>
git commit -s -m "test(topology): verify customer scope isolation"
```

- [ ] **Step 8: Push branch**

```powershell
git push -u origin doc/customer-topology-isolation
```

Expected: branch is on GitHub and recoverable.

- [ ] **Step 9: Open PR only when ready**

Open a PR against `main` only after all relevant verification above passes. PR title:

```text
feat(topology): isolate customer estate inventory scopes
```

PR body must include:

```markdown
## Summary
- scopes discovery identity and stale detection for MSP customer estate topology
- persists customer/site scope on inventory entities, relationships, and Neo4j projections
- adds MSP-capability topology gating, explicit topology scope UI, and duplicate-private-IP regression tests

## Verification
- pnpm --filter @dpf/db exec vitest run ...
- pnpm --filter web exec vitest run ...
- pnpm --filter @dpf/db typecheck
- pnpm --filter web typecheck
- pnpm --filter web build
- pnpm --filter @dpf/db exec prisma migrate deploy
- Docker-served UI: /platform/tools/discovery scope bar verified
- Docker-served UI: non-MSP customer/site navigation has no customer topology surface
```

## Self-Review

Spec coverage:

- Duplicate private IPs: Tasks 1, 2, 4, 6.
- Customer/site edge-derived scope: Tasks 2 and 4.
- Inventory and relationship persistence: Tasks 3 and 4.
- Scope-local stale detection: Task 4.
- Neo4j and topology graph filtering: Tasks 5 and 6.
- UI scope clarity and theme-aware design: Tasks 7 and 8.
- MSP-only topology applicability: Task 0 and Task 7.
- Refactoring capacity: Tasks 0, 1, 4, 7, and 8.

Placeholder scan:

- No implementation step depends on placeholder text or an undefined future design.
- Test snippets include concrete mock shapes and expected assertions.

Type consistency:

- `DiscoveryScopeContext`, `scopeKey`, `customerAccountId`, and `customerSiteId` are used consistently across normalize, sync, graph projection, and UI scope display.
