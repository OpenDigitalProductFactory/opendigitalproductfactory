# Model Capability Lifecycle Management

**Spec ID:** EP-MODEL-CAP-001  
**Date:** 2026-04-13  
**Revision:** 3 (post implementation-readiness review)  
**Status:** Draft — Ready for implementation planning  
**Author:** AI Ops Engineer / Mark Bodman  

---

## 1. Problem Statement

Model capability data (tool use support, context windows, quality scores, modality support) has a broken lifecycle. Changes made in code never automatically propagate to the DB, and the DB values that actually drive routing decisions can become arbitrarily stale.

This caused a 5-week outage of custom tool use for the Codex provider: the old adapter wrote `capabilities.toolUse = false` into the DB, and no startup process ever corrected it — not even after code was fixed and the container rebuilt.

### Root cause

The capability data lifecycle has three disconnected segments with no bridge between them:

```text
known-provider-models.ts  ──(no path on startup)──▶  DB (ModelProfile)
                                                           │
         adapter-openai.ts                                │
         adapter-anthropic.ts  ──(only on manual sync)────┘
         ...

         DB (ModelProfile)  ──(loader.ts)──▶  routing decisions
```

**The gap:** When code changes (static catalog or adapter logic), the DB is not updated until an admin manually triggers discovery or re-authenticates the provider.

### Consequences

| Scenario | Current behaviour | Expected behaviour |
| -------- | ----------------- | ------------------ |
| Code fix to capability flag | Silently ignored until manual sync | Applied at next restart |
| New model added to static catalog | Not usable until manual sync | Available at restart |
| Model retired in catalog | Continues to route until manual sync | Disabled at restart |
| Fresh install | Manual sync required per provider | Works on first boot |

---

## 2. Research & Benchmarking

### Patterns evaluated

**Adopted: Content-hash drift detection (Kubernetes ConfigMap approach)**  
CRD controllers track the last-applied configuration hash alongside the live state. On reconciliation, a hash mismatch triggers an update; a hash match is a no-op. Avoids unnecessary writes and produces clear audit trails. Adapted here as dual-hash tracking (catalog hash + discovery hash) on `ModelProfile`.

**Adopted: Source-tagged priority resolution (Kubernetes merge strategy)**  
Strategic merge patch distinguishes "user-set" from "default" values so that explicit user intent is never overwritten by defaults. Adapted here as `profileSource` + `capabilityOverrides` + source-aware resolvers to ensure discovery values win over catalog values and admin field overrides win over both.

**Adopted: DB advisory locks for singleton jobs (session-scoped `pg_try_advisory_lock`)**  
Postgres advisory locks provide a lightweight distributed mutex without a separate Redis/ZooKeeper dependency. Used by PgBoss, Graphile Worker, and other Postgres-native job schedulers. Adapted here for the scheduled revalidation job using a dedicated DB session held for the duration of the run (not transaction-scoped lock calls).

**Adopted: Batched/coalesced event emission (Debezium / change data capture pattern)**  
CDC systems batch row-level changes into per-table or per-transaction events rather than per-field events. Adapted here: capability changes are accumulated per model during a reconciliation run and emitted as a single `model.capabilities.reconciled` event at the end.

**Rejected: External model capability registries (e.g., OpenRouter /models, LiteLLM model list)**  
These provide partial coverage and require external network access at startup. Our static catalog + live discovery provides better fidelity for the providers we actually use (Anthropic, OpenAI Responses API, ChatGPT backend). Using an external registry as an additional source would add complexity without removing the core gap.

**Rejected: Event sourcing for ModelProfile (immutable log + projection)**  
Full event sourcing would provide complete audit history but requires significant schema rework and adds operational overhead disproportionate to the problem. The `ModelCapabilityChangeLog` table provides sufficient audit capability with a conventional mutable record + changelog pattern.

