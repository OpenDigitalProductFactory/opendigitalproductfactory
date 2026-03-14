# Bootstrap Infrastructure Discovery and Portfolio Quality Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first DPF-native bootstrap discovery slice so a fresh install automatically discovers its local host/runtime environment, persists normalized inventory records, projects them into Neo4j, and surfaces attribution and freshness quality in the inventory experience.

**Architecture:** Add a PostgreSQL-backed discovery and normalized inventory layer in Prisma rather than writing directly to Neo4j. Implement small local collectors for host, Docker, and Kubernetes facts, then normalize those results into inventory entities and relationships with deterministic identity keys and quality statuses. Reuse the existing Neo4j `InfraCI` projection path where possible, and keep the first UI slice additive on top of the current `/inventory` route.

**Tech Stack:** Prisma 5, PostgreSQL, TypeScript, Vitest, Next.js App Router, React 18, Neo4j 5, Node.js built-in OS/process APIs

---

## Scope Guard

This plan implements only the approved first slice from the spec:

- bootstrap discovery run tracking
- local host, Docker, and Kubernetes collectors
- discovered-item and discovered-relationship persistence
- normalized inventory entities and relationships
- foundational portfolio default attribution
- taxonomy/digital-product attribution states
- stale and quality issue tracking
- inventory route visibility for discovery results

This plan does **not** implement:

- remote customer network discovery
- SNMP, WMI, or SSH topology scanning
- external discovery tool connectors
- enterprise reconciliation policy
- event management
- provider-side workflow automation for issue review

---

## File Structure

### Database and persistence layer

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260313193000_bootstrap_discovery_foundation/migration.sql`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/src/discovery-model.test.ts`
- Create: `packages/db/src/discovery-identity.ts`
- Create: `packages/db/src/discovery-identity.test.ts`

### Discovery collection and normalization

- Create: `packages/db/src/discovery-types.ts`
- Create: `packages/db/src/discovery-collectors/host.ts`
- Create: `packages/db/src/discovery-collectors/docker.ts`
- Create: `packages/db/src/discovery-collectors/kubernetes.ts`
- Create: `packages/db/src/discovery-collectors/index.ts`
- Create: `packages/db/src/discovery-normalize.ts`
- Create: `packages/db/src/discovery-normalize.test.ts`
- Create: `packages/db/src/discovery-runner.ts`
- Create: `packages/db/src/discovery-runner.test.ts`

### Attribution, quality, and graph projection

- Create: `packages/db/src/discovery-attribution.ts`
- Create: `packages/db/src/discovery-attribution.test.ts`
- Modify: `packages/db/src/neo4j-sync.ts`
- Create: `packages/db/src/discovery-sync.ts`
- Create: `packages/db/src/discovery-sync.test.ts`

### Web data and route integration

- Create: `apps/web/lib/discovery-data.ts`
- Create: `apps/web/lib/discovery-data.test.ts`
- Create: `apps/web/lib/actions/discovery.ts`
- Create: `apps/web/lib/actions/discovery.test.ts`
- Create: `apps/web/components/inventory/DiscoveryRunSummary.tsx`
- Create: `apps/web/components/inventory/InventoryEntityPanel.tsx`
- Create: `apps/web/components/inventory/PortfolioQualityIssuesPanel.tsx`
- Create: `apps/web/app/(shell)/inventory/page.test.tsx`
- Modify: `apps/web/app/(shell)/inventory/page.tsx`

### Documentation

- Modify: `docs/superpowers/specs/2026-03-13-bootstrap-infrastructure-discovery-and-portfolio-quality-foundation-design.md`

---

## Chunk 1: Discovery Schema Foundation

### Task 1: Add discovery and normalized inventory Prisma models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260313193000_bootstrap_discovery_foundation/migration.sql`
- Create: `packages/db/src/discovery-model.test.ts`
- Modify: `docs/superpowers/specs/2026-03-13-bootstrap-infrastructure-discovery-and-portfolio-quality-foundation-design.md`

- [ ] **Step 1: Add a spec implementation note**

Append this note near the top of the spec:

```md
Implementation slice 1 persistence models:
- DiscoveryRun
- DiscoveredItem
- DiscoveredRelationship
- InventoryEntity
- InventoryRelationship
- PortfolioQualityIssue
```

- [ ] **Step 2: Write a failing DB model smoke test**

