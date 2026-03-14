# Discovery Taxonomy Attribution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend bootstrap discovery so discovered entities are attributed to taxonomy descriptors with confidence and evidence, while also capturing host/container software evidence and normalized software identities for later license, vulnerability, and technical-debt analysis.

**Architecture:** Keep the existing collector -> normalize -> persist pipeline, but insert two focused layers: taxonomy attribution and software normalization. Add persistence models for attribution metadata, software evidence, software identity, and deterministic normalization rules; then wire discovery sync to persist those results and surface quality issues for low-confidence cases.

**Tech Stack:** Prisma 5, PostgreSQL, TypeScript, Vitest, Next.js App Router, React cache

---

## File Structure

### Database and persistence layer

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_discovery_taxonomy_software_attribution/migration.sql`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/src/discovery-attribution-model.test.ts`

### Discovery attribution and software normalization

- Modify: `packages/db/src/discovery-types.ts`
- Modify: `packages/db/src/discovery-normalize.ts`
- Modify: `packages/db/src/discovery-runner.ts`
- Create: `packages/db/src/discovery-attribution.ts`
- Create: `packages/db/src/discovery-attribution.test.ts`
- Create: `packages/db/src/software-normalization.ts`
- Create: `packages/db/src/software-normalization.test.ts`
- Modify: `packages/db/src/discovery-sync.ts`
- Modify: `packages/db/src/discovery-sync.test.ts`

### Web read layer

- Modify: `apps/web/lib/discovery-data.ts`
- Modify: `apps/web/app/(shell)/inventory/page.tsx`
- Modify: `apps/web/components/inventory/InventoryEntityPanel.tsx`
- Create or Modify: inventory tests if needed for attribution metadata rendering

### Documentation

- Modify: `docs/superpowers/specs/2026-03-14-discovery-taxonomy-attribution-design.md`

---

## Chunk 1: Schema And Model Foundation

### Task 1: Add failing schema delegate expectations

**Files:**
- Create: `packages/db/src/discovery-attribution-model.test.ts`
- Test: `packages/db/src/discovery-attribution-model.test.ts`

- [ ] **Step 1: Write failing model smoke tests**

Create `packages/db/src/discovery-attribution-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/client";

describe("discovery attribution Prisma model names", () => {
  it("exposes software normalization delegates", () => {
    expect(Prisma.ModelName.DiscoveredSoftwareEvidence).toBe("DiscoveredSoftwareEvidence");
    expect(Prisma.ModelName.SoftwareIdentity).toBe("SoftwareIdentity");
    expect(Prisma.ModelName.SoftwareNormalizationRule).toBe("SoftwareNormalizationRule");
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-attribution-model.test.ts
```

Expected: FAIL because the Prisma client does not yet expose those models.

- [ ] **Step 3: Add schema fields and models**

Update `packages/db/prisma/schema.prisma`:

- extend `InventoryEntity` with:
  - `attributionMethod String?`
  - `attributionConfidence Float?`
  - `attributionEvidence Json?`
  - `candidateTaxonomy Json?`
  - relation `softwareEvidence DiscoveredSoftwareEvidence[]`
- add `DiscoveredSoftwareEvidence`
- add `SoftwareIdentity`
- add `SoftwareNormalizationRule`

Model intent:

```prisma
model DiscoveredSoftwareEvidence {
  id                    String   @id @default(cuid())
  inventoryEntityId     String
  inventoryEntity       InventoryEntity @relation(fields: [inventoryEntityId], references: [id], onDelete: Cascade)
  evidenceKey           String   @unique
  evidenceSource        String
  packageManager        String?
  rawVendor             String?
  rawProductName        String?
  rawPackageName        String?
  rawVersion            String?
  installLocation       String?
  rawMetadata           Json?
  normalizationStatus   String   @default("needs_review")
  normalizationConfidence Float?
  softwareIdentityId    String?
  softwareIdentity      SoftwareIdentity? @relation(fields: [softwareIdentityId], references: [id], onDelete: SetNull)
  firstSeenAt           DateTime @default(now())
  lastSeenAt            DateTime @default(now())
}

model SoftwareIdentity {
  id                    String   @id @default(cuid())
  normalizedVendor      String?
  normalizedProductName String
  normalizedEdition     String?
  canonicalVersion      String?
  aliases               Json     @default("[]")
  metadata              Json?
  evidence              DiscoveredSoftwareEvidence[]
  normalizationRules    SoftwareNormalizationRule[]

  @@unique([normalizedProductName, normalizedEdition, canonicalVersion])
}

model SoftwareNormalizationRule {
  id                    String   @id @default(cuid())
  ruleKey               String   @unique
  matchType             String
  rawSignature          String
  versionTransform      Json?
  source                String
  status                String   @default("active")
  softwareIdentityId    String
  softwareIdentity      SoftwareIdentity @relation(fields: [softwareIdentityId], references: [id], onDelete: Cascade)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

- [ ] **Step 4: Create and apply the migration**

Run:

```bash
pnpm --filter @dpf/db exec prisma migrate dev --name discovery_taxonomy_software_attribution
```

Expected: migration created and Prisma client regenerated successfully.

- [ ] **Step 5: Run the model smoke test to verify GREEN**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-attribution-model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/discovery-attribution-model.test.ts
git commit -m "feat(db): add discovery attribution and software identity schema"
```