**Anti-pattern avoided: Implicit last-write-wins**  
Many systems silently overwrite capability data on every sync regardless of source. This creates race conditions between catalog reconciliation and live discovery running concurrently. The source-priority model prevents this.

---

## 3. Current Architecture (Baseline)

### 3.1 Data sources

| Source | Location | What it contains | When consumed |
| ------ | -------- | ---------------- | ------------- |
| Static catalog | `apps/web/lib/routing/known-provider-models.ts` | Per-model: toolUse, toolFidelity, context window, quality tier, dimension scores | Only when live discovery returns 0 results (`seedKnownModels`) |
| Provider registry | `packages/db/data/providers-registry.json` | Provider-level: supportsToolUse boolean, baseUrl, authMethod | On every startup via `sync-provider-registry.ts` |
| Live API discovery | Provider `/v1/models` or `/backend-api/models` | Raw model metadata | On manual sync or provider activation |
| Adapter extraction | `adapter-openai.ts`, `adapter-anthropic.ts`, etc. | Parsed ModelCard from raw metadata | During profiling after discovery |

### 3.2 DB tables

- **`ModelProvider`** — provider-level config (supportsToolUse, baseUrl, status)
- **`DiscoveredModel`** — raw API response per model (source of truth for re-profiling)
- **`ModelProfile`** — parsed capability record consumed by the router

### 3.3 `profileSource` values (existing)

`ModelProfile.profileSource` currently takes: `"seed"`, `"auto-discover"`, `"evaluated"`, `"admin"`. The proposed catalog source adds `"catalog"`. This field drives source-priority write logic.

`profileSource` is required with default `"seed"` in the current schema, so reconciliation logic assumes non-null values.

### 3.4 Startup sequence (current)

```text
portal-init:
  [1] prisma migrate deploy
  [2] sync-provider-registry.ts    ← updates ModelProvider only
  [3] seed.ts                      ← no capability refresh
  [4] detect-hardware.ts
  [5] bootstrap source volume
```

No step touches `ModelProfile`. Stale capability data survives indefinitely across container rebuilds.

### 3.5 Routing consumption

`loader.ts` supplies capability data to the router via this fallback chain:

```typescript
supportsToolUse: mp.capabilities?.toolUse    // explicit adapter value (highest priority)
  ?? mp.supportsToolUse                       // DB-level boolean
  ?? mp.provider.supportsToolUse              // provider-level fallback
```

A stored `false` (not `null`) in `capabilities.toolUse` short-circuits the fallback chain and permanently disables tools — even if the provider-level flag is `true`. This is the mechanism that caused the 5-week outage.

---

## 4. Desired State

### 4.1 Principles

1. **Code is authoritative for catalog-managed capability data.** Changes to `known-provider-models.ts` reach the DB on the next restart.
2. **Discovery is authoritative for live-discovered capability data.** Live API values overwrite catalog values for models that appear in discovery.
3. **Admin overrides are always authoritative at the field level.** Automated processes may update non-overridden fields, but never keys present in `capabilityOverrides`.
4. **Startup idempotence.** Running the init sequence multiple times produces zero writes when nothing has changed.
5. **Graceful degradation.** If a provider is unreachable at startup, the system routes using existing capability data. Missing data is better than incorrect data.
6. **Change visibility.** All capability changes (by any mechanism) are logged with source, timestamp, and old/new values.

### 4.2 Capability tier precedence (highest to lowest)

```text
admin (human override)
  └── discovery (live API + adapter)
        └── catalog (known-provider-models.ts)
              └── provider-level fallback (providers-registry.json)
```

A higher-tier value always wins. A lower-tier write never overwrites a higher-tier value. This is enforced by `profileSource` plus `capabilityOverrides` (see §5.3).

### 4.3 "Updated by discovery" marker

**Open question answered:** A profile is considered "updated by discovery" when its `profileSource` is `"auto-discover"` or `"evaluated"` AND its `discoveryHash` matches the hash of the most recent `DiscoveredModel.rawMetadata` for that model. A profile with a stale `discoveryHash` (hash mismatch) is eligible for re-profiling even if its `profileSource` is `"auto-discover"`.

