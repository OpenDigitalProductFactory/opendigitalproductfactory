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
import { existsSync } from "fs";
import { dirname, posix, resolve as nativeResolve, win32 } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { prisma } from "../src/client";
import type { Prisma } from "../generated/client/client";
import type { KnownModel } from "../../../apps/web/lib/routing/known-provider-models";

type KnownProviderModelsByProvider = Record<string, KnownModel[]>;

export type CatalogPathResolutionOptions = {
  scriptDir?: string;
  packagedWebSourceRoot?: string;
  exists?: (candidate: string) => boolean;
};

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
  capabilityCategory: string;
  costTier: string;
  qualityTier: string;
  modelStatus: string;
  metadataSource: string;
  metadataConfidence: string;
};

// Compile-time drift guard — this would have caught #318 (ModelProfile.capabilityTier
// → capabilityCategory). Every key this mapping writes MUST be a real column on the
// generated ModelProfile create input. A schema rename that leaves a stale key here (or
// a typo'd column) makes this line fail `tsc`, so CI's typecheck gate blocks the merge —
// instead of the reconciler throwing PrismaClientValidationError and crash-looping the
// portal at boot the first time a brand-new catalog model reaches the create path.
// NOTE: object-literal spreads (`...fields`) suppress TS's missing-required-property
// check at the create call site, so relying on the create payload's type is NOT enough —
// this explicit key assertion is the safeguard that actually bites.
type _ProfileShapeKeysAreRealColumns =
  keyof ProfileUpdateShape extends keyof Prisma.ModelProfileUncheckedCreateInput ? true : never;
const _assertProfileShapeKeysAreRealColumns: _ProfileShapeKeysAreRealColumns = true;
void _assertProfileShapeKeysAreRealColumns;

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function resolveForPathStyle(basePath: string, ...segments: string[]): string {
  if (isWindowsAbsolutePath(basePath)) {
    return win32.resolve(basePath, ...segments);
  }
  if (basePath.startsWith("/")) {
    return posix.resolve(basePath, ...segments);
  }
  return nativeResolve(basePath, ...segments);
}

export function resolveKnownProviderModelsPath(
  options: CatalogPathResolutionOptions = {},
): string {
  const scriptDir = options.scriptDir ?? dirname(fileURLToPath(import.meta.url));
  const exists = options.exists ?? existsSync;
  const repoCatalog = resolveForPathStyle(scriptDir, "../../../apps/web/lib/routing/known-provider-models.ts");
  const packagedCatalog = resolveForPathStyle(
    options.packagedWebSourceRoot ?? "/app/apps/web-src",
    "lib/routing/known-provider-models.ts",
  );

  return [repoCatalog, packagedCatalog].find((candidate) => exists(candidate)) ?? repoCatalog;
}

export async function loadKnownProviderModels(): Promise<KnownProviderModelsByProvider> {
  const catalogPath = resolveKnownProviderModelsPath();
  const catalogModule = await import(pathToFileURL(catalogPath).href);
  return catalogModule.KNOWN_PROVIDER_MODELS as KnownProviderModelsByProvider;
}