---

## Chunk 2: Attribution And Software Normalization Logic

### Task 2: Add failing attribution and software normalization tests

**Files:**
- Create: `packages/db/src/discovery-attribution.test.ts`
- Create: `packages/db/src/software-normalization.test.ts`
- Test: `packages/db/src/discovery-attribution.test.ts`
- Test: `packages/db/src/software-normalization.test.ts`

- [ ] **Step 1: Write failing taxonomy attribution tests**

Create tests covering:

- deterministic foundational host/runtime taxonomy attribution
- heuristic fallback for non-obvious item types
- low-confidence result becomes `needs_review`

Example target shape:

```ts
expect(result.taxonomyNodeSlug).toBe("foundational");
expect(result.attributionMethod).toBe("rule");
expect(result.confidence).toBeGreaterThan(0.9);
```

and:

```ts
expect(result.attributionStatus).toBe("needs_review");
expect(result.candidateTaxonomy?.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Write failing software normalization tests**

Cover:

- deterministic normalization from known package aliases
- heuristic normalization for noisy names
- unresolved package stays reviewable
- rule synthesis helper turns approved heuristic output into a deterministic rule candidate

- [ ] **Step 3: Run targeted tests to verify RED**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-attribution.test.ts software-normalization.test.ts
```

Expected: FAIL because the modules and logic do not exist yet.

- [ ] **Step 4: Implement taxonomy attribution module**

Create `packages/db/src/discovery-attribution.ts` with focused pure functions:

- `buildDiscoveryDescriptor(...)`
- `scoreTaxonomyCandidates(...)`
- `attributeInventoryEntity(...)`
- `evaluateInventoryQuality(...)` extension for taxonomy confidence issues

Rules for MVP:

- obvious foundational infrastructure maps by rule
- everything else gets candidate scoring from taxonomy labels
- no freeform taxonomy invention

- [ ] **Step 5: Implement software normalization module**

Create `packages/db/src/software-normalization.ts` with:

- `normalizeSoftwareEvidence(...)`
- `matchSoftwareIdentityByRule(...)`
- `scoreSoftwareIdentityCandidates(...)`
- `buildNormalizationRuleCandidate(...)`

Keep it deterministic-first. Heuristic scoring should be bounded and explainable.

- [ ] **Step 6: Run targeted tests to verify GREEN**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-attribution.test.ts software-normalization.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/discovery-attribution.ts packages/db/src/discovery-attribution.test.ts packages/db/src/software-normalization.ts packages/db/src/software-normalization.test.ts
git commit -m "feat(db): add taxonomy attribution and software normalization logic"
```

---

## Chunk 3: Normalize Collector Output Into Attributed Entities And Software Evidence

### Task 3: Extend discovery input/output types and normalization

**Files:**
- Modify: `packages/db/src/discovery-types.ts`
- Modify: `packages/db/src/discovery-normalize.ts`
- Modify: `packages/db/src/discovery-runner.ts`
- Test: existing discovery normalization tests plus new targeted tests

- [ ] **Step 1: Write failing normalization tests**

Add tests proving:

- inventory entities receive attribution metadata
- host and container items can emit software evidence records
- normalized output includes software evidence entries

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-normalize.test.ts discovery-runner.test.ts
```

Expected: FAIL because normalization output does not yet include attribution/software structures.

- [ ] **Step 3: Extend `discovery-types.ts`**

Add optional software evidence arrays to collector output, for example:

```ts
export type DiscoveredSoftwareInput = {
  hostExternalRef?: string;
  containerExternalRef?: string;
  evidenceSource: string;
  packageManager?: string;
  rawVendor?: string;
  rawProductName?: string;
  rawPackageName?: string;
  rawVersion?: string;
  installLocation?: string;
  metadata?: Record<string, unknown>;
};
```

Update `CollectorOutput` to include `software?: DiscoveredSoftwareInput[]`.

- [ ] **Step 4: Extend `discovery-normalize.ts`**

Update normalized output types to include:

- attribution metadata on `NormalizedInventoryEntity`
- `NormalizedSoftwareEvidence[]`

Wire in:

- taxonomy attribution for each entity
- software normalization for host/container software evidence

- [ ] **Step 5: Keep the existing runner contract stable**

`executeBootstrapDiscovery(...)` should still return persistence summary, but pass the richer normalized output into persistence.

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-normalize.test.ts discovery-runner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/discovery-types.ts packages/db/src/discovery-normalize.ts packages/db/src/discovery-runner.ts
git commit -m "feat(db): normalize discovery attribution and software evidence"
```

---

## Chunk 4: Persistence, Quality, And Graph Projection Inputs

### Task 4: Persist attribution metadata and software evidence

**Files:**
- Modify: `packages/db/src/discovery-sync.ts`
- Modify: `packages/db/src/discovery-sync.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing persistence tests**

Extend `packages/db/src/discovery-sync.test.ts` to prove:

- `taxonomyNodeId`, attribution metadata, and candidate JSON are persisted on inventory entities
- software evidence rows are persisted and linked to inventory entities
- low-confidence attribution creates the appropriate quality issue

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-sync.test.ts
```

Expected: FAIL because sync does not persist the new fields/models.

- [ ] **Step 3: Update `discovery-sync.ts`**

Add:

- taxonomy node lookup/connect during inventory upsert
- attribution metadata persistence
- software evidence upsert/create behavior
- quality issue creation for low-confidence taxonomy/software normalization

Do not broaden graph projection yet beyond what the current sync adapters already support. Keep graph projection input enriched but still bounded.

- [ ] **Step 4: Export new helpers from the db barrel**

Update `packages/db/src/index.ts` to export the new attribution/normalization helpers needed by other layers.

- [ ] **Step 5: Run test to verify GREEN**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-sync.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/discovery-sync.ts packages/db/src/discovery-sync.test.ts packages/db/src/index.ts
git commit -m "feat(db): persist taxonomy attribution and software evidence"
```

---

## Chunk 5: Inventory Read Models And Minimal UI Surfacing

### Task 5: Expose attribution metadata in inventory reads

**Files:**
- Modify: `apps/web/lib/discovery-data.ts`
- Modify: `apps/web/components/inventory/InventoryEntityPanel.tsx`
- Modify: `apps/web/app/(shell)/inventory/page.tsx`

- [ ] **Step 1: Write failing UI/data tests**

If test coverage exists, add assertions that inventory reads now expose:

- taxonomy node label
- attribution method/confidence
- unresolved review signal

If no dedicated UI test exists, add a focused data-layer test instead.

- [ ] **Step 2: Run the targeted test to verify RED**

Run the smallest relevant command, for example:

```bash
pnpm --filter web test -- app/(shell)/inventory/page.test.tsx lib/discovery-data.test.ts
```

Expected: FAIL because the read model or component does not expose the new fields yet.

- [ ] **Step 3: Update discovery reads and panel rendering**

Surface:

- taxonomy node
- attribution method/confidence
- needs-review/unmapped signal

Keep this additive. Do not redesign the inventory route.

- [ ] **Step 4: Run the targeted test to verify GREEN**

Run:

```bash
pnpm --filter web test -- app/(shell)/inventory/page.test.tsx lib/discovery-data.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/discovery-data.ts apps/web/components/inventory/InventoryEntityPanel.tsx apps/web/app/(shell)/inventory/page.tsx
git commit -m "feat(web): show discovery taxonomy attribution state"
```

---

## Chunk 6: Final Verification And Spec Sync

### Task 6: Verify the slice and sync documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-03-14-discovery-taxonomy-attribution-design.md`

- [ ] **Step 1: Update the spec with implementation notes**

Record what shipped in this slice and what remains deferred.

- [ ] **Step 2: Run focused DB and web verification**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-attribution-model.test.ts discovery-attribution.test.ts software-normalization.test.ts discovery-normalize.test.ts discovery-sync.test.ts
pnpm --filter web test -- app/(shell)/inventory/page.test.tsx lib/discovery-data.test.ts
pnpm --filter web build
```

Expected:

- all targeted DB tests pass
- targeted web tests pass
- build succeeds

- [ ] **Step 3: Commit doc sync**

```bash
git add docs/superpowers/specs/2026-03-14-discovery-taxonomy-attribution-design.md
git commit -m "docs: sync discovery taxonomy attribution spec status"
```

---

## Notes

- Keep this slice additive. Do not attempt full digital-product reconstruction here.
- Do not mutate `seed.ts` to represent runtime discovery outcomes.
- Taxonomy attribution and software normalization must preserve uncertainty as managed quality work rather than dropping ambiguous evidence.