Catalog reconciliation treats any profile with `profileSource IN ("catalog", "seed")` as catalog-managed and eligible for overwrite. Profiles with `profileSource IN ("auto-discover", "evaluated")` are not touched by catalog reconciliation — only by discovery.

### 4.4 Admin override granularity

**Open question answered:** Admin overrides are **field-level**, not row-level. Introducing a `capabilityOverrides` JSON column on `ModelProfile` stores only the fields the admin has explicitly set. During resolution, an overridden field value wins over all other sources. Fields not in `capabilityOverrides` follow the tier precedence normally. This prevents a single admin override of `toolUse` from freezing unrelated fields like `toolFidelity`.

---

## 5. Proposed Design

### 5.1 DB schema additions (required before all other phases)

#### `ModelCapabilityChangeLog`

```prisma
model ModelCapabilityChangeLog {
  id         String   @id @default(cuid())
  providerId String
  modelId    String
  field      String
  oldValue   Json?    // typed JSON, not stringified
  newValue   Json?
  source     String   // "catalog" | "discovery" | "admin" | "provider-sync"
  changedAt  DateTime @default(now())
  changedBy  String?  // userId for admin changes, null for automated

  @@index([providerId, changedAt])
  @@index([modelId, changedAt])
}
```

Use `Json?` columns (not `String?`) for `oldValue`/`newValue` to preserve types (booleans stay booleans, integers stay integers). No FK to `ModelProvider` or `ModelProfile` — change log is append-only and must survive profile deletion.

#### `ModelProfile` additions

```prisma
// New columns on existing ModelProfile model
catalogHash       String?   // hash of known-provider-models.ts entry
discoveryHash     String?   // hash of DiscoveredModel.rawMetadata at last profiling
capabilityOverrides Json?   // field-level admin overrides: { "toolUse": true, ... }

// Existing column change
supportsToolUse   Boolean?  // nullable: null means "unknown/not explicitly set"
```

Removing `rawMetadataHash` overload: it retains its original meaning (discovery payload hash) and maps directly to `discoveryHash`. A new `catalogHash` field tracks catalog entry drift independently.

Because `supportsToolUse` is currently non-null with default `false`, include a one-time normalization migration:

```sql
ALTER TABLE "ModelProfile" ALTER COLUMN "supportsToolUse" DROP DEFAULT;
ALTER TABLE "ModelProfile" ALTER COLUMN "supportsToolUse" DROP NOT NULL;

-- Preserve existing discovery hashes in the new explicit column.
UPDATE "ModelProfile"
SET "discoveryHash" = "rawMetadataHash"
WHERE "discoveryHash" IS NULL
  AND "rawMetadataHash" IS NOT NULL;

-- Convert ambiguous historical default false values to null when no explicit toolUse exists.
UPDATE "ModelProfile"
SET "supportsToolUse" = NULL
WHERE "supportsToolUse" = false
  AND COALESCE(("capabilities"->>'toolUse')::boolean, NULL) IS NULL
  AND "profileSource" IN ('seed', 'catalog');
```

### 5.2 Startup catalog reconciliation (EP-MODEL-CAP-001-A)

Add step `[3b]` to `docker-entrypoint.sh`, after seed:

```sh
echo "[3b] Reconciling model capability catalog..."
pnpm --filter @dpf/db exec tsx scripts/reconcile-catalog-capabilities.ts \
  || echo "  WARN Catalog reconciliation had warnings (non-fatal)"
echo "  OK Catalog reconciliation complete"
```

**`reconcile-catalog-capabilities.ts` algorithm:**