Create `packages/db/src/discovery-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/client";

describe("bootstrap discovery Prisma model names", () => {
  it("exposes the new discovery model delegates", () => {
    expect(Prisma.ModelName.DiscoveryRun).toBe("DiscoveryRun");
    expect(Prisma.ModelName.InventoryEntity).toBe("InventoryEntity");
    expect(Prisma.ModelName.PortfolioQualityIssue).toBe("PortfolioQualityIssue");
  });
});
```

- [ ] **Step 3: Run DB tests to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test
```

Expected: FAIL because the Prisma client does not yet know those model names.

- [ ] **Step 4: Add Prisma models and enums**

Update `packages/db/prisma/schema.prisma` with:

```prisma
model DiscoveryRun { ... }
model DiscoveredItem { ... }
model DiscoveredRelationship { ... }
model InventoryEntity { ... }
model InventoryRelationship { ... }
model PortfolioQualityIssue { ... }
```

Also add enums or constrained string fields for:

- discovery run status
- inventory attribution status
- inventory quality status
- quality issue severity
- quality issue status

Required relations:

- `InventoryEntity.portfolio` → `Portfolio`
- `InventoryEntity.taxonomyNode` → `TaxonomyNode`
- `InventoryEntity.digitalProduct` → `DigitalProduct`
- `PortfolioQualityIssue.portfolio` → `Portfolio`
- `PortfolioQualityIssue.taxonomyNode` → `TaxonomyNode`
- `PortfolioQualityIssue.digitalProduct` → `DigitalProduct`
- `DiscoveredItem.inventoryEntity` → `InventoryEntity`
- `InventoryEntity.lastConfirmedRun` → `DiscoveryRun`
- `InventoryRelationship.lastConfirmedRun` → `DiscoveryRun`

Use indexes on:

- `DiscoveryRun.startedAt`
- `DiscoveredItem.discoveredKey`
- `InventoryEntity.entityKey`
- `InventoryEntity.lastSeenAt`
- `InventoryEntity.portfolioId`
- `InventoryEntity.taxonomyNodeId`
- `PortfolioQualityIssue.status`
- `PortfolioQualityIssue.portfolioId`

- [ ] **Step 5: Create the SQL migration**

Write `packages/db/prisma/migrations/20260313193000_bootstrap_discovery_foundation/migration.sql` with explicit `CREATE TABLE`, `CREATE TYPE` or text-column constraints, indexes, and foreign keys matching the Prisma schema.

- [ ] **Step 6: Validate the schema**

Run:

```bash
$env:DATABASE_URL='postgresql://dpf:dpf_dev@localhost:5432/dpf'; pnpm --filter @dpf/db exec prisma validate --schema prisma/schema.prisma
```

Expected: `The schema at prisma/schema.prisma is valid`

- [ ] **Step 7: Regenerate the Prisma client**

Run:

```bash
pnpm --filter @dpf/db generate
```

Expected: PASS

- [ ] **Step 8: Re-run the DB tests**

Run:

```bash
pnpm --filter @dpf/db test
```

Expected: the new model smoke test passes along with the existing DB tests.

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260313193000_bootstrap_discovery_foundation/migration.sql packages/db/src/discovery-model.test.ts docs/superpowers/specs/2026-03-13-bootstrap-infrastructure-discovery-and-portfolio-quality-foundation-design.md
git commit -m "feat(db): add bootstrap discovery schema"
```

### Task 2: Add deterministic discovery identity helpers

**Files:**
- Create: `packages/db/src/discovery-identity.ts`
- Create: `packages/db/src/discovery-identity.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing tests for discovery key generation**

Create `packages/db/src/discovery-identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDiscoveredKey, buildInventoryEntityKey } from "./discovery-identity";

describe("buildDiscoveredKey", () => {
  it("creates a stable key for a docker container by runtime id", () => {
    expect(buildDiscoveredKey({
      sourceKind: "dpf_bootstrap",
      itemType: "docker_container",
      externalRef: "container:abc123",
    })).toBe("dpf_bootstrap:docker_container:container:abc123");
  });
});

describe("buildInventoryEntityKey", () => {
  it("normalizes host identity into a stable inventory key", () => {
    expect(buildInventoryEntityKey({
      entityType: "host",
      naturalKey: "hostname:dpf-dev",
    })).toBe("host:hostname:dpf-dev");
  });
});
```

- [ ] **Step 2: Run the targeted DB test to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-identity.test.ts
```

