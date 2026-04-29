# PR #318 Rename — Drift Surface Audit (A1)

| Field | Value |
|-------|-------|
| **Plan item** | A1 (Wave 1, Track A) of [2026-04-28 sequencing plan](../plans/2026-04-28-coworker-and-routing-sequencing-plan.md) |
| **PR audited** | [#318 — fix(routing): rename ModelProfile.capabilityTier → capabilityCategory (Phase B)](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/318) |
| **Generated** | 2026-04-28 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Scope** | Evidence-only. Enumerate every runtime surface that reads or writes the renamed field, map every deployment path against where `prisma migrate deploy` runs, and characterize the failure class the user observed (marketing coworker → `column ModelProfile.capabilityCategory does not exist`). |
| **Out of scope** | Fixing the drift. The deployment-path decision record is **A2**, the next item; the structural answer is **B1** (Routing Phase A). This document is input to both. |

---

## 1. The user-visible failure

Reported 2026-04-28: starting a marketing strategy session through the marketing coworker fails with:

```
Invalid prisma.modelProfile.findMany() invocation:
  column "ModelProfile.capabilityCategory" does not exist
```

This is the **first observed runtime symptom** of PR #318's drift surface. It will not be the last unless A2 (deployment-path contract) and B1 (control-plane substrate) land first. Memory `feedback_db_seed_migration_sync.md` predicted this class precisely: a schema rename without a runtime substrate that owns the rename's publication boundary creates seed-vs-runtime drift.

**This audit does not propose a fix.** Per the plan's §11, the fix shape depends on B1 (Routing Phase A), and the sequencing rule is "no irreversible architectural choices before evidence." This document is the evidence.

---

## 2. The rename itself

PR #318 made two source-side changes and one schema change:

1. **Schema:** `ModelProfile.capabilityTier` → `capabilityCategory` ([packages/db/prisma/schema.prisma:1220](../../../packages/db/prisma/schema.prisma)).
2. **Migration:** [`packages/db/prisma/migrations/20260428000000_rename_modelprofile_capabilitytier_to_capabilitycategory/migration.sql`](../../../packages/db/prisma/migrations/20260428000000_rename_modelprofile_capabilitytier_to_capabilitycategory/migration.sql) — a single `ALTER TABLE "ModelProfile" RENAME COLUMN "capabilityTier" TO "capabilityCategory";`.
3. **Source-side cleanup:** code in 11 files updated to read the new column name.

### 2.1 What was deliberately *not* renamed

- **`ModelProvider.capabilityTier`** ([packages/db/prisma/schema.prisma:1164](../../../packages/db/prisma/schema.prisma)) — a different concept (MCP service capability sensitivity, paired with `costBand` / `taskTags` / `sensitivityClearance`). The PR commit message documents this exclusion correctly.
- **`RoleRoutingRecipe.capabilityTier`** (in [apps/web/lib/routing/recipe-types.ts:63](../../../apps/web/lib/routing/recipe-types.ts)) — a routing-input vocabulary (`"low" | "medium" | "high"`). The routing spec's §7.2 calls for switching this to canonical `qualityTier` in a separate phase; it was not in #318's scope.

These are the two legitimate surviving uses of the string `capabilityTier`. Anything else still using the name is suspect — and the survey below shows there is more than the existing INV-6b audit reports.

---

## 3. Drift class A — code that still references the *old* `ModelProfile` field name

These are real drift sites. Each one is either (a) an internal type that mirrors the now-renamed column under the old name, (b) test fixtures using the old name, or (c) a write site that will throw at runtime against a migrated DB. The third subclass is the most dangerous.

### 3.1 The smoking gun (write-side runtime error)

[**packages/db/scripts/reconcile-catalog-capabilities.ts:118, 252-254**](../../../packages/db/scripts/reconcile-catalog-capabilities.ts):

```ts
// line 38 — internal struct still uses old name
type CatalogChangeFields = {
  // ...
  capabilityTier: string;    // ← old name, not renamed
  costTier: string;
  qualityTier: string;
  // ...
};

// line 118 — builder produces an object keyed by the old name
return {
  // ...
  capabilityTier: entry.capabilityTier,    // ← old name
  // ...
};

// line 252-254 — write site. The `as Parameters<...>` cast suppresses
// the type error that would have caught this.
await prisma.modelProfile.updateMany({
  where: { ... },
  data: { catalogHash: hash, profileSource: "catalog", ...changedFields }
    as Parameters<typeof prisma.modelProfile.updateMany>[0]["data"],
});
```

The cast was added to keep types passing during the mechanical rename. Without it, TypeScript would have refused the update because `capabilityTier` is no longer a `ModelProfile` field. With it, the error moved from compile time to runtime — the catalog reconciler runs in [docker-entrypoint.sh:36-39](../../../docker-entrypoint.sh) on every container start (step 3b of init), and it will throw the exact error the user saw whenever `changedFields` is non-empty (i.e. whenever any catalog drift exists).

**Memory `feedback_check_tool_signals.md`: don't blame the model; check tool return values.** The TypeScript signal said "this field doesn't exist on this row." The cast silenced it. Fixing #318 would have required either renaming the struct in tandem (deferred — would have widened the PR) or removing the cast and letting types fail until the rename was complete. Neither happened.

### 3.2 Internal type and adapter-layer fictions

These compile and run today, but they tell a lie: the source-of-truth column is `capabilityCategory`, the in-memory struct is `capabilityTier`. Every consumer downstream of these structs is reading vocabulary that doesn't match the schema.

| File | Line(s) | What it does |
|---|---|---|
| [apps/web/lib/inference/ai-provider-priority.ts](../../../apps/web/lib/inference/ai-provider-priority.ts) | 99, 501 | Reads `profile.capabilityCategory` from the DB, then immediately renames it back to `capabilityTier` inside the priority struct: `capabilityTier: profile.capabilityCategory ?? "unknown"` |
| [apps/web/lib/inference/ai-provider-priority.ts](../../../apps/web/lib/inference/ai-provider-priority.ts) | 19, 119, 176, 189, 398, 534-535 | Type and accessors all use the old name |
| [apps/web/lib/inference/ai-provider-types.ts](../../../apps/web/lib/inference/ai-provider-types.ts) | 76 | `capabilityTier: string` in a profile-shaped type |
| [apps/web/lib/inference/ai-profiling.ts](../../../apps/web/lib/inference/ai-profiling.ts) | 21, 43 | LLM profiling prompt and output schema both use the old vocabulary `"deep-thinker" / "fast-worker" / ...` |
| [apps/web/lib/actions/ai-providers.ts](../../../apps/web/lib/actions/ai-providers.ts) | 886, 900, 912 | Server action input type uses `capabilityTier: string` for profile updates |
| [apps/web/lib/integrate/coding-agent.ts](../../../apps/web/lib/integrate/coding-agent.ts) | 53 | Reads `best.capabilityTier` from the priority struct (downstream of 3.2 row 1) |

The adapter-layer fiction is what kept the rename "functionally working" for everything that doesn't write back to the DB. The catalog reconciler is the only writer that flowed through the unrenamed struct.

### 3.3 Test fixtures and dead seed scripts

These reference the old name but do not run in production. Cleaning them is mechanical; not fixing them is a future maintenance landmine.

| File | Line(s) | Notes |
|---|---|---|
| [apps/web/lib/inference/ai-profiling.test.ts](../../../apps/web/lib/inference/ai-profiling.test.ts) | 47, 64 | Tests the LLM profiling generator |
| [apps/web/lib/inference/ai-provider-priority.test.ts](../../../apps/web/lib/inference/ai-provider-priority.test.ts) | 20, 61, 62, 66, 67 | Test fixtures |
| [packages/db/scripts/migrate-capability-tiers.ts](../../../packages/db/scripts/migrate-capability-tiers.ts) | 15-21 | A migration helper authored before #318. Reads `p.capabilityTier`, writes `data: { capabilityTier: newTier }`. Will throw if invoked against a migrated DB. **Should be deleted or renamed by the rename PR.** |
| [packages/db/scripts/seed-service-endpoints.ts](../../../packages/db/scripts/seed-service-endpoints.ts) | 9, 22, 35, 53, 63 | Seeds `capabilityTier` on what looks like a `ModelProvider` row. Class 1 (legitimate `ModelProvider.capabilityTier`) — verify, don't auto-rename |
| [packages/db/scripts/seed-endpoint-manifests.ts](../../../packages/db/scripts/seed-endpoint-manifests.ts) | 14 | Same — verify which row the field is on |

### 3.4 Recipe / deliberation surface (separate concern)

The `RoleRoutingRecipe.capabilityTier` and the deliberation registry's recipe-derived hints are the spec's own "Phase B remainder" work — they're correctly named for *that* concept (a routing input on the recipe, distinct from the ModelProfile field that was just renamed). They should not be touched by #318's drift cleanup. They are:

- [apps/web/lib/routing/recipe-types.ts:63](../../../apps/web/lib/routing/recipe-types.ts) — recipe shape
- [apps/web/lib/deliberation/registry.ts:61, 296-300](../../../apps/web/lib/deliberation/registry.ts) — recipe-derived hints
- [apps/web/lib/deliberation/request-contract.ts:169-170](../../../apps/web/lib/deliberation/request-contract.ts) — recipe → reasoning depth mapping
- Plus their tests.

The existing INV-6b audit ([apps/web/scripts/audit-routing-spec-boot-invariants.ts:312-347](../../../apps/web/scripts/audit-routing-spec-boot-invariants.ts)) flags `recipe-types.ts` correctly under that scope. It does not flag the §3.1/§3.2/§3.3 sites because its scan is limited to `apps/web/lib/routing/`. **The current audit is structurally insufficient as a guard against #318's full drift surface.**

---

## 4. Drift class B — code reading the *new* `ModelProfile` field name

For completeness, the file inventory of the rename's reach. Anywhere this field is read against an unmigrated DB will throw the user's exact error.

| File | Line(s) | Operation |
|---|---|---|
| [packages/db/prisma/schema.prisma](../../../packages/db/prisma/schema.prisma) | 1220 | Schema declaration |
| [packages/db/src/seed.ts](../../../packages/db/src/seed.ts) | 1387, 1523, 1604 | Seed inserts |
| [packages/db/data/model-profiles.json](../../../packages/db/data/model-profiles.json) | many | Static catalog data — keys updated by #318 |
| [apps/web/lib/inference/ai-provider-priority.ts](../../../apps/web/lib/inference/ai-provider-priority.ts) | 73, 78, 84, 250, 264, 483, 487 | Reads via `findMany({ select: { capabilityCategory: true } })` |
| [apps/web/lib/inference/ai-provider-internals.ts](../../../apps/web/lib/inference/ai-provider-internals.ts) | 498, 530, 559, 587, 733, 759, 1036 | Reads, computed values, writes |
| [apps/web/lib/inference/ai-provider-types.ts](../../../apps/web/lib/inference/ai-provider-types.ts) | 154 | Type definition |
| [apps/web/lib/actions/endpoint-performance.ts](../../../apps/web/lib/actions/endpoint-performance.ts) | 49 | `findFirst({ select: { capabilityCategory: true } })` |
| [apps/web/lib/routing/known-provider-models.ts](../../../apps/web/lib/routing/known-provider-models.ts) | 29, 72, 111, 150, 184, 222, 255, 290, 330 | Static catalog data |
| [apps/web/components/platform/EndpointPerformancePanel.tsx](../../../apps/web/components/platform/EndpointPerformancePanel.tsx) | 52, 124 | UI display |
| [apps/web/scripts/audit-routing-spec-boot-invariants.ts](../../../apps/web/scripts/audit-routing-spec-boot-invariants.ts) | 280-290, 318 | Audit logic that handles either name (defensive) |

Other call sites that hit `prisma.modelProfile.findMany`/`findFirst` (any of which can trigger the user's error if their `select` includes `capabilityCategory`):

- [apps/web/lib/actions/ai-providers.ts:552](../../../apps/web/lib/actions/ai-providers.ts)
- [apps/web/lib/actions/endpoint-performance.ts:45, 113, 182](../../../apps/web/lib/actions/endpoint-performance.ts)
- [apps/web/lib/explore/feature-build-data.ts:205](../../../apps/web/lib/explore/feature-build-data.ts)
- [apps/web/lib/operate/endpoint-test-runner.ts:203](../../../apps/web/lib/operate/endpoint-test-runner.ts)
- [apps/web/app/api/diagnostics/preflight/route.ts:147](../../../apps/web/app/api/diagnostics/preflight/route.ts)
- [apps/web/lib/inference/ai-provider-data.ts:193, 223](../../../apps/web/lib/inference/ai-provider-data.ts)
- [apps/web/app/api/agent/health/route.ts:13](../../../apps/web/app/api/agent/health/route.ts)
- [apps/web/lib/inference/ai-provider-priority.ts:76, 179, 243, 481](../../../apps/web/lib/inference/ai-provider-priority.ts)
- [apps/web/lib/routing/loader.ts:83](../../../apps/web/lib/routing/loader.ts)
- [apps/web/lib/inference/ai-provider-internals.ts:817, 951](../../../apps/web/lib/inference/ai-provider-internals.ts)
- [apps/web/lib/routing/eval-runner.ts:162, 391](../../../apps/web/lib/routing/eval-runner.ts)

**18 distinct query sites.** Each is a potential "marketing coworker" — different code path, same error class, against an unmigrated DB.

---

## 5. Deployment-path matrix

Where does `prisma migrate deploy` actually run? This is the question A2 (the next plan item) must answer; A1's job is only to map the current state honestly.

| Path | Where defined | Runs `migrate deploy`? | First-call behavior on stale DB |
|---|---|---|---|
| **Production runner container** | [docker-entrypoint.sh:6-24](../../../docker-entrypoint.sh) | ✅ Yes — 5-retry loop with 3s backoff at every container start | Migrates correctly; no drift visible to runtime. |
| **Build-Studio sandbox container** | [docker-compose.yml:362](../../../docker-compose.yml) `command:` line | ✅ Yes — explicit `pnpm --filter @dpf/db exec prisma migrate deploy` | Migrates correctly. |
| **Dev container (Dockerfile dev stage)** | [Dockerfile:11](../../../Dockerfile) | ❌ **No** — only runs `prisma generate`, then `pnpm --filter web dev` | Schema rename is in the generated client; DB still has old column; **every query that selects `capabilityCategory` errors at runtime.** This is the user's observed failure path. |
| **Host dev (`pnpm dev` against host DB)** | No automation | ❌ Manual only — developer runs `pnpm --filter @dpf/db migrate:deploy` | Same failure mode as dev container. |
| **Pre-commit hook (PR #321)** | [.git/hooks/pre-commit (via git core.hookspath)](../../../) | Generates the Prisma client only | **Does not run migrate deploy.** Closes the client-vs-schema drift surface; does **not** close the schema-vs-DB surface. |
| **Promoter / image build** | [Dockerfile.promoter](../../../Dockerfile.promoter) | Inherits production runner behavior | Migrates on container start. |

**Summary:** the only deployment paths that auto-apply migrations are the production-shape paths (runner, sandbox, promoter). The two paths most active in *development* (dev container, host dev) require manual `migrate deploy`. The user is on one of these.

The pre-commit hook from #321 — `auto-regenerates Prisma client on schema drift` — closes a different drift class (client-out-of-sync-with-schema). It is helpful but it is **not the answer to this audit**; the rename's runtime errors come from schema-out-of-sync-with-DB, which only `migrate deploy` resolves.

---

## 6. Why the existing audit didn't catch this

The boot-invariant audit ([apps/web/scripts/audit-routing-spec-boot-invariants.ts](../../../apps/web/scripts/audit-routing-spec-boot-invariants.ts), shipped in PR #310, baselined in PR #311) has two relevant invariants:

- **INV-6** — checks live DB rows for the legacy LLM-grading vocabulary (`deep-thinker`, `fast-worker`, etc.). Currently flags 15 rows with the legacy values. *Does not detect the column-name drift.*
- **INV-6b** — scans `apps/web/lib/routing/` for any remaining `capabilityTier` references. Currently flags 1 file (`recipe-types.ts`). *Scope is narrow — misses every site outside `lib/routing/`.*

The drift in §3 lives in `lib/inference/`, `lib/actions/`, `lib/integrate/`, `lib/deliberation/`, and `packages/db/scripts/`. INV-6b's directory restriction is what let #318 ship without surfacing the drift.

**Implication for B1 (Routing Phase A) design:** the substrate must include an audit-or-equivalent surface that scans the **whole** codebase for vocabulary drift, not just one directory. A boot-invariant that only checks routing source code is a misleading green light for the rest of the platform.

---

## 7. Failure-class summary (input to A2 and B1)

The marketing-coworker error decomposes into three distinct failure modes that #318 introduced:

1. **Schema-vs-DB drift in non-runner deployment paths.** The dev container and host-dev path do not auto-run `migrate deploy`. Any rename or additive column change ships broken to those paths until the developer runs the command manually. **A2 must answer: until the substrate exists, what is the contract for schema-changing PRs in those paths?**

2. **Type-cast suppression of compile-time signals.** [reconcile-catalog-capabilities.ts:252-254](../../../packages/db/scripts/reconcile-catalog-capabilities.ts) writes a stale field name to the DB through a `Parameters<...>` cast. The cast made the rename look complete; the runtime error proves it wasn't. **A2 should constrain how schema-changing PRs handle types: no `as` casts on Prisma input data unless explicitly justified, because they suppress the rename signal.**

3. **Adapter-layer vocabulary fictions.** Internal structs continue to use the old field name long after the schema renamed it. Functionally fine until someone writes the struct back to the DB; brittle by design. **B1 (Routing Phase A) is the right place to fix this — the publication boundary is where vocabulary translation either becomes explicit or becomes invisible.**

The plan's §11 is correct that the fix sequence is A2 → B1, not "fix the marketing coworker today."

---

## 8. What this audit did *not* do

- **Did not propose a migration-deploy automation in any deployment path.** That's A2's call, and A2 has to weigh whether to add it to the dev container's CMD versus solving it differently.
- **Did not delete or rename the dead seed script** [migrate-capability-tiers.ts](../../../packages/db/scripts/migrate-capability-tiers.ts). It will throw if invoked, but it is not invoked by any current code path. Cleanup belongs in C1/C3 hygiene work, not in a containment audit.
- **Did not edit the typecast in [reconcile-catalog-capabilities.ts:252-254](../../../packages/db/scripts/reconcile-catalog-capabilities.ts).** Removing the cast surfaces the type error that #318 should have surfaced. Fixing the underlying field name in the struct is straightforward but is not "evidence" — it is "fix." The fix lands in A2's contract or B1's substrate, not here.
- **Did not run any database queries.** This audit is fully static — file reads only. It is safe to run against any DB state.

## 9. Inputs A2 should consume from this audit

When A2 (deployment-path decision record) is written, the questions it must answer are:

1. **Until B1 ships, do schema-changing PRs require a verified `migrate deploy` step in the dev container's CMD?** §5 shows the dev container does not currently run it.
2. **Do schema-changing PRs require a sweep of the whole codebase for vocabulary references, not just one directory?** §6 shows INV-6b's scope was insufficient.
3. **Do schema-changing PRs require a `git grep` for the old field name and removal of any internal struct using it?** §3.2 shows the adapter layer fictions exist; whether to ban them in renames is a decision call.
4. **Do schema-changing PRs require the absence of `as Parameters<...>` casts on Prisma input data?** §3.1 shows the cast is what suppressed the type signal.
5. **Do schema-changing PRs require a CI check that runs the migration against an empty DB and exercises representative read paths?** §4 lists 18 query sites; a rename-aware smoke test is bounded scope but real coverage.

A2 picks which of these become the interim contract. B1 (Routing Phase A) decides which become structurally enforced through the substrate.