```text
for each entry in KNOWN_PROVIDER_MODELS:
  hash = sha256(JSON.stringify(entry, sortedKeys))
  profile = ModelProfile.findFirst({ where: { providerId, modelId } })

  if profile is null:
    // New model — create DiscoveredModel + ModelProfile
    upsert DiscoveredModel(rawMetadata: entry)
    create ModelProfile(profileSource: "catalog", catalogHash: hash, ...)
    log change for each capability field (oldValue: null)
    continue

  if profile.profileSource in ["auto-discover", "evaluated"]:
    // Owned by discovery — do not touch
    continue

  if profile.catalogHash == hash:
    // No change — skip (idempotent)
    continue

  // Catalog has changed — update non-overridden catalog fields only
  changedFields = diffExcludingOverrides(profile, entry, profile.capabilityOverrides)
  if changedFields is empty:
    continue
  update ModelProfile(catalogHash: hash, ...changedFields)
  emit ModelCapabilityChangeLog entries for changedFields (source: "catalog")
```

**No writes when nothing has changed.** Hash equality check makes every re-run a no-op for stable catalogs.

### 5.3 Source-priority capability resolution (EP-MODEL-CAP-001-B)

Replace the `??` chain in `loader.ts` with an explicit resolver:

```typescript
function resolveToolUse(
  profile: ModelProfile & { provider: ModelProvider }
): boolean | null {
  // 1. Field-level admin override wins unconditionally
  const adminOverride = (profile.capabilityOverrides as Record<string, unknown> | null);
  if (adminOverride?.toolUse !== undefined) return adminOverride.toolUse as boolean;

  // 2. Discovery value (from adapter-extracted capabilities JSON)
  //    Only use if profile is discovery-owned and discovery hash is current
  if (["auto-discover", "evaluated"].includes(profile.profileSource ?? "")) {
    const discoveryValue = (profile.capabilities as Record<string, unknown> | null)?.toolUse;
    if (discoveryValue !== undefined && discoveryValue !== null) return discoveryValue as boolean;
  }

  // 3. Catalog value (from reconciliation)
  if (["catalog", "seed"].includes(profile.profileSource ?? "")) {
    const catalogCaps = (profile.capabilities as Record<string, unknown> | null)?.toolUse;
    if (catalogCaps !== undefined && catalogCaps !== null) return catalogCaps as boolean;
  }

  // 4. Profile-level boolean (provider-sync baseline; nullable means unknown)
  if (profile.supportsToolUse !== null) return profile.supportsToolUse;

  // 5. Provider floor
  return profile.provider.supportsToolUse ?? null;
}
```

Apply the same resolver pattern to `toolFidelity` and other scored dimensions.

### 5.4 Provider-level null-backfill (EP-MODEL-CAP-001-C)

In `sync-provider-registry.ts`, after upserting `ModelProvider`, backfill **only null** `ModelProfile.supportsToolUse` values for profiles belonging to that provider:

```sql
UPDATE "ModelProfile"
SET "supportsToolUse" = $providerValue
WHERE "providerId" = $providerId
  AND "supportsToolUse" IS NULL
  AND "profileSource" NOT IN ('admin')
```

This sets a baseline for models where no adapter value has ever been written, without overwriting any model-level value — false positive risk eliminated.

### 5.5 Scheduled re-validation with distributed safety (EP-MODEL-CAP-001-D)

The revalidation flow extends the existing `model-discovery-refresh` job in the `portal` container (not `portal-init`) so there is one discovery/revalidation path:

- **Startup**: 90 seconds after the portal health check passes (not immediately — avoids hammering providers during boot storms)
- **Daily**: 03:00 UTC by updating the existing job schedule (no second daily job)

**Distributed safety (single-instance guard):**

```typescript
async function runWithAdvisoryLock<T>(
  jobId: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const lockKey = hashToInt32(jobId); // deterministic integer from job ID
  const client = await pgPool.connect(); // dedicated session for lock lifetime
  try {
    const { rows } = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [lockKey],
    );
    if (!rows[0]?.acquired) {
      console.log(`[${jobId}] Lock not acquired — another instance is running`);
      return null;
    }
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => {});
    client.release();
  }
}
```