Expected: FAIL because `discovery-identity.ts` does not exist yet.

- [ ] **Step 3: Implement minimal identity helpers**

Create `packages/db/src/discovery-identity.ts` with:

- `buildDiscoveredKey(input)`
- `buildInventoryEntityKey(input)`
- optional tiny helpers for lowercasing or trimming if required

Keep these pure and deterministic.

- [ ] **Step 4: Export helpers if needed**

Update `packages/db/src/index.ts` only if other packages or scripts need these helpers exported.

- [ ] **Step 5: Re-run the targeted DB test**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-identity.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/discovery-identity.ts packages/db/src/discovery-identity.test.ts packages/db/src/index.ts
git commit -m "feat(db): add discovery identity helpers"
```

---

## Chunk 2: Collectors and Normalization

### Task 3: Add typed local collector contracts

**Files:**
- Create: `packages/db/src/discovery-types.ts`
- Create: `packages/db/src/discovery-collectors/host.ts`
- Create: `packages/db/src/discovery-collectors/docker.ts`
- Create: `packages/db/src/discovery-collectors/kubernetes.ts`
- Create: `packages/db/src/discovery-collectors/index.ts`
- Create: `packages/db/src/discovery-runner.test.ts`

- [ ] **Step 1: Write a failing runner-shape test**

Create `packages/db/src/discovery-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeCollectorOutputs } from "./discovery-runner";

