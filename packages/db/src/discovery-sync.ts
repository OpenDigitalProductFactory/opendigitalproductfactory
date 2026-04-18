import { evaluateInventoryQuality } from "./discovery-attribution";
import type { NormalizedDiscoveryOutput } from "./discovery-normalize";
import { deriveInventoryEvidenceSnapshot } from "./discovery-evidence";
import {
  syncInventoryEntityAsInfraCI,
  syncInventoryRelationship,
} from "./neo4j-sync";

export type DiscoveryPersistenceSummary = {
  runId?: string;
  createdEntities: number;
  updatedEntities: number;
  staleEntities: number;
  createdRelationships: number;
  updatedRelationships: number;
  staleRelationships: number;
  createdIssues: number;
};

type DiscoveryRunMeta = {
  runKey: string;
  sourceSlug: string;
  trigger?: string;
  status?: string;
};

type DiscoveryProjectionOptions = {
  projectInventoryEntity?: typeof syncInventoryEntityAsInfraCI;
  projectInventoryRelationship?: typeof syncInventoryRelationship;
};

type DiscoverySyncTx = {
  discoveryRun: {
    create(args: {
      data: {
        runKey: string;
        sourceSlug: string;
        trigger: string;
        status: string;
        completedAt: Date;
        itemCount: number;
        relationshipCount: number;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  inventoryEntity: {
    findMany(args: { select: { entityKey: true } }): Promise<Array<{ entityKey: string }>>;
    upsert(args: {
      where: { entityKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
      select: { id: true; entityKey: true };
    }): Promise<{ id: string; entityKey: string }>;
    updateMany(args: {
      where: { entityKey: { in: string[] } };
      data: { status: string; lastSeenAt: Date };
    }): Promise<{ count: number }>;
  };
  discoveredItem: {
    create(args: {
      data: Record<string, unknown>;
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  discoveredSoftwareEvidence: {
    upsert(args: {
      where: { evidenceKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
  inventoryRelationship: {
    findMany(args: { select: { relationshipKey: true } }): Promise<Array<{ relationshipKey: string }>>;
    upsert(args: {
      where: { relationshipKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
      select: { id: true; relationshipKey: true };
    }): Promise<{ id: string; relationshipKey: string }>;
    updateMany(args: {
      where: { relationshipKey: { in: string[] } };
      data: { status: string; lastSeenAt: Date };
    }): Promise<{ count: number }>;
  };
  discoveredRelationship: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  portfolioQualityIssue: {
    findMany(args: { select: { issueKey: true } }): Promise<Array<{ issueKey: string }>>;
    upsert(args: {
      where: { issueKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

type DiscoverySyncClient = {
  $transaction<T>(fn: (tx: DiscoverySyncTx) => Promise<T>): Promise<T>;
};

function countObjectKeys(value: Record<string, unknown> | undefined): number {
  return value ? Object.keys(value).length : 0;
}

function dedupeDiscoveredItems(
  items: NormalizedDiscoveryOutput["discoveredItems"],
): NormalizedDiscoveryOutput["discoveredItems"] {
  const byKey = new Map<string, NormalizedDiscoveryOutput["discoveredItems"][number]>();

  for (const item of items) {
    const existing = byKey.get(item.discoveredKey);
    if (!existing) {
      byKey.set(item.discoveredKey, item);
      continue;
    }

    const existingConfidence = existing.confidence ?? 0;
    const candidateConfidence = item.confidence ?? 0;
    const existingAttributeCount = countObjectKeys(existing.attributes);
    const candidateAttributeCount = countObjectKeys(item.attributes);

    if (
      candidateConfidence > existingConfidence
      || (candidateConfidence === existingConfidence && candidateAttributeCount > existingAttributeCount)
    ) {
      byKey.set(item.discoveredKey, item);
    }
  }

  return [...byKey.values()];
}

export function summarizeDiscoveryPersistence(
  summary: Partial<DiscoveryPersistenceSummary>,
): DiscoveryPersistenceSummary {
  const normalizedSummary: DiscoveryPersistenceSummary = {
    createdEntities: summary.createdEntities ?? 0,
    updatedEntities: summary.updatedEntities ?? 0,
    staleEntities: summary.staleEntities ?? 0,
    createdRelationships: summary.createdRelationships ?? 0,
    updatedRelationships: summary.updatedRelationships ?? 0,
    staleRelationships: summary.staleRelationships ?? 0,
    createdIssues: summary.createdIssues ?? 0,
  };

  if (summary.runId) {
    normalizedSummary.runId = summary.runId;
  }

  return normalizedSummary;
}

export async function persistBootstrapDiscoveryRun(
  db: DiscoverySyncClient,
  normalized: NormalizedDiscoveryOutput,
  runMeta: DiscoveryRunMeta,
  options: DiscoveryProjectionOptions = {},
): Promise<DiscoveryPersistenceSummary> {
  const projector = {
    projectInventoryEntity: options.projectInventoryEntity ?? syncInventoryEntityAsInfraCI,
    projectInventoryRelationship: options.projectInventoryRelationship ?? syncInventoryRelationship,
  };
  const dedupedDiscoveredItems = dedupeDiscoveredItems(normalized.discoveredItems);

  const projected = await db.$transaction(async (tx) => {
    const now = new Date();
    const softwareEvidenceByEntityKey = new Map<string, NormalizedDiscoveryOutput["softwareEvidence"]>();
    for (const software of normalized.softwareEvidence) {
      const existing = softwareEvidenceByEntityKey.get(software.inventoryEntityKey) ?? [];
      existing.push(software);
      softwareEvidenceByEntityKey.set(software.inventoryEntityKey, existing);
    }
    const existingEntityKeys = new Set(
      (await tx.inventoryEntity.findMany({ select: { entityKey: true } }))
        .map((entity) => entity.entityKey),
    );
    const existingRelationshipKeys = new Set(
      (await tx.inventoryRelationship.findMany({ select: { relationshipKey: true } }))
        .map((relationship) => relationship.relationshipKey),
    );
    const existingIssueKeys = new Set(
      (await tx.portfolioQualityIssue.findMany({ select: { issueKey: true } }))
        .map((issue) => issue.issueKey),
    );

    const run = await tx.discoveryRun.create({
      data: {
        runKey: runMeta.runKey,
        sourceSlug: runMeta.sourceSlug,
        trigger: runMeta.trigger ?? "bootstrap",
        status: runMeta.status ?? "completed",
        completedAt: now,
        itemCount: dedupedDiscoveredItems.length,
        relationshipCount: normalized.inventoryRelationships.length,
      },
      select: { id: true },
    });

    const entityIdsByDiscoveredKey = new Map<string, string>();
    const entityIdsByEntityKey = new Map<string, string>();
    const discoveredItemIdsByKey = new Map<string, string>();
    let createdEntities = 0;
    let updatedEntities = 0;

    for (const entity of normalized.inventoryEntities) {
      const existed = existingEntityKeys.has(entity.entityKey);
      const evidenceSnapshot = deriveInventoryEvidenceSnapshot(
        softwareEvidenceByEntityKey.get(entity.entityKey) ?? [],
      );
      const persistedEntity = await tx.inventoryEntity.upsert({
        where: { entityKey: entity.entityKey },
        create: {
          entityKey: entity.entityKey,
          entityType: entity.entityType,
          name: entity.name,
          manufacturer: evidenceSnapshot.manufacturer,
          productModel: evidenceSnapshot.productModel,
          observedVersion: evidenceSnapshot.observedVersion,
          normalizedVersion: evidenceSnapshot.normalizedVersion,
          supportStatus: evidenceSnapshot.supportStatus,
          status: entity.attributionStatus === "stale" ? "stale" : "active",
          attributionStatus: entity.attributionStatus,
          attributionMethod: entity.attributionMethod ?? null,
          attributionConfidence: entity.attributionConfidence ?? null,
          attributionEvidence: entity.attributionEvidence ?? null,
          candidateTaxonomy: entity.candidateTaxonomy ?? undefined,
          providerView: entity.providerView,
          confidence: entity.confidence ?? null,
          portfolio: entity.portfolioSlug
            ? { connect: { slug: entity.portfolioSlug } }
            : undefined,
          taxonomyNode: entity.taxonomyNodeId
            ? { connect: { nodeId: entity.taxonomyNodeId } }
            : undefined,
          properties: entity.properties,
          firstSeenAt: now,
          lastSeenAt: now,
          lastConfirmedRun: { connect: { id: run.id } },
        },
        update: {
          entityType: entity.entityType,
          name: entity.name,
          ...(evidenceSnapshot.manufacturer ? { manufacturer: evidenceSnapshot.manufacturer } : {}),
          ...(evidenceSnapshot.productModel ? { productModel: evidenceSnapshot.productModel } : {}),
          ...(evidenceSnapshot.observedVersion ? { observedVersion: evidenceSnapshot.observedVersion } : {}),
          ...(evidenceSnapshot.normalizedVersion ? { normalizedVersion: evidenceSnapshot.normalizedVersion } : {}),
          status: entity.attributionStatus === "stale" ? "stale" : "active",
          attributionStatus: entity.attributionStatus,
          attributionMethod: entity.attributionMethod ?? null,
          attributionConfidence: entity.attributionConfidence ?? null,
          attributionEvidence: entity.attributionEvidence ?? null,
          candidateTaxonomy: entity.candidateTaxonomy ?? undefined,
          providerView: entity.providerView,
          confidence: entity.confidence ?? null,
          portfolio: entity.portfolioSlug
            ? { connect: { slug: entity.portfolioSlug } }
            : undefined,
          taxonomyNode: entity.taxonomyNodeId
            ? { connect: { nodeId: entity.taxonomyNodeId } }
            : undefined,
          properties: entity.properties,
          lastSeenAt: now,
          lastConfirmedRun: { connect: { id: run.id } },
        },
        select: { id: true, entityKey: true },
      });

      entityIdsByDiscoveredKey.set(entity.discoveredKey, persistedEntity.id);
      entityIdsByEntityKey.set(entity.entityKey, persistedEntity.id);

      if (existed) {
        updatedEntities += 1;
      } else {
        createdEntities += 1;
      }
    }

    for (const discoveredItem of dedupedDiscoveredItems) {
      const persistedDiscoveredItem = await tx.discoveredItem.create({
        data: {
          discoveryRun: { connect: { id: run.id } },
          observedKey: discoveredItem.discoveredKey,
          itemType: discoveredItem.itemType,
          name: discoveredItem.name,
          sourcePath: discoveredItem.sourcePath ?? null,
          confidence: discoveredItem.confidence ?? null,
          attributionStatus: normalized.inventoryEntities.find(
            (entity) => entity.discoveredKey === discoveredItem.discoveredKey,
          )?.attributionStatus ?? "unmapped",
          rawData: discoveredItem.attributes,
          firstSeenAt: now,
          lastSeenAt: now,
          inventoryEntity: entityIdsByDiscoveredKey.has(discoveredItem.discoveredKey)
            ? { connect: { id: entityIdsByDiscoveredKey.get(discoveredItem.discoveredKey)! } }
            : undefined,
        },
        select: { id: true },
      });
      discoveredItemIdsByKey.set(discoveredItem.discoveredKey, persistedDiscoveredItem.id);
    }

    for (const software of normalized.softwareEvidence) {
      const inventoryEntityId = entityIdsByEntityKey.get(software.inventoryEntityKey);
      if (!inventoryEntityId) {
        continue;
      }

      await tx.discoveredSoftwareEvidence.upsert({
        where: { evidenceKey: software.evidenceKey },
        create: {
          evidenceKey: software.evidenceKey,
          inventoryEntity: { connect: { id: inventoryEntityId } },
          evidenceSource: software.evidenceSource,
          packageManager: software.packageManager ?? null,
          rawVendor: software.rawVendor ?? null,
          rawProductName: software.rawProductName ?? null,
          rawPackageName: software.rawPackageName ?? null,
          rawVersion: software.rawVersion ?? null,
          installLocation: software.installLocation ?? null,
          rawMetadata: software.rawMetadata ?? undefined,
          normalizationStatus: software.normalizationStatus,
          normalizationConfidence: software.normalizationConfidence,
          softwareIdentityId: software.softwareIdentityId ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          inventoryEntity: { connect: { id: inventoryEntityId } },
          evidenceSource: software.evidenceSource,
          packageManager: software.packageManager ?? null,
          rawVendor: software.rawVendor ?? null,
          rawProductName: software.rawProductName ?? null,
          rawPackageName: software.rawPackageName ?? null,
          rawVersion: software.rawVersion ?? null,
          installLocation: software.installLocation ?? null,
          rawMetadata: software.rawMetadata ?? undefined,
          normalizationStatus: software.normalizationStatus,
          normalizationConfidence: software.normalizationConfidence,
          softwareIdentityId: software.softwareIdentityId ?? null,
          lastSeenAt: now,
        },
      });
    }

    const currentEntityKeys = new Set(
      normalized.inventoryEntities.map((entity) => entity.entityKey),
    );
    const staleEntityKeys = [...existingEntityKeys].filter(
      (entityKey) => !currentEntityKeys.has(entityKey),
    );
    const staleEntities = staleEntityKeys.length === 0
      ? 0
      : (await tx.inventoryEntity.updateMany({
          where: { entityKey: { in: staleEntityKeys } },
          data: { status: "stale", lastSeenAt: now },
        })).count;

    let createdRelationships = 0;
    let updatedRelationships = 0;

    for (const relationship of normalized.inventoryRelationships) {
      const fromEntityId = relationship.fromDiscoveredKey
        ? entityIdsByDiscoveredKey.get(relationship.fromDiscoveredKey)
        : undefined;
      const toEntityId = relationship.toDiscoveredKey
        ? entityIdsByDiscoveredKey.get(relationship.toDiscoveredKey)
        : undefined;
      const fromDiscoveredItemId = relationship.fromDiscoveredKey
        ? discoveredItemIdsByKey.get(relationship.fromDiscoveredKey)
        : undefined;
      const toDiscoveredItemId = relationship.toDiscoveredKey
        ? discoveredItemIdsByKey.get(relationship.toDiscoveredKey)
        : undefined;

      if (!fromEntityId || !toEntityId || !fromDiscoveredItemId || !toDiscoveredItemId) {
        continue;
      }

      const existed = existingRelationshipKeys.has(relationship.relationshipKey);
      const persistedRelationship = await tx.inventoryRelationship.upsert({
        where: { relationshipKey: relationship.relationshipKey },
        create: {
          relationshipKey: relationship.relationshipKey,
          relationshipType: relationship.relationshipType,
          status: "active",
          confidence: relationship.confidence ?? null,
          properties: relationship.properties,
          firstSeenAt: now,
          lastSeenAt: now,
          lastConfirmedRun: { connect: { id: run.id } },
          fromEntity: { connect: { id: fromEntityId } },
          toEntity: { connect: { id: toEntityId } },
        },
        update: {
          relationshipType: relationship.relationshipType,
          status: "active",
          confidence: relationship.confidence ?? null,
          properties: relationship.properties,
          lastSeenAt: now,
          lastConfirmedRun: { connect: { id: run.id } },
          fromEntity: { connect: { id: fromEntityId } },
          toEntity: { connect: { id: toEntityId } },
        },
        select: { id: true, relationshipKey: true },
      });

      await tx.discoveredRelationship.create({
        data: {
          discoveryRun: { connect: { id: run.id } },
          relationshipKey: relationship.relationshipKey,
          relationshipType: relationship.relationshipType,
          fromDiscoveredItem: { connect: { id: fromDiscoveredItemId } },
          toDiscoveredItem: { connect: { id: toDiscoveredItemId } },
          confidence: relationship.confidence ?? null,
          rawData: relationship.properties,
          inventoryRelationship: { connect: { id: persistedRelationship.id } },
        },
      });

      if (existed) {
        updatedRelationships += 1;
      } else {
        createdRelationships += 1;
      }
    }

    const currentRelationshipKeys = new Set(
      normalized.inventoryRelationships.map((relationship) => relationship.relationshipKey),
    );
    const staleRelationshipKeys = [...existingRelationshipKeys].filter(
      (relationshipKey) => !currentRelationshipKeys.has(relationshipKey),
    );
    const staleRelationships = staleRelationshipKeys.length === 0
      ? 0
      : (await tx.inventoryRelationship.updateMany({
          where: { relationshipKey: { in: staleRelationshipKeys } },
          data: { status: "stale", lastSeenAt: now },
        })).count;

    const qualityEvaluation = evaluateInventoryQuality(
      [
        ...normalized.inventoryEntities.map((entity) => {
          const evidenceSnapshot = deriveInventoryEvidenceSnapshot(
            softwareEvidenceByEntityKey.get(entity.entityKey) ?? [],
          );
          const qualityEntity = {
            entityKey: entity.entityKey,
            entityType: entity.entityType,
            attributionStatus: entity.attributionStatus,
            attributionMethod: entity.attributionMethod ?? null,
            attributionConfidence: entity.attributionConfidence ?? null,
            candidateTaxonomy: entity.candidateTaxonomy?.map((candidate) => ({
              nodeId: candidate.nodeId,
              score: candidate.score,
            })) ?? null,
            taxonomyNodeId: entity.taxonomyNodeId ?? null,
            digitalProductId: null,
            manufacturer: evidenceSnapshot.manufacturer,
            observedVersion: evidenceSnapshot.observedVersion,
            normalizedVersion: evidenceSnapshot.normalizedVersion,
            supportStatus: evidenceSnapshot.supportStatus,
            hasSoftwareEvidence: evidenceSnapshot.hasSoftwareEvidence,
            normalizationStatus: evidenceSnapshot.normalizationStatus,
          };

          if (entity.attributionStatus === "needs_review") {
            return {
              ...qualityEntity,
              qualityStatus: "warning" as const,
            };
          }

          return qualityEntity;
        }),
        ...staleEntityKeys.map((entityKey) => ({
          entityKey,
          entityType: "inventory_entity",
          attributionStatus: "stale" as const,
        })),
      ],
      staleRelationshipKeys.map((relationshipKey) => ({
        relationshipKey,
        relationshipType: "inventory_relationship",
        status: "stale" as const,
      })),
    );

    let createdIssues = 0;
    for (const issue of qualityEvaluation.issues) {
      const inventoryEntityId = issue.inventoryEntityKey
        ? entityIdsByEntityKey.get(issue.inventoryEntityKey)
        : undefined;

      const resolvedTaxonomyNodeId = issue.inventoryEntityKey
        ? normalized.inventoryEntities.find(
            (entity) => entity.entityKey === issue.inventoryEntityKey,
          )?.taxonomyNodeId ?? undefined
        : undefined;

      await tx.portfolioQualityIssue.upsert({
        where: { issueKey: issue.issueKey },
        create: {
          issueKey: issue.issueKey,
          issueType: issue.issueType,
          status: issue.status,
          severity: issue.severity,
          summary: issue.summary,
          ...(resolvedTaxonomyNodeId
            ? { taxonomyNode: { connect: { nodeId: resolvedTaxonomyNodeId } } }
            : {}),
          ...(inventoryEntityId ? { inventoryEntity: { connect: { id: inventoryEntityId } } } : {}),
        },
        update: {
          issueType: issue.issueType,
          status: issue.status,
          severity: issue.severity,
          summary: issue.summary,
          ...(resolvedTaxonomyNodeId
            ? { taxonomyNode: { connect: { nodeId: resolvedTaxonomyNodeId } } }
            : {}),
          ...(inventoryEntityId ? { inventoryEntity: { connect: { id: inventoryEntityId } } } : {}),
        },
      });

      if (!existingIssueKeys.has(issue.issueKey)) {
        createdIssues += 1;
      }
    }

    return {
      summary: summarizeDiscoveryPersistence({
        runId: run.id,
        createdEntities,
        updatedEntities,
        staleEntities,
        createdRelationships,
        updatedRelationships,
        staleRelationships,
        createdIssues,
      }),
      entitiesToProject: normalized.inventoryEntities.map((entity) => ({
        entityKey: entity.entityKey,
        name: entity.name,
        entityType: entity.entityType,
        status: entity.attributionStatus === "stale" ? "stale" : "active",
        portfolioSlug: entity.portfolioSlug ?? null,
      })),
      relationshipsToProject: normalized.inventoryRelationships.flatMap((relationship) => {
        const fromEntityKey = relationship.fromDiscoveredKey
          ? normalized.inventoryEntities.find(
              (entity) => entity.discoveredKey === relationship.fromDiscoveredKey,
            )?.entityKey
          : undefined;
        const toEntityKey = relationship.toDiscoveredKey
          ? normalized.inventoryEntities.find(
              (entity) => entity.discoveredKey === relationship.toDiscoveredKey,
            )?.entityKey
          : undefined;

        if (!fromEntityKey || !toEntityKey) {
          return [];
        }

        return [{
          fromEntityKey,
          toEntityKey,
          relationshipType: relationship.relationshipType,
        }];
      }),
    };
  });

  for (const entity of projected.entitiesToProject) {
    await projector.projectInventoryEntity(entity).catch((error: unknown) => {
      console.warn("[discovery-sync] Failed to project inventory entity", entity.entityKey, error);
    });
  }

  for (const relationship of projected.relationshipsToProject) {
    await projector.projectInventoryRelationship(relationship).catch((error: unknown) => {
      console.warn(
        "[discovery-sync] Failed to project inventory relationship",
        relationship.relationshipType,
        error,
      );
    });
  }

  return projected.summary;
}