**Jitter**: startup job adds `Math.random() * 30_000` ms jitter (0–30s) to avoid synchronized boot storms in scaled deployments.

**Timeout budget**: discovery per provider is capped at 60s. Total revalidation job has a 10-minute hard timeout.

**Retry/backoff**: individual provider failures are logged and skipped (non-fatal). The job completes with a partial success report. Failed providers are retried on the next scheduled run.

### 5.6 Batched capability change events (EP-MODEL-CAP-001-E)

Do not emit per-field events during reconciliation. Instead, accumulate all changes within a reconciliation run and emit one batched event per affected model:

```typescript
// At end of reconciliation run, not during
agentEventBus.emit("model.capabilities.reconciled", {
  runId: nanoid(),
  source: "catalog" | "discovery",
  providerId,
  changedModels: [
    {
      modelId,
      fields: { toolUse: { old: false, new: null }, toolFidelity: { old: 10, new: 80 } },
    },
  ],
  unchangedCount: N,
  skippedCount: M, // admin-owned or discovery-owned rows
});
```

Route cache invalidation subscribes to this event and invalidates only the affected provider's cached manifests — not the entire cache.

---

## 6. Implementation Phases

### Phase 1 — Schema + startup reconciliation (resolves core gap)

1. Migration: add `catalogHash`, `discoveryHash`, `capabilityOverrides` to `ModelProfile`
2. Migration: create `ModelCapabilityChangeLog` with indexes
3. Migration: make `supportsToolUse` nullable + normalize ambiguous legacy defaults to `NULL`
4. Script: `reconcile-catalog-capabilities.ts`
5. `docker-entrypoint.sh`: add step `[3b]`

**Outcome:** Code changes to `known-provider-models.ts` propagate on the next container restart. The 5-week outage class is permanently resolved.

### Phase 2 — Routing fallback hardening

1. `resolveToolUse()` and equivalent dimension resolvers in `loader.ts`
2. `capabilityOverrides` field-level merge at resolution time
3. Provider-level null-backfill in `sync-provider-registry.ts`

**Outcome:** A single adapter bug can never silently kill tools again. Admin overrides are field-scoped, not row-scoped.

### Phase 3 — Observability

1. `ModelCapabilityChangeLog` writes in reconciliation script and discovery pipeline
2. Batched event emission with `agentEventBus`
3. Route cache invalidation on `model.capabilities.reconciled`
4. Admin > AI Providers: show last reconciliation time, changed model count, and link to change log

**Outcome:** Every capability change has a source, timestamp, and before/after value. No silent mutations.

### Phase 4 — Scheduled re-validation

1. Startup revalidation job (90s delay + jitter)
2. Update existing daily `model-discovery-refresh` schedule to 03:00 UTC
3. Advisory lock + timeout + retry/backoff
4. "Sync Models & Profiles" button now calls the same job (no separate code path)

**Outcome:** Manual sync button is optional. Capability data stays current without admin intervention.

---

## 7. Out of Scope

- Model pricing and cost management
- Provider authentication / credential rotation
- Model benchmark evaluation (scoring pipeline)
- A/B testing / champion-challenger routing

---

## 8. Success Criteria

- [ ] A code change to `known-provider-models.ts` is reflected in the DB within one container restart, with no manual admin action
- [ ] A stale `capabilities.toolUse = false` on a catalog-managed profile is corrected at startup
- [ ] Discovery-owned profiles are never overwritten by catalog reconciliation
- [ ] Admin field-level overrides survive discovery and catalog reconciliation
- [ ] All capability changes are logged in `ModelCapabilityChangeLog` with source, timestamp, and typed old/new values
- [ ] Reconciliation is a no-op (zero writes) when nothing has changed
- [ ] Scheduled revalidation does not duplicate work when multiple portal instances are running
- [ ] The Admin > AI Providers UI shows last reconciliation time per provider