/** Recursively sorts all object keys for stable serialization. */
function sortedJson(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortedJson);
  if (obj !== null && typeof obj === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[k] = sortedJson((obj as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return obj;
}

/** Deterministic SHA-256 hash of a catalog entry (all keys sorted recursively for stability). */
export function buildCatalogHash(entry: KnownModel): string {
  const stable = JSON.stringify(sortedJson(entry));
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

/**
 * Returns only the fields that differ between current profile and new entry,
 * excluding any fields protected by capabilityOverrides.
 * If profileSource is "admin" and capabilityOverrides is null, the calling loop
 * is responsible for skipping the row entirely — this function does not handle
 * that guard itself.
 */
export function diffExcludingOverrides(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  overrides: Record<string, unknown> | null,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(incoming)) {
    if (overrides && key in overrides) continue; // admin-pinned field
    // Compare canonically. `capabilities` round-trips through Postgres jsonb,
    // which re-orders keys (by length, then bytewise), so a plain
    // JSON.stringify of the stored blob never matches the source order of the
    // catalog literal. Without sorting, that field would report as changed on
    // every single run and write a changelog entry each boot.
    const currentVal = JSON.stringify(sortedJson(current[key] ?? null));
    const incomingVal = JSON.stringify(sortedJson(incoming[key] ?? null));
    if (currentVal !== incomingVal) {
      diff[key] = incoming[key];
    }
  }
  return diff;
}

/** Map a KnownModel entry to the ModelProfile fields we manage. */
export function catalogEntryToProfileFields(entry: KnownModel): ProfileUpdateShape {
  const scores = entry.scores ?? {
    reasoning: 50,
    codegen: 50,
    toolFidelity: 50,
    instructionFollowingScore: 50,
    structuredOutputScore: 50,
    conversational: 50,
    contextRetention: 50,
  };
  return {
    supportsToolUse: entry.capabilities.toolUse === true,
    toolFidelity: scores.toolFidelity,
    reasoning: scores.reasoning,
    codegen: scores.codegen,
    instructionFollowingScore: scores.instructionFollowingScore,
    structuredOutputScore: scores.structuredOutputScore,
    conversational: scores.conversational,
    contextRetention: scores.contextRetention,
    capabilities: entry.capabilities as unknown as Record<string, unknown>,
    maxContextTokens: entry.maxContextTokens,
    maxOutputTokens: entry.maxOutputTokens,
    inputModalities: entry.inputModalities,
    outputModalities: entry.outputModalities,
    modelClass: entry.modelClass,
    modelFamily: entry.modelFamily ?? null,
    friendlyName: entry.friendlyName,
    summary: entry.summary,
    capabilityCategory: entry.capabilityCategory,
    costTier: entry.costTier,
    qualityTier: entry.qualityTier,
    modelStatus: entry.defaultStatus === "active"
      ? "active"
      : entry.defaultStatus === "retired"
      ? "retired"
      : "disabled",
    metadataSource: "curated",
    metadataConfidence: "high",
  };
}

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
    await prisma.modelCapabilityChangeLog.createMany({
      data: entries as Prisma.ModelCapabilityChangeLogCreateManyInput[],
    });
  }
}

