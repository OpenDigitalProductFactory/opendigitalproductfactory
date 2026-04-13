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
    capabilities: entry.capabilities as Record<string, unknown>,
    maxContextTokens: entry.maxContextTokens,
    maxOutputTokens: entry.maxOutputTokens,
    inputModalities: entry.inputModalities,
    outputModalities: entry.outputModalities,
    modelClass: entry.modelClass,
    modelFamily: entry.modelFamily ?? null,
    friendlyName: entry.friendlyName,
    summary: entry.summary,
    capabilityTier: entry.capabilityTier,
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
    await prisma.modelCapabilityChangeLog.createMany({ data: entries });
  }
}

async function reconcile(): Promise<void> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let noChange = 0;

  // Prune change log entries older than 90 days
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const { count: pruned } = await prisma.modelCapabilityChangeLog.deleteMany({
    where: { changedAt: { lt: cutoff } },
  });
  if (pruned > 0) console.log(`  Pruned ${pruned} change log entries older than 90 days`);

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
          } as Parameters<typeof prisma.modelProfile.create>[0]["data"],
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
    }
  }

  console.log(`\nCatalog reconciliation: ${created} created, ${updated} updated, ${skipped} skipped (discovery/admin-owned), ${noChange} unchanged.`);
}

reconcile()
  .catch((err) => {
    console.error("Reconciliation failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