describe("mergeCollectorOutputs", () => {
  it("combines collector outputs without dropping items or relationships", () => {
    const result = mergeCollectorOutputs([
      { items: [{ itemType: "host", name: "dpf-dev" }], relationships: [] },
      { items: [{ itemType: "docker_runtime", name: "docker" }], relationships: [{ relationshipType: "hosts" }] },
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the targeted DB test to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-runner.test.ts
```

Expected: FAIL because `discovery-runner.ts` does not exist yet.

- [ ] **Step 3: Add the shared discovery types**

Create `packages/db/src/discovery-types.ts` defining:

- `DiscoveredFact`
- `DiscoveredEdge`
- `CollectorOutput`
- `CollectorContext`
- `CollectorName`

Keep the file focused on shapes only.

- [ ] **Step 4: Add minimal collector modules**

Create:

- `packages/db/src/discovery-collectors/host.ts`
- `packages/db/src/discovery-collectors/docker.ts`
- `packages/db/src/discovery-collectors/kubernetes.ts`
- `packages/db/src/discovery-collectors/index.ts`

For now the collectors may return minimal empty or stubbed outputs, but they must expose a consistent function signature:

```ts
export async function collectHostFacts(ctx: CollectorContext): Promise<CollectorOutput> { ... }
```

- [ ] **Step 5: Add the runner merge helper**

Create `packages/db/src/discovery-runner.ts` with:

- `mergeCollectorOutputs(outputs)`

Do not implement DB writes yet.

- [ ] **Step 6: Re-run the targeted DB test**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-runner.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/discovery-types.ts packages/db/src/discovery-collectors/host.ts packages/db/src/discovery-collectors/docker.ts packages/db/src/discovery-collectors/kubernetes.ts packages/db/src/discovery-collectors/index.ts packages/db/src/discovery-runner.ts packages/db/src/discovery-runner.test.ts
git commit -m "feat(db): add bootstrap discovery collector contracts"
```

### Task 4: Normalize collector output into inventory-ready records

**Files:**
- Create: `packages/db/src/discovery-normalize.ts`
- Create: `packages/db/src/discovery-normalize.test.ts`
- Modify: `packages/db/src/discovery-runner.ts`

- [ ] **Step 1: Write failing tests for normalization and default attribution**

Create `packages/db/src/discovery-normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeDiscoveredFacts } from "./discovery-normalize";

describe("normalizeDiscoveredFacts", () => {
  it("defaults discovered host infrastructure into the Foundational portfolio", () => {
    const result = normalizeDiscoveredFacts({
      items: [
        {
          sourceKind: "dpf_bootstrap",
          itemType: "host",
          name: "dpf-dev",
          externalRef: "hostname:dpf-dev",
          attributes: { hostname: "dpf-dev" },
        },
      ],
      relationships: [],
    });

    expect(result.inventoryEntities[0]?.portfolioSlug).toBe("foundational");
    expect(result.inventoryEntities[0]?.attributionStatus).toBe("attributed");
  });
});
```

- [ ] **Step 2: Run the targeted DB test to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-normalize.test.ts
```

Expected: FAIL because `discovery-normalize.ts` does not exist yet.

- [ ] **Step 3: Implement minimal normalization**

Create `packages/db/src/discovery-normalize.ts` with:

- `normalizeDiscoveredFacts(output)`
- deterministic identity-key usage via `discovery-identity.ts`
- simple entity type mapping
- default foundational attribution for host/runtime/platform infrastructure
- placeholder attribution statuses for uncertain items

Keep this pure. No Prisma calls.

- [ ] **Step 4: Re-run the targeted DB test**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-normalize.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/discovery-normalize.ts packages/db/src/discovery-normalize.test.ts packages/db/src/discovery-runner.ts
git commit -m "feat(db): add discovery normalization rules"
```

### Task 5: Implement local collectors for host, Docker, and Kubernetes

**Files:**
- Modify: `packages/db/src/discovery-collectors/host.ts`
- Modify: `packages/db/src/discovery-collectors/docker.ts`
- Modify: `packages/db/src/discovery-collectors/kubernetes.ts`
- Modify: `packages/db/src/discovery-collectors/index.ts`
- Modify: `packages/db/src/discovery-runner.ts`
- Modify: `packages/db/src/discovery-runner.test.ts`

- [ ] **Step 1: Extend the failing runner tests with collector behavior**

Add tests covering:

- host collector returns at least one host fact
- Docker collector returns an empty output rather than throwing when Docker is unavailable
- Kubernetes collector returns an empty output rather than throwing when Kubernetes is unavailable

Use dependency injection where possible instead of mocking global process state.

- [ ] **Step 2: Run the targeted test to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-runner.test.ts
```

Expected: FAIL because collectors still return stub output.

- [ ] **Step 3: Implement the host collector**

In `packages/db/src/discovery-collectors/host.ts`, use Node built-ins such as:

- `node:os`
- `node:fs`
- `node:process`

Capture only the approved slice:

- hostname
- platform / release
- CPU count
- total memory
- network interfaces

- [ ] **Step 4: Implement the Docker collector**

In `packages/db/src/discovery-collectors/docker.ts`, call the Docker socket or CLI in a minimal, failure-tolerant way.

Implementation rule:

- if Docker is unreachable, return `{ items: [], relationships: [], warnings: [...] }`
- do not throw for “Docker not installed” in slice 1

Capture at minimum:

- runtime presence
- running containers
- container names / IDs
- published ports where visible

- [ ] **Step 5: Implement the Kubernetes collector**

In `packages/db/src/discovery-collectors/kubernetes.ts`, attempt in-cluster or kubeconfig discovery only when detectable.

Implementation rule:

- if cluster access is missing, return empty output with warnings
- do not assume `kubectl` exists

Capture at minimum:

- namespace and pod facts when available

- [ ] **Step 6: Wire the runner**

Update `packages/db/src/discovery-runner.ts` to expose:

- `runBootstrapCollectors(ctx)`

This should call host always, Docker opportunistically, and Kubernetes opportunistically.

- [ ] **Step 7: Re-run the targeted test**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-runner.test.ts
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/discovery-collectors/host.ts packages/db/src/discovery-collectors/docker.ts packages/db/src/discovery-collectors/kubernetes.ts packages/db/src/discovery-collectors/index.ts packages/db/src/discovery-runner.ts packages/db/src/discovery-runner.test.ts
git commit -m "feat(db): implement local bootstrap discovery collectors"
```

---

## Chunk 3: Persistence, Quality, and Graph Projection

### Task 6: Persist discovery runs and normalize them into inventory records

**Files:**
- Create: `packages/db/src/discovery-sync.ts`
- Create: `packages/db/src/discovery-sync.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing persistence tests**

Create `packages/db/src/discovery-sync.test.ts` with pure and mocked persistence tests such as:

```ts
import { describe, expect, it, vi } from "vitest";
import { summarizeDiscoveryPersistence } from "./discovery-sync";

describe("summarizeDiscoveryPersistence", () => {
  it("reports created, updated, and stale counts", () => {
    expect(summarizeDiscoveryPersistence({
      createdEntities: 2,
      updatedEntities: 3,
      staleEntities: 1,
      createdIssues: 1,
    })).toMatchObject({
      createdEntities: 2,
      staleEntities: 1,
    });
  });
});
```

- [ ] **Step 2: Run the targeted DB test to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-sync.test.ts
```

Expected: FAIL because `discovery-sync.ts` does not exist yet.

- [ ] **Step 3: Implement the persistence service**

Create `packages/db/src/discovery-sync.ts` with:

- `summarizeDiscoveryPersistence(...)`
- `persistBootstrapDiscoveryRun(prisma, normalized, runMeta)`

Rules:

- create a `DiscoveryRun`
- persist `DiscoveredItem` and `DiscoveredRelationship`
- upsert `InventoryEntity` and `InventoryRelationship`
- refresh `lastSeenAt` and `lastConfirmedRunId`
- mark previously seen but currently absent entities/relationships as stale

Use transactions where appropriate.

- [ ] **Step 4: Export helpers if needed**

Update `packages/db/src/index.ts` minimally if the discovery service needs package exports.

- [ ] **Step 5: Re-run the targeted DB test**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-sync.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/discovery-sync.ts packages/db/src/discovery-sync.test.ts packages/db/src/index.ts
git commit -m "feat(db): persist bootstrap discovery runs"
```

### Task 7: Add attribution and quality issue evaluation

**Files:**
- Create: `packages/db/src/discovery-attribution.ts`
- Create: `packages/db/src/discovery-attribution.test.ts`
- Modify: `packages/db/src/discovery-sync.ts`

- [ ] **Step 1: Write failing attribution tests**

Create `packages/db/src/discovery-attribution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateInventoryQuality } from "./discovery-attribution";

describe("evaluateInventoryQuality", () => {
  it("creates a needs-review issue for an unmapped runtime entity", () => {
    const result = evaluateInventoryQuality([
      {
        entityKey: "service:dpf-web",
        entityType: "service",
        attributionStatus: "needs_review",
        taxonomyNodeId: null,
        digitalProductId: null,
        qualityStatus: "warning",
      },
    ]);

    expect(result.issues[0]?.issueType).toBe("attribution_missing");
  });
});
```

- [ ] **Step 2: Run the targeted DB test to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-attribution.test.ts
```

Expected: FAIL because `discovery-attribution.ts` does not exist yet.

- [ ] **Step 3: Implement quality evaluation**

Create `packages/db/src/discovery-attribution.ts` with:

- `evaluateInventoryQuality(entities, relationships?)`
- issue generation for:
  - missing taxonomy attribution
  - missing digital-product attribution
  - stale entity
  - stale relationship

Keep the first implementation deterministic and rule-based. No policy engine yet.

- [ ] **Step 4: Wire quality issue creation into persistence**

Update `packages/db/src/discovery-sync.ts` so `persistBootstrapDiscoveryRun(...)` creates or updates `PortfolioQualityIssue` rows from `evaluateInventoryQuality(...)`.

- [ ] **Step 5: Re-run the targeted DB test**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-attribution.test.ts src/discovery-sync.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/discovery-attribution.ts packages/db/src/discovery-attribution.test.ts packages/db/src/discovery-sync.ts
git commit -m "feat(db): add discovery attribution quality evaluation"
```

### Task 8: Project normalized inventory into Neo4j

**Files:**
- Modify: `packages/db/src/neo4j-sync.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/discovery-sync.ts`

- [ ] **Step 1: Write a failing graph projection test**

Extend `packages/db/src/discovery-sync.test.ts` or add a focused Neo4j sync test that proves:

- an inventory entity becomes an `InfraCI`
- a foundational entity creates the portfolio edge
- an inventory relationship can project to `DEPENDS_ON` or another approved relationship

Use mocks around `runCypher`.

- [ ] **Step 2: Run the targeted DB test to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-sync.test.ts
```

Expected: FAIL because inventory projection does not yet call Neo4j sync for the new records.

- [ ] **Step 3: Extend Neo4j sync helpers carefully**

Modify `packages/db/src/neo4j-sync.ts` to add a small inventory projection adapter such as:

- `syncInventoryEntityAsInfraCI(...)`
- `syncInventoryRelationship(...)`

Rules:

- reuse existing `syncInfraCI` and `syncDependsOn` where possible
- do not duplicate graph vocabulary if the existing `InfraCI` shape already fits
- support `BELONGS_TO` foundational portfolio projection

- [ ] **Step 4: Call the projection from discovery persistence**

Update `packages/db/src/discovery-sync.ts` so successful inventory upserts trigger Neo4j projection in the same style used elsewhere in the repo.

- [ ] **Step 5: Re-run the targeted DB test**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-sync.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/neo4j-sync.ts packages/db/src/index.ts packages/db/src/discovery-sync.ts packages/db/src/discovery-sync.test.ts
git commit -m "feat(db): project bootstrap inventory into neo4j"
```

---

## Chunk 4: Web Data and Inventory Route

### Task 9: Add discovery read models and rerun action

**Files:**
- Create: `apps/web/lib/discovery-data.ts`
- Create: `apps/web/lib/discovery-data.test.ts`
- Create: `apps/web/lib/actions/discovery.ts`
- Create: `apps/web/lib/actions/discovery.test.ts`

- [ ] **Step 1: Write failing read-model tests**

Create `apps/web/lib/discovery-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeDiscoveryHealth } from "./discovery-data";

describe("summarizeDiscoveryHealth", () => {
  it("summarizes inventory freshness and unresolved quality issues", () => {
    expect(summarizeDiscoveryHealth({
      totalEntities: 12,
      staleEntities: 2,
      openIssues: 3,
    })).toEqual({
      totalEntities: 12,
      staleEntities: 2,
      openIssues: 3,
    });
  });
});
```

- [ ] **Step 2: Run the targeted web test to confirm failure**

Run:

```bash
pnpm --filter web test -- lib/discovery-data.test.ts
```

Expected: FAIL because `discovery-data.ts` does not exist yet.

- [ ] **Step 3: Implement the web data helper**

Create `apps/web/lib/discovery-data.ts` with:

- `summarizeDiscoveryHealth(...)`
- `getLatestDiscoveryRun()`
- `getInventoryEntitiesForPage()`
- `getOpenPortfolioQualityIssues()`

Keep this as a read-model adapter over Prisma only.

- [ ] **Step 4: Add a governed rerun action**

Create `apps/web/lib/actions/discovery.ts` with:

- `triggerBootstrapDiscovery()`

Rules:

- require authenticated user
- gate on an existing admin/platform capability already present in `permissions.ts`
- record a graceful error if the rerun cannot execute

Write `apps/web/lib/actions/discovery.test.ts` first with at least one permission-denial test.

- [ ] **Step 5: Re-run the targeted web tests**

Run:

```bash
pnpm --filter web test -- lib/discovery-data.test.ts lib/actions/discovery.test.ts
pnpm --filter web typecheck
```

Expected: PASS and 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/discovery-data.ts apps/web/lib/discovery-data.test.ts apps/web/lib/actions/discovery.ts apps/web/lib/actions/discovery.test.ts
git commit -m "feat(web): add discovery read models and rerun action"
```

### Task 10: Extend the inventory route with discovery and quality panels

**Files:**
- Create: `apps/web/components/inventory/DiscoveryRunSummary.tsx`
- Create: `apps/web/components/inventory/InventoryEntityPanel.tsx`
- Create: `apps/web/components/inventory/PortfolioQualityIssuesPanel.tsx`
- Create: `apps/web/app/(shell)/inventory/page.test.tsx`
- Modify: `apps/web/app/(shell)/inventory/page.tsx`

- [ ] **Step 1: Write a failing route-level test**

Create `apps/web/app/(shell)/inventory/page.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscoveryRunSummary } from "@/components/inventory/DiscoveryRunSummary";

describe("DiscoveryRunSummary", () => {
  it("renders latest discovery run counts", () => {
    const html = renderToStaticMarkup(
      <DiscoveryRunSummary
        run={{ runId: "DISC-001", status: "completed", environmentType: "mixed" }}
        summary={{ totalEntities: 8, staleEntities: 1, openIssues: 2 }}
      />,
    );

    expect(html).toContain("DISC-001");
    expect(html).toContain("stale");
    expect(html).toContain("open issues");
  });
});
```

- [ ] **Step 2: Run the targeted web test to confirm failure**

Run:

```bash
pnpm --filter web test -- "app/(shell)/inventory/page.test.tsx"
```

Expected: FAIL because the new inventory panel components do not exist yet.

- [ ] **Step 3: Implement focused presentation components**

Create:

- `DiscoveryRunSummary.tsx`
- `InventoryEntityPanel.tsx`
- `PortfolioQualityIssuesPanel.tsx`

Display at minimum:

- latest discovery run status
- total entities and stale entities
- foundational/default attribution visibility
- unresolved quality issues

- [ ] **Step 4: Update the route**

Modify `apps/web/app/(shell)/inventory/page.tsx` to load, in parallel:

- existing product inventory data
- latest discovery run summary
- normalized inventory entities
- open quality issues

Keep the current product cards. Add the discovery panels above or beside them. Do not redesign the whole route.

- [ ] **Step 5: Re-run the targeted inventory tests**

Run:

```bash
pnpm --filter web test -- "app/(shell)/inventory/page.test.tsx" lib/discovery-data.test.ts
pnpm --filter web typecheck
```

Expected: PASS and 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/inventory/DiscoveryRunSummary.tsx apps/web/components/inventory/InventoryEntityPanel.tsx apps/web/components/inventory/PortfolioQualityIssuesPanel.tsx apps/web/app/(shell)/inventory/page.test.tsx apps/web/app/(shell)/inventory/page.tsx
git commit -m "feat(web): show bootstrap discovery inventory quality"
```

---

## Chunk 5: Bootstrap Trigger and Verification

### Task 11: Wire the automatic bootstrap entry point

**Files:**
- Modify: `apps/web/lib/actions/discovery.ts`
- Modify: `packages/db/src/discovery-runner.ts`
- Modify: `packages/db/src/discovery-sync.ts`
- Modify: `apps/web/app/(shell)/layout.tsx` or another existing startup path only if justified

- [ ] **Step 1: Write a failing integration-focused test**

Extend `apps/web/lib/actions/discovery.test.ts` or `packages/db/src/discovery-runner.test.ts` with a test proving that the bootstrap entry point:

- creates a run
- persists entities
- returns a stable summary object

Use mocks for the collectors and Prisma writes.

- [ ] **Step 2: Run the targeted test to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-runner.test.ts
pnpm --filter web test -- lib/actions/discovery.test.ts
```

Expected: FAIL because the full orchestration path is not yet wired.

- [ ] **Step 3: Implement the orchestration path**

Expose a single bootstrap orchestration function such as:

- `executeBootstrapDiscovery(prisma, options?)`

Then have the web action call it.

For automatic trigger placement:

- prefer an existing startup or initialization hook already used by the app
- if no safe app-start hook exists, implement a guarded “first manual page hit” bootstrap trigger in a server path with idempotency checks

Do **not** invent a background scheduler subsystem in this slice.

- [ ] **Step 4: Re-run the targeted tests**

Run:

```bash
pnpm --filter @dpf/db test -- src/discovery-runner.test.ts src/discovery-sync.test.ts
pnpm --filter web test -- lib/actions/discovery.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/discovery-runner.ts packages/db/src/discovery-sync.ts apps/web/lib/actions/discovery.ts apps/web/lib/actions/discovery.test.ts apps/web/app/(shell)/layout.tsx
git commit -m "feat: wire automatic bootstrap discovery trigger"
```

### Task 12: Sync docs and run full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-03-13-bootstrap-infrastructure-discovery-and-portfolio-quality-foundation-design.md`

- [ ] **Step 1: Update spec status**

Add a brief note near the top of the spec:

```md
Implementation status:
- slice 1 delivered: local bootstrap discovery, normalized inventory, foundational attribution, graph projection, quality issue surfacing
- deferred: remote customer discovery, topology expansion, external discovery connectors, full reconciliation
```

- [ ] **Step 2: Run the full DB verification set**

Run:

```bash
pnpm --filter @dpf/db test
pnpm --filter @dpf/db generate
$env:DATABASE_URL='postgresql://dpf:dpf_dev@localhost:5432/dpf'; pnpm --filter @dpf/db exec prisma validate --schema prisma/schema.prisma
```

Expected: PASS

- [ ] **Step 3: Run the full web verification set**

Run:

```bash
pnpm --filter web test
pnpm --filter web typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-03-13-bootstrap-infrastructure-discovery-and-portfolio-quality-foundation-design.md
git commit -m "docs: sync bootstrap discovery spec status"
```

---

## Notes For The Implementer

- Reuse the existing Neo4j `InfraCI` vocabulary and sync helpers wherever possible.
- Keep collector code isolated from attribution and persistence logic.
- Keep taxonomy and digital-product auto-matching intentionally conservative in slice 1.
- Prefer pure normalization and quality helpers with unit tests before any Prisma orchestration.
- Treat missing Docker or Kubernetes access as graceful partial-discovery cases, not hard failures.
- Do not add a large scheduler or policy engine in this slice.