async function reconcile(): Promise<void> {
  const KNOWN_PROVIDER_MODELS = await loadKnownProviderModels();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let noChange = 0;
  let failed = 0;

  // Prune change log entries older than 90 days
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const { count: pruned } = await prisma.modelCapabilityChangeLog.deleteMany({
    where: { changedAt: { lt: cutoff } },
  });
  if (pruned > 0) console.log(`  Pruned ${pruned} change log entries older than 90 days`);

  for (const [providerId, models] of Object.entries(KNOWN_PROVIDER_MODELS)) {
    for (const entry of models) {
      const { modelId } = entry;
      // Per-model isolation: one bad model (e.g. a catalog/schema mismatch that
      // makes the create payload invalid) must not abort the whole reconcile or
      // crash the portal at boot. Log it loudly, count it, and move on — every
      // other model still reconciles. The shell invocation is already non-fatal;
      // this keeps a single failure from starving all models that follow it.
      try {
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
        // New model — upsert DiscoveredModel then create ModelProfile
        await prisma.discoveredModel.upsert({
          where: { providerId_modelId: { providerId, modelId } },
          update: { rawMetadata: entry as unknown as object, lastSeenAt: new Date() },
          create: { providerId, modelId, rawMetadata: entry as unknown as object },
        });
        const fields = catalogEntryToProfileFields(entry);
        await prisma.modelProfile.create({
          data: {
            providerId,
            modelId,
            profileSource: "catalog",
            catalogHash: hash,
            generatedBy: "reconcile-catalog-capabilities",
            bestFor: entry.bestFor,
            avoidFor: entry.avoidFor,
            ...fields,
          } as Prisma.ModelProfileUncheckedCreateInput,
        });
        console.log(`  CREATED  ${providerId}/${modelId}`);
        const newFieldsForLog = fields as unknown as Record<string, unknown>;
        await logChanges(providerId, modelId, newFieldsForLog, {}, "catalog");
        created++;
        continue;
      }

      // Discovery-owned — never touch
      if (profile.profileSource === "auto-discover" || profile.profileSource === "evaluated") {
        skipped++;
        continue;
      }

      // Admin row with null capabilityOverrides — fully protected (row-level lock)
      if (profile.profileSource === "admin" && !profile.capabilityOverrides) {
        skipped++;
        continue;
      }

      // NOTE: catalogHash is deliberately NOT used to skip the comparison below.
      // It hashes the catalog ENTRY (the source), so a match only proves the
      // catalog has not changed since we last wrote — it says nothing about
      // whether the profile ROW still matches it. Anything that mutates the row
      // afterwards (metadata-sync, an activation eval, an admin edit, a manual
      // repair) leaves the hash matching while the row has drifted, and the old
      // short-circuit then reported "unchanged" forever without ever comparing a
      // field.
      //
      // That is not hypothetical: every zai-coding profile sat with
      // capabilities.streaming = null while the catalog declared `true`. The
      // routing hard filter drops any endpoint without streaming === true on a
      // sync call, so all 8 models were silently unroutable and the Build Studio
      // plan phase had no eligible provider at all — while reconcile logged
      // "12 unchanged, 0 updated" at every boot (BI-E552BB73).
      //
      // The row is already fetched with every managed field selected, so the
      // diff below costs no extra query. The hash is still written, and is still
      // useful as a provenance marker, but it can no longer vouch for state it
      // does not describe.

      // Compute what changed, excluding admin-pinned fields
      const overrides = profile.capabilityOverrides as Record<string, unknown> | null;
      const incoming = catalogEntryToProfileFields(entry);
      const changedFields = diffExcludingOverrides(
        profile as Record<string, unknown>,
        incoming as Record<string, unknown>,
        overrides,
      );

      if (Object.keys(changedFields).length === 0) {
        // All changes were in overridden fields — still update hash to prevent future re-checks
        await prisma.modelProfile.updateMany({
          where: { providerId, modelId },
          data: { catalogHash: hash } as Parameters<typeof prisma.modelProfile.updateMany>[0]["data"],
        });
        noChange++;
        continue;
      }

      await prisma.modelProfile.updateMany({
        where: { providerId, modelId },
        data: { catalogHash: hash, profileSource: "catalog", ...changedFields } as Parameters<typeof prisma.modelProfile.updateMany>[0]["data"],
      });

      const changedKeys = Object.keys(changedFields).join(", ");
      console.log(`  UPDATED  ${providerId}/${modelId} [${changedKeys}]`);
      await logChanges(
        providerId,
        modelId,
        changedFields,
        profile as Record<string, unknown>,
        "catalog",
      );
      updated++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  FAILED   ${providerId}/${modelId}: ${message}`);
        failed++;
      }
    }
  }

  console.log(`\nCatalog reconciliation: ${created} created, ${updated} updated, ${skipped} skipped (discovery/admin-owned), ${noChange} unchanged, ${failed} failed.`);
  if (failed > 0) {
    console.error(`  WARNING: ${failed} model(s) failed to reconcile (see FAILED lines above). Portal boot continues; affected models keep their prior profile, or none if brand-new.`);
  }
}

// Only run reconcile() when invoked directly (e.g. `tsx scripts/reconcile-catalog-capabilities.ts`).
// Without this guard, importing the module from a test file kicks off DB I/O that races vitest's
// shutdown — when the rejection lands during the run, process.exit(1) flips the suite red.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reconcile()
    .catch((err) => {
      console.error("Reconciliation failed:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
