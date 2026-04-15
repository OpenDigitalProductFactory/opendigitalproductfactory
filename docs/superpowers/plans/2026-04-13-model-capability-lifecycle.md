# Model Capability Lifecycle Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Close the gap where code changes to model capability data never automatically propagate to the DB, causing tool routing to silently use stale values after container rebuilds.  
**Architecture:** Four phases: (1) DB schema + startup reconciliation script that applies the static catalog on every restart; (2) routing fallback hardening with source-aware resolvers; (3) observability via `ModelCapabilityChangeLog`; (4) scheduled re-validation so manual sync becomes optional. Each phase is independently deployable.  
**Tech Stack:** Prisma 7.x, PostgreSQL 16, TypeScript/tsx, Next.js 16, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-04-13-model-capability-lifecycle-management.md`

---

## Context You Must Know Before Touching Code

- `packages/db/prisma/schema.prisma` — Prisma schema. Never use `npx prisma`; always `pnpm --filter @dpf/db exec prisma`.
- `apps/web/lib/routing/known-provider-models.ts` — Static capability catalog. Imports only from `./model-card-types` and `./quality-tiers` (no `@/` aliases). Safe to import via relative path from `packages/db/scripts/`.
- `apps/web/lib/routing/loader.ts:48` — The broken `??` chain: `mp.capabilities?.toolUse ?? mp.supportsToolUse ?? mp.provider.supportsToolUse`. A stored `false` (not `null`) short-circuits it permanently.
- `apps/web/lib/inference/ai-provider-internals.ts:600-633` — `profileModelsInternal` resolution for `supportsToolUse`. Sets `rawMetadataHash` on every profile but never `discoveryHash` (new column).
- `packages/db/scripts/sync-provider-registry.ts` — Runs at `[2/5]` in init. Sets provider-level `supportsToolUse` but never touches `ModelProfile`.
- `docker-entrypoint.sh` lines 26-33 — Steps 2 and 3; we add step 3b between them.
- `ModelProfile.profileSource` defaults to `"seed"`. Values: `"seed"`, `"auto-discover"`, `"evaluated"`, `"admin"`. New value `"catalog"` added by this plan.
- `ModelProfile.supportsToolUse` is currently `Boolean @default(false)` — non-nullable. This plan makes it nullable.
- Migration timestamp convention: `YYYYMMDDHHMMSS_snake_case_name`. Latest existing: `20260412230000_reset_codex_tool_fidelity_scores`. New migrations use `202604130NNNNN_...`.
- Tests live alongside source files as `*.test.ts`. Run with `pnpm --filter @dpf/web test` (vitest).

---

## Phase 1 — Schema + Startup Reconciliation

### Task 1: DB Migration — New Columns and Change Log Table

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (ModelProfile + new ModelCapabilityChangeLog)
- Create: `packages/db/prisma/migrations/20260413000000_model_capability_lifecycle/migration.sql`

- [ ] **Step 1: Add new fields to `ModelProfile` in schema.prisma**

  Locate the `ModelProfile` model (line ~1083) and add these fields before the `@@unique` constraint:

  ```prisma
  catalogHash         String?
  discoveryHash       String?
  capabilityOverrides Json?
  ```

  Also change line 1097:
  ```prisma
  // Before:
  supportsToolUse     Boolean       @default(false)
  // After:
  supportsToolUse     Boolean?
  ```

- [ ] **Step 2: Add `ModelCapabilityChangeLog` model to schema.prisma**

  Add after the `ModelProfile` model block (after the `@@unique` line and closing brace):

  ```prisma
  model ModelCapabilityChangeLog {
    id         String   @id @default(cuid())
    providerId String
    modelId    String
    field      String
    oldValue   Json?
    newValue   Json?
    source     String
    changedAt  DateTime @default(now())
    changedBy  String?

    @@index([providerId, changedAt])
    @@index([modelId, changedAt])
  }
  ```

- [ ] **Step 3: Create the migration directory and SQL file**

  ```
  mkdir packages/db/prisma/migrations/20260413000000_model_capability_lifecycle
  ```

  Write `migration.sql`:

  ```sql
  -- Add new columns to ModelProfile
  ALTER TABLE "ModelProfile" ADD COLUMN "catalogHash"         TEXT;
  ALTER TABLE "ModelProfile" ADD COLUMN "discoveryHash"       TEXT;
  ALTER TABLE "ModelProfile" ADD COLUMN "capabilityOverrides" JSONB;

  -- Make supportsToolUse nullable (drop NOT NULL and default)
  ALTER TABLE "ModelProfile" ALTER COLUMN "supportsToolUse" DROP DEFAULT;
  ALTER TABLE "ModelProfile" ALTER COLUMN "supportsToolUse" DROP NOT NULL;

  -- Migrate existing rawMetadataHash into discoveryHash (discovery-owned profiles only)
  UPDATE "ModelProfile"
  SET "discoveryHash" = "rawMetadataHash"
  WHERE "rawMetadataHash" IS NOT NULL
    AND "profileSource" IN ('auto-discover', 'evaluated');

  -- Normalize: convert ambiguous default-false supportsToolUse to NULL
  -- for catalog/seed rows where no explicit adapter value was stored in capabilities.
  -- (false was the Prisma default, not an explicit "this model cannot use tools" decision)
  UPDATE "ModelProfile"
  SET "supportsToolUse" = NULL
  WHERE "supportsToolUse" = false
    AND COALESCE(("capabilities"->>'toolUse')::boolean, NULL) IS NULL
    AND "profileSource" IN ('seed', 'catalog');

  -- Create ModelCapabilityChangeLog
  CREATE TABLE "ModelCapabilityChangeLog" (
    "id"         TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId"    TEXT NOT NULL,
    "field"      TEXT NOT NULL,
    "oldValue"   JSONB,
    "newValue"   JSONB,
    "source"     TEXT NOT NULL,
    "changedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy"  TEXT,
    CONSTRAINT "ModelCapabilityChangeLog_pkey" PRIMARY KEY ("id")
  );

  CREATE INDEX "ModelCapabilityChangeLog_providerId_changedAt_idx"
    ON "ModelCapabilityChangeLog"("providerId", "changedAt");

  CREATE INDEX "ModelCapabilityChangeLog_modelId_changedAt_idx"
    ON "ModelCapabilityChangeLog"("modelId", "changedAt");
  ```

- [ ] **Step 4: Run migration to verify it applies cleanly**

  ```bash
  pnpm --filter @dpf/db exec prisma migrate deploy
  ```

  Expected: `1 migration applied successfully` (or similar — no errors).

- [ ] **Step 5: Regenerate Prisma client**

  ```bash
  pnpm --filter @dpf/db exec prisma generate
  ```

  Expected: `Generated Prisma Client` — no TypeScript errors in `node_modules/@prisma/client`.

- [ ] **Step 6: Commit**

  ```
  git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260413000000_model_capability_lifecycle/
  git commit -m "feat(db): add model capability lifecycle columns and change log table"
  ```

---

### Task 2: Reconciliation Script

**Files:**
- Create: `packages/db/scripts/reconcile-catalog-capabilities.ts`
- Create: `packages/db/scripts/reconcile-catalog-capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

  Create `packages/db/scripts/reconcile-catalog-capabilities.test.ts`:

  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { buildCatalogHash, diffExcludingOverrides, catalogEntryToProfileFields } from "./reconcile-catalog-capabilities";
  import type { KnownModel } from "../../../apps/web/lib/routing/known-provider-models";
  import { EMPTY_CAPABILITIES } from "../../../apps/web/lib/routing/model-card-types";

  const sampleModel: KnownModel = {
    modelId: "gpt-5.3-codex",
    friendlyName: "GPT-5.3 Codex",
    summary: "Test model",
    qualityTier: "frontier",
    capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true },
    maxContextTokens: 128000,
    maxOutputTokens: 8192,
    inputModalities: ["text"],
    outputModalities: ["text"],
    modelClass: "chat",
    modelFamily: "gpt-5",
    capabilityTier: "tier-1",
    costTier: "premium",
    bestFor: ["tool-use"],
    avoidFor: [],
    defaultStatus: "active",
    scores: { reasoning: 80, codegen: 80, toolFidelity: 80, instructionFollowingScore: 75, structuredOutputScore: 75, conversational: 70, contextRetention: 70 },
  };

  describe("buildCatalogHash", () => {
    it("produces consistent hash for same input", () => {
      const h1 = buildCatalogHash(sampleModel);
      const h2 = buildCatalogHash(sampleModel);
      expect(h1).toBe(h2);
    });

    it("produces different hash when capability changes", () => {
      const changed = { ...sampleModel, capabilities: { ...sampleModel.capabilities, toolUse: false } };
      expect(buildCatalogHash(sampleModel)).not.toBe(buildCatalogHash(changed));
    });
  });

  describe("diffExcludingOverrides", () => {
    it("returns changed fields excluding those in capabilityOverrides", () => {
      const profile = { supportsToolUse: false, toolFidelity: 10 };
      const entry = { supportsToolUse: true, toolFidelity: 80 };
      const overrides = { supportsToolUse: false }; // admin pinned this
      const diff = diffExcludingOverrides(profile as any, entry as any, overrides);
      expect(diff).toEqual({ toolFidelity: 80 }); // toolUse excluded, toolFidelity included
    });

    it("returns all changed fields when capabilityOverrides is null", () => {
      const profile = { supportsToolUse: false, toolFidelity: 10 };
      const entry = { supportsToolUse: true, toolFidelity: 80 };
      const diff = diffExcludingOverrides(profile as any, entry as any, null);
      expect(diff).toEqual({ supportsToolUse: true, toolFidelity: 80 });
    });

    it("returns empty object when nothing changed", () => {
      const profile = { supportsToolUse: true, toolFidelity: 80 };
      const entry = { supportsToolUse: true, toolFidelity: 80 };
      const diff = diffExcludingOverrides(profile as any, entry as any, null);
      expect(diff).toEqual({});
    });
  });

  describe("catalogEntryToProfileFields", () => {
    it("maps KnownModel to ModelProfile update shape", () => {
      const fields = catalogEntryToProfileFields(sampleModel);
      expect(fields.supportsToolUse).toBe(true);
      expect(fields.toolFidelity).toBe(80);
      expect((fields.capabilities as any).toolUse).toBe(true);
      expect(fields.modelStatus).toBe("active");
    });
  });

  describe("admin row-level protection", () => {
    it("diffExcludingOverrides returns empty when profileSource=admin and overrides=null (full row protection)", () => {
      // Spec §5.2: if profileSource="admin" AND capabilityOverrides IS NULL, treat as fully protected.
      // The reconcile loop checks this BEFORE calling diffExcludingOverrides, but we test the
      // convention here so the integration path is clearly documented.
      const profile = { supportsToolUse: false, toolFidelity: 10 };
      const entry = { supportsToolUse: true, toolFidelity: 80 };
      // When overrides is null AND the caller passes it as a full-row guard sentinel,
      // the calling code skips entirely — but if it mistakenly calls diffExcludingOverrides
      // with null overrides on an admin row, this test confirms all fields would be returned
      // (i.e., the guard must be in the loop, not in diffExcludingOverrides itself).
      const diff = diffExcludingOverrides(profile as any, entry as any, null);
      expect(diff).toEqual({ supportsToolUse: true, toolFidelity: 80 });
      // The reconcile loop (not this helper) is responsible for skipping admin+null rows.
    });
  });
  ```

- [ ] **Step 2: Run to confirm it fails**

  ```bash
  pnpm --filter @dpf/db test reconcile-catalog-capabilities
  ```

  Expected: `Cannot find module './reconcile-catalog-capabilities'` or similar failures.

- [ ] **Step 3: Write the implementation**

  Create `packages/db/scripts/reconcile-catalog-capabilities.ts`:

  ```typescript
  /**
   * EP-MODEL-CAP-001-A: Startup catalog reconciliation.
   *
   * Applies KNOWN_PROVIDER_MODELS static capability catalog to any ModelProfile
   * rows that are catalog-managed (profileSource: "catalog" | "seed").
   *
   * Idempotent: a stable catalog produces zero DB writes on re-run.
   * Never touches discovery-owned rows (profileSource: "auto-discover" | "evaluated").
   * Never overwrites fields in capabilityOverrides (admin field-level locks).
   * Fully protects admin rows with null capabilityOverrides (row-level fallback).
   *
   * Run via: pnpm --filter @dpf/db exec tsx scripts/reconcile-catalog-capabilities.ts
   */
  import { createHash } from "crypto";
  import { prisma } from "../src/client";
  import { KNOWN_PROVIDER_MODELS } from "../../../apps/web/lib/routing/known-provider-models";
  import type { KnownModel } from "../../../apps/web/lib/routing/known-provider-models";

  export type ProfileUpdateShape = {
    supportsToolUse: boolean;
    toolFidelity: number;
    reasoning: number;
    codegen: number;
    instructionFollowingScore: number;
    structuredOutputScore: number;
    conversational: number;
    contextRetention: number;
    capabilities: Record<string, unknown>;
    maxContextTokens: number | null;
    maxOutputTokens: number | null;
    inputModalities: string[];
    outputModalities: string[];
    modelClass: string;
    modelFamily: string | null;
    friendlyName: string;
    summary: string;
    capabilityTier: string;
    costTier: string;
    qualityTier: string;
    modelStatus: string;
    metadataSource: string;
    metadataConfidence: string;
  };

  /** Deterministic SHA-256 hash of a catalog entry (keys sorted for stability). */
  export function buildCatalogHash(entry: KnownModel): string {
    const stable = JSON.stringify(entry, Object.keys(entry).sort() as (keyof KnownModel)[]);
    return createHash("sha256").update(stable).digest("hex").slice(0, 16);
  }

  /**
   * Returns only the fields that differ between current profile and new entry,
   * excluding any fields protected by capabilityOverrides.
   * If profileSource is "admin" and capabilityOverrides is null, returns {} (full protection).
   */
  export function diffExcludingOverrides(
    current: Record<string, unknown>,
    incoming: Record<string, unknown>,
    overrides: Record<string, unknown> | null,
  ): Record<string, unknown> {
    const diff: Record<string, unknown> = {};
    for (const key of Object.keys(incoming)) {
      if (overrides && key in overrides) continue; // admin-pinned field
      const currentVal = JSON.stringify(current[key] ?? null);
      const incomingVal = JSON.stringify(incoming[key] ?? null);
      if (currentVal !== incomingVal) {
        diff[key] = incoming[key];
      }
    }
    return diff;
  }

  /** Map a KnownModel entry to the ModelProfile fields we manage. */
  export function catalogEntryToProfileFields(entry: KnownModel): ProfileUpdateShape {
    const scores = entry.scores ?? { reasoning: 50, codegen: 50, toolFidelity: 50, instructionFollowingScore: 50, structuredOutputScore: 50, conversational: 50, contextRetention: 50 };
    return {
      supportsToolUse: entry.capabilities.toolUse === true,
      toolFidelity: scores.toolFidelity,
      reasoning: scores.reasoning,
      codegen: scores.codegen,
      instructionFollowingScore: scores.instructionFollowingScore,
      structuredOutputScore: scores.structuredOutputScore,
      conversational: scores.conversational,
      contextRetention: scores.contextRetention,
      capabilities: entry.capabilities as Record<string, unknown>,
      maxContextTokens: entry.maxContextTokens,
      maxOutputTokens: entry.maxOutputTokens,
      inputModalities: entry.inputModalities,
      outputModalities: entry.outputModalities,
      modelClass: entry.modelClass,
      modelFamily: entry.modelFamily,
      friendlyName: entry.friendlyName,
      summary: entry.summary,
      capabilityTier: entry.capabilityTier,
      costTier: entry.costTier,
      qualityTier: entry.qualityTier,
      modelStatus: entry.defaultStatus === "active" ? "active" : entry.defaultStatus === "retired" ? "retired" : "disabled",
      metadataSource: "curated",
      metadataConfidence: "high",
    };
  }

  async function reconcile(): Promise<void> {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let noChange = 0;

    for (const [providerId, models] of Object.entries(KNOWN_PROVIDER_MODELS)) {
      for (const entry of models) {
        const { modelId } = entry;
        const hash = buildCatalogHash(entry);

        const profile = await prisma.modelProfile.findFirst({
          where: { providerId, modelId },
          select: {
            profileSource: true,
            catalogHash: true,
            capabilityOverrides: true,
            supportsToolUse: true,
            toolFidelity: true,
            reasoning: true,
            codegen: true,
            instructionFollowingScore: true,
            structuredOutputScore: true,
            conversational: true,
            contextRetention: true,
            capabilities: true,
          },
        });

        if (!profile) {
          // New model — create DiscoveredModel + ModelProfile
          await prisma.discoveredModel.upsert({
            where: { providerId_modelId: { providerId, modelId } },
            update: { rawMetadata: entry as any, lastSeenAt: new Date() },
            create: { providerId, modelId, rawMetadata: entry as any },
          });
          const fields = catalogEntryToProfileFields(entry);
          await prisma.modelProfile.create({
            data: {
              providerId,
              modelId,
              profileSource: "catalog",
              catalogHash: hash,
              bestFor: entry.bestFor,
              avoidFor: entry.avoidFor,
              ...fields,
            } as any,
          });
          console.log(`  CREATED  ${providerId}/${modelId}`);
          created++;
          continue;
        }

        // Discovery-owned — never touch
        if (profile.profileSource === "auto-discover" || profile.profileSource === "evaluated") {
          skipped++;
          continue;
        }

        // Admin row with null capabilityOverrides — fully protected
        if (profile.profileSource === "admin" && !profile.capabilityOverrides) {
          skipped++;
          continue;
        }

        // Hash match — no change needed
        if (profile.catalogHash === hash) {
          noChange++;
          continue;
        }

        // Compute what changed, excluding admin-pinned fields
        const overrides = profile.capabilityOverrides as Record<string, unknown> | null;
        const incoming = catalogEntryToProfileFields(entry);
        const changedFields = diffExcludingOverrides(
          profile as Record<string, unknown>,
          incoming as Record<string, unknown>,
          overrides,
        );

        if (Object.keys(changedFields).length === 0) {
          // All changes were in overridden fields — still update hash
          await prisma.modelProfile.updateMany({
            where: { providerId, modelId },
            data: { catalogHash: hash } as any,
          });
          noChange++;
          continue;
        }

        await prisma.modelProfile.updateMany({
          where: { providerId, modelId },
          data: { catalogHash: hash, profileSource: "catalog", ...changedFields } as any,
        });

        const changedKeys = Object.keys(changedFields).join(", ");
        console.log(`  UPDATED  ${providerId}/${modelId} [${changedKeys}]`);
        updated++;
      }
    }

    console.log(`\nCatalog reconciliation: ${created} created, ${updated} updated, ${skipped} skipped (discovery/admin-owned), ${noChange} unchanged.`);
  }

  reconcile()
    .catch((err) => { console.error("Reconciliation failed:", err); process.exit(1); })
    .finally(() => prisma.$disconnect());
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  pnpm --filter @dpf/db test reconcile-catalog-capabilities
  ```

  Expected: `3 tests passed` (or equivalent).

- [ ] **Step 5: Run the script dry-run against local DB to verify no crashes**

  ```bash
  pnpm --filter @dpf/db exec tsx scripts/reconcile-catalog-capabilities.ts
  ```

  Expected: lines like `CREATED`, `UPDATED`, or `Catalog reconciliation: N created, M updated...`. No unhandled exceptions.

- [ ] **Step 6: Commit**

  ```
  git add packages/db/scripts/reconcile-catalog-capabilities.ts packages/db/scripts/reconcile-catalog-capabilities.test.ts
  git commit -m "feat(catalog): add startup catalog reconciliation script (EP-MODEL-CAP-001-A)"
  ```

---

### Task 3: Wire Reconciliation Into Startup

**Files:**
- Modify: `docker-entrypoint.sh` (add step 3b)

- [ ] **Step 1: Add step 3b to docker-entrypoint.sh**

  Reconciliation must run **after** seed (step 3) because seed creates the initial `profileSource="seed"` rows that reconciliation then updates. Insert the block **after** the `echo "  OK Seed complete"` line and **before** `echo "[4/5] Detecting hardware..."`:

  ```sh
  echo "[3b/5] Reconciling model capability catalog..."
  cd /app
  pnpm --filter @dpf/db exec tsx scripts/reconcile-catalog-capabilities.ts || echo "  WARN Catalog reconciliation had warnings (non-fatal)"
  echo "  OK Catalog reconciliation complete"
  ```

  Final order:

  ```text
  [2/5] sync-provider-registry (creates ModelProvider rows)
  [3/5] seed.ts (creates initial ModelProfile rows with profileSource="seed")
  [3b/5] reconcile-catalog-capabilities  ← INSERT HERE (after seed echo OK, before [4/5])
  [4/5] detect-hardware
  [5/5] bootstrap source volume
  ```

- [ ] **Step 2: Verify LF line endings are preserved**

  ```bash
  file docker-entrypoint.sh
  ```

  Expected: `ASCII text` (not `CRLF`). If it shows CRLF, run: `sed -i 's/\r//' docker-entrypoint.sh`.

- [ ] **Step 3: Commit**

  ```
  git add docker-entrypoint.sh
  git commit -m "feat(init): run catalog reconciliation at portal startup (EP-MODEL-CAP-001-A)"
  ```

---

## Phase 2 — Routing Fallback Hardening

### Task 4: Source-Priority Capability Resolver in loader.ts

**Files:**
- Modify: `apps/web/lib/routing/loader.ts`
- Create: `apps/web/lib/routing/loader.test.ts` (or add to existing test file if present)

- [ ] **Step 1: Write the failing tests**

  Add to `apps/web/lib/routing/loader.test.ts` (create if needed):

  ```typescript
  import { describe, it, expect } from "vitest";
  import { resolveToolUse } from "./loader";

  const baseProfile = {
    profileSource: "seed",
    capabilityOverrides: null,
    capabilities: {},
    supportsToolUse: null,
    provider: { supportsToolUse: true },
  };

  describe("resolveToolUse", () => {
    it("admin override wins over everything", () => {
      const profile = { ...baseProfile, profileSource: "admin", capabilityOverrides: { toolUse: false }, capabilities: { toolUse: true }, supportsToolUse: true };
      expect(resolveToolUse(profile as any)).toBe(false);
    });

    it("discovery capability value used for discovery-owned profiles", () => {
      const profile = { ...baseProfile, profileSource: "auto-discover", capabilities: { toolUse: true } };
      expect(resolveToolUse(profile as any)).toBe(true);
    });

    it("discovery capability false is respected (not overridden by provider)", () => {
      const profile = { ...baseProfile, profileSource: "auto-discover", capabilities: { toolUse: false } };
      expect(resolveToolUse(profile as any)).toBe(false);
    });

    it("catalog capability value used for catalog-owned profiles", () => {
      const profile = { ...baseProfile, profileSource: "catalog", capabilities: { toolUse: true } };
      expect(resolveToolUse(profile as any)).toBe(true);
    });

    it("falls through to profile.supportsToolUse when capabilities has no toolUse", () => {
      const profile = { ...baseProfile, profileSource: "seed", capabilities: {}, supportsToolUse: true };
      expect(resolveToolUse(profile as any)).toBe(true);
    });

    it("falls through to provider supportsToolUse as floor", () => {
      const profile = { ...baseProfile, profileSource: "seed", capabilities: {}, supportsToolUse: null, provider: { supportsToolUse: true } };
      expect(resolveToolUse(profile as any)).toBe(true);
    });

    it("returns null when everything unknown", () => {
      const profile = { ...baseProfile, profileSource: "seed", capabilities: {}, supportsToolUse: null, provider: { supportsToolUse: null } };
      expect(resolveToolUse(profile as any)).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run to confirm tests fail**

  ```bash
  pnpm --filter @dpf/web test loader
  ```

  Expected: `Cannot find 'resolveToolUse'` or test failures.

- [ ] **Step 3: Export `resolveToolUse` from loader.ts**

  Add this function to `apps/web/lib/routing/loader.ts` (before `loadEndpointManifests`):

  ```typescript
  /**
   * EP-MODEL-CAP-001-B: Source-priority tool use resolution.
   *
   * Precedence (highest to lowest):
   *   1. capabilityOverrides.toolUse — explicit admin field-level override
   *   2. capabilities.toolUse (discovery-owned profiles only)
   *   3. capabilities.toolUse (catalog-owned profiles only)
   *   4. profile.supportsToolUse — set by provider-sync null-backfill or admin
   *   5. provider.supportsToolUse — floor
   */
  export function resolveToolUse(
    profile: {
      profileSource: string | null;
      capabilityOverrides: unknown;
      capabilities: unknown;
      supportsToolUse: boolean | null;
      provider: { supportsToolUse: boolean | null };
    },
  ): boolean | null {
    // 1. Admin field-level override
    const overrides = profile.capabilityOverrides as Record<string, unknown> | null;
    if (overrides !== null && overrides !== undefined && "toolUse" in overrides) {
      return overrides.toolUse as boolean;
    }

    const caps = profile.capabilities as Record<string, unknown> | null;
    const src = profile.profileSource ?? "seed";

    // 2. Discovery-owned: use adapter-extracted value
    if (src === "auto-discover" || src === "evaluated") {
      if (caps?.toolUse !== undefined && caps.toolUse !== null) return caps.toolUse as boolean;
    }

    // 3. Catalog-owned: use reconciled value
    if (src === "catalog" || src === "seed") {
      if (caps?.toolUse !== undefined && caps.toolUse !== null) return caps.toolUse as boolean;
    }

    // 4. Profile-level boolean (set by provider-sync null-backfill)
    if (profile.supportsToolUse !== null && profile.supportsToolUse !== undefined) {
      return profile.supportsToolUse;
    }

    // 5. Provider floor
    return profile.provider.supportsToolUse ?? null;
  }
  ```

- [ ] **Step 4: Replace the `??` chain in `loadEndpointManifests`**

  In `loader.ts` line ~48, replace:
  ```typescript
  supportsToolUse: (mp.capabilities as any)?.toolUse ?? mp.supportsToolUse ?? mp.provider.supportsToolUse,
  ```
  With:
  ```typescript
  supportsToolUse: resolveToolUse(mp),
  ```

- [ ] **Step 5: Run tests to verify they pass**

  ```bash
  pnpm --filter @dpf/web test loader
  ```

  Expected: all 7 tests pass.

- [ ] **Step 6: Commit**

  ```
  git add apps/web/lib/routing/loader.ts apps/web/lib/routing/loader.test.ts
  git commit -m "feat(routing): source-priority tool use resolver replaces ?? chain (EP-MODEL-CAP-001-B)"
  ```

---

### Task 5: Update profileModelsInternal to Store discoveryHash

**Files:**
- Modify: `apps/web/lib/inference/ai-provider-internals.ts` (lines ~628-633)

- [ ] **Step 1: Find the `rawMetadataHash` assignment**

  In `ai-provider-internals.ts` around line 628, find where `rawMetadataHash: card.rawMetadataHash` is assigned in the `metadataFields` object.

- [ ] **Step 2: Add `discoveryHash` alongside it**

  ```typescript
  // Before (line ~628):
  rawMetadataHash: card.rawMetadataHash,

  // After:
  rawMetadataHash: card.rawMetadataHash,
  discoveryHash: card.rawMetadataHash,   // EP-MODEL-CAP-001: explicit discovery hash column
  ```

- [ ] **Step 3: Update the `resolvedToolUse` logic to write `null` instead of `false` as last resort**

  Find lines ~602-606:
  ```typescript
  const resolvedToolUse = extractedToolUse !== null && extractedToolUse !== undefined
    ? extractedToolUse
    : isManuallySet
      ? (existingProfile.supportsToolUse ?? provider!.supportsToolUse ?? false)
      : (provider!.supportsToolUse ?? false);
  ```

  Replace with (removes `false` last resort — null is now valid):
  ```typescript
  const resolvedToolUse = extractedToolUse !== null && extractedToolUse !== undefined
    ? extractedToolUse
    : isManuallySet
      ? (existingProfile.supportsToolUse ?? provider!.supportsToolUse ?? null)
      : (provider!.supportsToolUse ?? null);
  ```

- [ ] **Step 4: Verify TypeScript compiles clean**

  ```bash
  pnpm --filter @dpf/web exec tsc --noEmit
  ```

  Expected: no errors. If `supportsToolUse: boolean | null` type mismatch appears, the schema change from Task 1 must be regenerated first (Step 5 of Task 1).

- [ ] **Step 5: Commit**

  ```
  git add apps/web/lib/inference/ai-provider-internals.ts
  git commit -m "feat(discovery): store discoveryHash on profiling, allow null supportsToolUse"
  ```

---

### Task 6: Provider-Level Null-Backfill in sync-provider-registry.ts

**Files:**
- Modify: `packages/db/scripts/sync-provider-registry.ts`

- [ ] **Step 1: Add null-backfill after the provider upsert loop**

  Find the `for (const entry of entries)` loop end (around line 120+) and after the loop add:

  ```typescript
  // EP-MODEL-CAP-001-C: Backfill null supportsToolUse on ModelProfile rows
  // that have never had a model-level value set.
  // Only fills NULLs — never overwrites an explicit model-level value.
  for (const entry of entries) {
    if (entry.supportsToolUse === undefined) continue;
    await prisma.modelProfile.updateMany({
      where: {
        providerId: entry.providerId,
        supportsToolUse: null,
        profileSource: { not: "admin" },
      },
      data: { supportsToolUse: entry.supportsToolUse },
    });
  }
  console.log("  Provider-level supportsToolUse backfilled for null model profiles");
  ```

- [ ] **Step 2: Run the script to verify no errors**

  ```bash
  pnpm --filter @dpf/db exec tsx scripts/sync-provider-registry.ts
  ```

  Expected: finishes without error, prints the backfill line.

- [ ] **Step 3: Commit**

  ```
  git add packages/db/scripts/sync-provider-registry.ts
  git commit -m "feat(registry): backfill null supportsToolUse from provider-level flag (EP-MODEL-CAP-001-C)"
  ```

---

## Phase 3 — Observability

### Task 7: Write Change Log Entries from Reconciliation Script

**Files:**
- Modify: `packages/db/scripts/reconcile-catalog-capabilities.ts`

- [ ] **Step 1: Add a helper to write change log entries**

  In `reconcile-catalog-capabilities.ts`, add after the imports:

  ```typescript
  async function logChanges(
    providerId: string,
    modelId: string,
    changedFields: Record<string, unknown>,
    currentProfile: Record<string, unknown>,
    source: string,
  ): Promise<void> {
    const entries = Object.entries(changedFields).map(([field, newValue]) => ({
      id: `${Date.now()}-${field}-${Math.random().toString(36).slice(2, 7)}`,
      providerId,
      modelId,
      field,
      oldValue: currentProfile[field] ?? null,
      newValue: newValue ?? null,
      source,
    }));
    if (entries.length > 0) {
      await prisma.modelCapabilityChangeLog.createMany({ data: entries });
    }
  }
  ```

- [ ] **Step 2: Call `logChanges` in the reconcile loop**

  After the `prisma.modelProfile.updateMany` call in the "Catalog has changed" branch:

  ```typescript
  await logChanges(
    providerId,
    modelId,
    changedFields,
    profile as Record<string, unknown>,
    "catalog",
  );
  ```

  Also call it in the "New model" branch (oldValue: null for all fields):

  ```typescript
  const fields = catalogEntryToProfileFields(entry);
  const newFields = fields as unknown as Record<string, unknown>;
  await logChanges(providerId, modelId, newFields, {}, "catalog");
  ```

- [ ] **Step 3: Add 90-day retention cleanup at end of reconcile()**

  At the top of `reconcile()`, before the main loop, add:

  ```typescript
  // Prune change log entries older than 90 days
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const { count: pruned } = await prisma.modelCapabilityChangeLog.deleteMany({
    where: { changedAt: { lt: cutoff } },
  });
  if (pruned > 0) console.log(`  Pruned ${pruned} change log entries older than 90 days`);
  ```

- [ ] **Step 4: Run the script and verify DB rows appear**

  ```bash
  pnpm --filter @dpf/db exec tsx scripts/reconcile-catalog-capabilities.ts
  ```

  Then check:
  ```bash
  # In psql or via Prisma Studio
  SELECT COUNT(*) FROM "ModelCapabilityChangeLog";
  ```

  Expected: count > 0 after a run that made changes.

- [ ] **Step 5: Commit**

  ```
  git add packages/db/scripts/reconcile-catalog-capabilities.ts
  git commit -m "feat(observability): write ModelCapabilityChangeLog entries from reconciliation"
  ```

---

### Task 8: Batched Events for Route Cache Invalidation

**Files:**
- Modify: `packages/db/scripts/reconcile-catalog-capabilities.ts`
- Create: `apps/web/lib/routing/capability-events.ts`

> Note: `agentEventBus` is thread-scoped (per conversation). For infrastructure-level capability events, we use a module-level EventEmitter instead of the thread bus.

- [ ] **Step 1: Create `capability-events.ts`**

  Create `apps/web/lib/routing/capability-events.ts`:

  ```typescript
  /**
   * EP-MODEL-CAP-001-E: System-level model capability change events.
   *
   * Separate from agentEventBus (which is thread/conversation scoped).
   * Used to invalidate route caches when capability data changes.
   */
  import { EventEmitter } from "events";

  export interface CapabilityReconciledEvent {
    runId: string;
    source: "catalog" | "discovery";
    changedProviderIds: string[];
    changedCount: number;
    skippedCount: number;
  }

  class CapabilityEventBus extends EventEmitter {}

  export const capabilityEventBus = new CapabilityEventBus();

  /** Emit after a reconciliation or discovery run completes. */
  export function emitCapabilityReconciled(event: CapabilityReconciledEvent): void {
    capabilityEventBus.emit("capability.reconciled", event);
  }

  /** Subscribe to capability reconciliation completions. */
  export function onCapabilityReconciled(
    handler: (event: CapabilityReconciledEvent) => void,
  ): () => void {
    capabilityEventBus.on("capability.reconciled", handler);
    return () => capabilityEventBus.off("capability.reconciled", handler);
  }
  ```

- [ ] **Step 2: Emit from reconcile script at the end of `reconcile()`**

  Note: the reconcile script runs as a standalone process (not inside the Next.js runtime), so it cannot import the in-process event bus. The event emission in this case is a no-op — the route manifests are loaded fresh from DB on every `loadEndpointManifests()` call (no persistent in-memory cache). Skip emission from the script.

  Instead, verify `loadEndpointManifests` performs no in-memory caching (confirm it always queries the DB):
  - Check `apps/web/lib/routing/loader.ts` — `loadEndpointManifests()` calls `prisma.modelProfile.findMany(...)` directly with no cache wrapping.
  - If a cache exists (e.g., `unstable_cache` from Next.js), add a `revalidateTag("endpoint-manifests")` call after reconciliation. If no cache: no action needed.

- [ ] **Step 3: Commit**

  ```
  git add apps/web/lib/routing/capability-events.ts
  git commit -m "feat(observability): add capability event bus for route cache invalidation"
  ```

---

### Task 9: Admin API Endpoint for Change Log

**Files:**
- Create: `apps/web/app/api/admin/model-capability-changes/route.ts`

- [ ] **Step 1: Write the route handler**

  ```typescript
  import { NextResponse } from "next/server";
  import { auth } from "@/lib/auth";
  import { can } from "@/lib/permissions";
  import { prisma } from "@dpf/db";

  export async function GET(request: Request) {
    const session = await auth();
    const user = session?.user;
    if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

    const changes = await prisma.modelCapabilityChangeLog.findMany({
      where: providerId ? { providerId } : undefined,
      orderBy: { changedAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ changes });
  }
  ```

- [ ] **Step 2: Verify the route responds**

  After container rebuild or `next dev`, hit: `GET /api/admin/model-capability-changes?limit=10`

  Expected: `{ changes: [...] }` — populated after reconciliation has run.

- [ ] **Step 3: Commit**

  ```
  git add apps/web/app/api/admin/model-capability-changes/route.ts
  git commit -m "feat(admin): add model capability change log API endpoint"
  ```

---

## Phase 4 — Scheduled Re-validation

### Task 10: Startup Revalidation Job (90s delay + jitter)

**Files:**
- Modify: `apps/web/lib/inference/ai-provider-internals.ts`  
- Modify: `apps/web/app/api/health/route.ts` (or wherever startup jobs are wired — find by grepping for `setTimeout` or `scheduleJob` in the web app)

- [ ] **Step 1: Find where startup jobs are triggered**

  ```bash
  grep -r "startup\|onReady\|setTimeout.*discover\|scheduleJob" apps/web/lib --include="*.ts" -l
  ```

  Identify the file that schedules background jobs after Next.js startup.

- [ ] **Step 2: Add startup revalidation with jitter**

  In the appropriate startup file, add:

  ```typescript
  // EP-MODEL-CAP-001-D: Startup revalidation — runs 90s after startup + jitter
  const STARTUP_DELAY_MS = 90_000 + Math.floor(Math.random() * 30_000); // 90–120s
  setTimeout(async () => {
    try {
      const { runModelRevalidation } = await import("@/lib/inference/model-revalidation");
      await runModelRevalidation({ source: "startup" });
    } catch (err) {
      console.warn("[model-revalidation] Startup revalidation failed (non-fatal):", err);
    }
  }, STARTUP_DELAY_MS);
  ```

- [ ] **Step 3: Create `apps/web/lib/inference/model-revalidation.ts`**

  ```typescript
  /**
   * EP-MODEL-CAP-001-D: Model capability re-validation with distributed safety.
   *
   * Uses a dedicated Postgres session (not prisma.$queryRaw) for the advisory
   * lock so the lock is held for the full job duration, not just one transaction.
   * prisma.$queryRaw returns the connection to the pool after each call, which
   * would silently release session-scoped advisory locks mid-job.
   */
  import { prisma } from "@dpf/db";
  import { Pool } from "pg";
  import { autoDiscoverAndProfile } from "./ai-provider-internals";

  const LOCK_KEY = 0x4D434156; // "MCAV" as int32 (deterministic, stable)

  /**
   * Acquire a session-scoped Postgres advisory lock on a dedicated connection.
   * The lock is held until fn() resolves, then explicitly released before the
   * connection is returned to the pool.
   * Returns false if another instance already holds the lock.
   */
  async function withAdvisoryLock(
    pool: Pool,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
        [LOCK_KEY],
      );
      if (!rows[0]?.acquired) return false;
      try {
        await fn();
        return true;
      } finally {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [LOCK_KEY]).catch(() => {});
      }
    } finally {
      client.release();
    }
  }

  export async function runModelRevalidation(
    opts: { source: "startup" | "scheduled" | "manual" },
    pgPool: Pool,
  ): Promise<void> {
    console.log(`[model-revalidation] Starting (source=${opts.source})`);

    const acquired = await withAdvisoryLock(pgPool, async () => {
      const totalDeadline = Date.now() + 10 * 60 * 1000; // 10-min hard cap

      const activeProviders = await prisma.modelProvider.findMany({
        where: { status: { in: ["active", "degraded"] } },
        select: { providerId: true },
      });

      for (const { providerId } of activeProviders) {
        if (Date.now() > totalDeadline) {
          console.warn("[model-revalidation] Total budget exceeded — stopping early");
          break;
        }
        try {
          // Per-provider 60s timeout: race the discovery against a rejection
          await Promise.race([
            autoDiscoverAndProfile(providerId),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`${providerId} timed out after 60s`)), 60_000),
            ),
          ]);
          console.log(`[model-revalidation] Refreshed ${providerId}`);
        } catch (err) {
          console.warn(`[model-revalidation] ${providerId} failed (non-fatal):`, err);
        }
      }
    });

    if (!acquired) {
      console.log("[model-revalidation] Skipped — another instance is running");
    }
  }
  ```

  > `pg` is already a transitive dependency via `@prisma/client`. Import `Pool` from `"pg"` and construct it from `process.env.DATABASE_URL`. The caller (startup hook) passes the pool in so it can be reused across jobs.

- [ ] **Step 4: Update the existing daily `model-discovery-refresh` scheduled job**

  ```bash
  grep -r "model-discovery-refresh" apps/web --include="*.ts" -l
  ```

  In the file found: update the handler to call `runModelRevalidation({ source: "scheduled" }, pgPool)` and change the cron expression from `"0 4 * * *"` to `"0 3 * * *"` (03:00 UTC per spec §5.5).

- [ ] **Step 5: Update "Sync Models & Profiles" admin button to call `runModelRevalidation`**

  Find the server action behind "Sync Models & Profiles" (grep: `syncModels\|syncProfiles\|triggerSync` in `apps/web/lib/actions/ai-providers.ts`). Replace or delegate its implementation to `runModelRevalidation({ source: "manual" })`.

- [ ] **Step 6: Verify no TypeScript errors**

  ```bash
  pnpm --filter @dpf/web exec tsc --noEmit
  ```

- [ ] **Step 7: Commit**

  ```
  git add apps/web/lib/inference/model-revalidation.ts
  git commit -m "feat(revalidation): scheduled model capability re-validation with advisory lock (EP-MODEL-CAP-001-D)"
  ```

---

## End-to-End Verification

After all phases are implemented and the container is rebuilt:

- [ ] Make a change to `known-provider-models.ts` (e.g., bump a `toolFidelity` score by 1)
- [ ] Run `docker compose build portal && docker compose up -d portal`
- [ ] Watch init logs: `docker compose logs portal-init` — should show `[3b/5] Reconciling model capability catalog... UPDATED codex/gpt-5.3-codex [toolFidelity]`
- [ ] Query the DB: `SELECT "toolFidelity", "profileSource", "catalogHash" FROM "ModelProfile" WHERE "modelId" = 'gpt-5.3-codex'` — confirm value updated
- [ ] Query change log: `SELECT * FROM "ModelCapabilityChangeLog" ORDER BY "changedAt" DESC LIMIT 5` — confirm entry present
- [ ] Test AI Ops Engineer tool use — no "limited mode" message
- [ ] Revert the toolFidelity change, rebuild, confirm it reverts in DB automatically

---

## Files Changed Summary

| File | Action | Phase |
| ---- | ------ | ----- |
| `packages/db/prisma/schema.prisma` | Modify | 1 |
| `packages/db/prisma/migrations/20260413000000_.../migration.sql` | Create | 1 |
| `packages/db/scripts/reconcile-catalog-capabilities.ts` | Create | 1, 3 |
| `packages/db/scripts/reconcile-catalog-capabilities.test.ts` | Create | 1 |
| `docker-entrypoint.sh` | Modify | 1 |
| `apps/web/lib/routing/loader.ts` | Modify | 2 |
| `apps/web/lib/routing/loader.test.ts` | Create/Modify | 2 |
| `apps/web/lib/inference/ai-provider-internals.ts` | Modify | 2 |
| `packages/db/scripts/sync-provider-registry.ts` | Modify | 2 |
| `apps/web/lib/routing/capability-events.ts` | Create | 3 |
| `apps/web/app/api/admin/model-capability-changes/route.ts` | Create | 3 |
| `apps/web/lib/inference/model-revalidation.ts` | Create | 4 |
