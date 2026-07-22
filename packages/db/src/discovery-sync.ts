import { evaluateInventoryQuality } from "./discovery-attribution";
import type { NormalizedDiscoveryOutput } from "./discovery-normalize";
import { deriveInventoryEvidenceSnapshot } from "./discovery-evidence";
import { deriveInventoryEnrichment } from "./inventory-enrichment";
import {
  syncInventoryEntityAsInfraCI,
  syncInventoryRelationship,
} from "./graph-sync";

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
  // Edge Node attribution per spec § Edge Node registry. Optional —
  // bootstrap-discovery runs have no edgeNodeId. When set, the
  // DiscoveryRun row carries this through so consumers can attribute
  // observations back to a specific agent.
  edgeNodeId?: string | null;
  // Customer-estate scope derived server-side from the authenticated
  // EdgeNode, never from an edge request body.
  customerAccountId?: string | null;
  customerSiteId?: string | null;
};

export type DiscoveryProjectionOptions = {
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
        edgeNodeId?: string | null;
        customerAccountId?: string | null;
        customerSiteId?: string | null;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  inventoryEntity: {
    findMany(args: {
      where?: {
        scopeKey?: string;
        lastConfirmedRun?: { sourceSlug?: string };
      };
      select: { entityKey: true };
    }): Promise<Array<{ entityKey: string }>>;
    upsert(args: {
      where: { entityKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
      select: { id: true; entityKey: true };
    }): Promise<{ id: string; entityKey: string }>;
    updateMany(args: {
      where: { scopeKey?: string; entityKey: { in: string[] } };
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
  // Resolution-lineage audit (spec §4.1) — one row per NEW rule-resolved identity
  // for an entity. findFirst is the idempotency guard so a repeated sweep that
  // re-resolves the same entity→identity does not append a duplicate audit row;
  // a resolution to a *different* CatalogIdentity does write a fresh lineage row.
  identityResolutionLog: {
    findFirst(args: {
      where: {
        inventoryEntityId: string;
        catalogIdentityId: string;
        resolutionType: string;
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  inventoryRelationship: {
    findMany(args: {
      where?: {
        scopeKey?: string;
        lastConfirmedRun?: { sourceSlug?: string };
      };
      // BI-PIR-7d69a445 (part 2): the tuple is the canonical identity, so the
      // existing-relationship read pulls the tuple columns (+ id for the stale
      // sweep, + relationshipKey for the stale-relationship quality issue).
      select: {
        id: true;
        relationshipKey: true;
        fromEntityId: true;
        toEntityId: true;
        relationshipType: true;
      };
    }): Promise<Array<{
      id: string;
      relationshipKey: string;
      fromEntityId: string;
      toEntityId: string;
      relationshipType: string;
    }>>;
    upsert(args: {
      // Conflict target is the compound @@unique, NOT relationshipKey, so a tuple
      // persisted by a prior run under a different relationshipKey UPDATES rather
      // than crashing on the create path (P2002).
      where: {
        fromEntityId_toEntityId_relationshipType: {
          fromEntityId: string;
          toEntityId: string;
          relationshipType: string;
        };
      };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
      select: { id: true; relationshipKey: true };
    }): Promise<{ id: string; relationshipKey: string }>;
    updateMany(args: {
      where: { id: { in: string[] } };
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
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

export type DiscoverySyncClient = {
  $transaction<T>(fn: (tx: DiscoverySyncTx) => Promise<T>): Promise<T>;
};

function countObjectKeys(value: Record<string, unknown> | undefined): number {
  return value ? Object.keys(value).length : 0;
}

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

/**
 * Stable key for an InventoryRelationship's persisted-identity tuple
 * (fromEntityId, toEntityId, relationshipType) — the columns of the compound
 * `@@unique([fromEntityId, toEntityId, relationshipType])`. Used to dedupe
 * relationships within a single persistence run so two distinct relationshipKeys
 * that resolve to the same persisted tuple upsert the row once (BI-PIR-7d69a445).
 * The `|` separator cannot appear in cuid ids (alphanumeric) or relationship-type
 * slugs, so the composed key is unambiguous.
 */
export function relationshipTupleKey(
  fromEntityId: string,
  toEntityId: string,
  relationshipType: string,
): string {
  return `${fromEntityId}|${toEntityId}|${relationshipType}`;
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
    const runScope = scopeFieldsFromRunMeta(runMeta);
    const scopeWhere = { scopeKey: runScope.scopeKey };
    // Source attribution via lastConfirmedRun.sourceSlug: a sweep from one
    // source only sees the entities/relationships it has previously
    // confirmed. A unifi sweep with no dpf_bootstrap-attributed rows in
    // its view cannot mark dpf_bootstrap rows stale. Composes with the
    // scopeKey filter so cross-customer isolation still holds.
    const sourceFilter = { lastConfirmedRun: { sourceSlug: runMeta.sourceSlug } };
    const existingEntityKeys = new Set(
      (await tx.inventoryEntity.findMany({
        where: { ...scopeWhere, ...sourceFilter },
        select: { entityKey: true },
      })).map((entity) => entity.entityKey),
    );
    // BI-PIR-7d69a445 (part 2): key existing relationships by their canonical
    // tuple (fromEntityId, toEntityId, relationshipType) rather than by
    // relationshipKey. relationshipKey is source-scoped provenance that can differ
    // across runs for the same real relationship, so keying created-vs-updated
    // accounting and the stale sweep on it double-counts and mis-sweeps across
    // runs. The tuple is the compound @@unique — the real identity. relationshipKey
    // is retained per row so the stale-relationship quality issue can still name it.
    const existingRelationshipByTuple = new Map<string, { id: string; relationshipKey: string }>();
    for (const existing of await tx.inventoryRelationship.findMany({
      where: { ...scopeWhere, ...sourceFilter },
      select: {
        id: true,
        relationshipKey: true,
        fromEntityId: true,
        toEntityId: true,
        relationshipType: true,
      },
    })) {
      existingRelationshipByTuple.set(
        relationshipTupleKey(existing.fromEntityId, existing.toEntityId, existing.relationshipType),
        { id: existing.id, relationshipKey: existing.relationshipKey },
      );
    }
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
        // Threaded through from runMeta so edge-node-submitted runs
        // are attributable; bootstrap runs leave it undefined and the
        // column default (null) takes effect.
        ...(runMeta.edgeNodeId !== undefined
          ? { edgeNodeId: runMeta.edgeNodeId }
          : {}),
        ...(runMeta.customerAccountId !== undefined
          ? { customerAccountId: runMeta.customerAccountId }
          : {}),
        ...(runMeta.customerSiteId !== undefined
          ? { customerSiteId: runMeta.customerSiteId }
          : {}),
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
      // Enrichment closes the gap between raw discovery signals (MAC OUI
      // vendor in properties, container image tag, name patterns) and the
      // typed columns the UI reads. evidenceSnapshot only sees package-
      // manager softwareEvidence; this layer reads `properties` directly
      // so unifi MAC vendors, docker image tags, and Nest/postgres/etc.
      // name hints actually populate manufacturer/iconKey/version.
      const enrichment = deriveInventoryEnrichment({
        entityType: entity.entityType,
        name: entity.name,
        manufacturer: evidenceSnapshot.manufacturer,
        productModel: evidenceSnapshot.productModel,
        observedVersion: evidenceSnapshot.observedVersion,
        normalizedVersion: evidenceSnapshot.normalizedVersion,
        iconKey: null,
        supportStatus: evidenceSnapshot.supportStatus,
        properties: entity.properties as unknown as import("../generated/client/client").Prisma.JsonValue,
      });
      const persistedEntity = await tx.inventoryEntity.upsert({
        where: { entityKey: entity.entityKey },
        create: {
          entityKey: entity.entityKey,
          entityType: entity.entityType,
          name: entity.name,
          manufacturer: enrichment.manufacturer,
          productModel: enrichment.productModel,
          observedVersion: enrichment.observedVersion,
          normalizedVersion: enrichment.normalizedVersion,
          iconKey: enrichment.iconKey,
          supportStatus: enrichment.supportStatus,
          status: entity.attributionStatus === "stale" ? "stale" : "active",
          attributionStatus: entity.attributionStatus,
          attributionMethod: entity.attributionMethod ?? null,
          attributionConfidence: entity.attributionConfidence ?? null,
          attributionEvidence: entity.attributionEvidence ?? null,
          candidateTaxonomy: entity.candidateTaxonomy ?? undefined,
          // Enrichment linkage to the canonical identity spine (BI-27EE2AF7).
          catalogIdentity: entity.catalogIdentityId
            ? { connect: { id: entity.catalogIdentityId } }
            : undefined,
          identityStatus: entity.identityStatus ?? null,
          identityConfidence: entity.identityConfidence ?? null,
          providerView: entity.providerView,
          confidence: entity.confidence ?? null,
          portfolio: entity.portfolioSlug
            ? { connect: { slug: entity.portfolioSlug } }
            : undefined,
          taxonomyNode: entity.taxonomyNodeId
            ? { connect: { nodeId: entity.taxonomyNodeId } }
            : undefined,
          properties: entity.properties,
          scopeKey: runScope.scopeKey,
          customerAccount: runScope.customerAccountId
            ? { connect: { id: runScope.customerAccountId } }
            : undefined,
          customerSite: runScope.customerSiteId
            ? { connect: { id: runScope.customerSiteId } }
            : undefined,
          firstSeenAt: now,
          lastSeenAt: now,
          lastConfirmedRun: { connect: { id: run.id } },
        },
        update: {
          entityType: entity.entityType,
          name: entity.name,
          // Use the enriched values; never overwrite a populated column
          // with null (the `null && X` short-circuit guards that).
          ...(enrichment.manufacturer ? { manufacturer: enrichment.manufacturer } : {}),
          ...(enrichment.productModel ? { productModel: enrichment.productModel } : {}),
          ...(enrichment.observedVersion ? { observedVersion: enrichment.observedVersion } : {}),
          ...(enrichment.normalizedVersion ? { normalizedVersion: enrichment.normalizedVersion } : {}),
          ...(enrichment.iconKey ? { iconKey: enrichment.iconKey } : {}),
          ...(enrichment.supportStatus !== "unknown" ? { supportStatus: enrichment.supportStatus } : {}),
          status: entity.attributionStatus === "stale" ? "stale" : "active",
          attributionStatus: entity.attributionStatus,
          attributionMethod: entity.attributionMethod ?? null,
          attributionConfidence: entity.attributionConfidence ?? null,
          attributionEvidence: entity.attributionEvidence ?? null,
          candidateTaxonomy: entity.candidateTaxonomy ?? undefined,
          // Enrichment linkage (BI-27EE2AF7) — only written on a fresh rule match
          // that resolved a CatalogIdentity; never clobber an existing link with null.
          ...(entity.catalogIdentityId
            ? {
                catalogIdentity: { connect: { id: entity.catalogIdentityId } },
                identityStatus: entity.identityStatus ?? null,
                identityConfidence: entity.identityConfidence ?? null,
              }
            : {}),
          providerView: entity.providerView,
          confidence: entity.confidence ?? null,
          portfolio: entity.portfolioSlug
            ? { connect: { slug: entity.portfolioSlug } }
            : undefined,
          taxonomyNode: entity.taxonomyNodeId
            ? { connect: { nodeId: entity.taxonomyNodeId } }
            : undefined,
          properties: entity.properties,
          scopeKey: runScope.scopeKey,
          customerAccount: runScope.customerAccountId
            ? { connect: { id: runScope.customerAccountId } }
            : { disconnect: true },
          customerSite: runScope.customerSiteId
            ? { connect: { id: runScope.customerSiteId } }
            : { disconnect: true },
          lastSeenAt: now,
          lastConfirmedRun: { connect: { id: run.id } },
        },
        select: { id: true, entityKey: true },
      });

      entityIdsByDiscoveredKey.set(entity.discoveredKey, persistedEntity.id);
      entityIdsByEntityKey.set(entity.entityKey, persistedEntity.id);

      // Resolution-lineage audit (spec §4.1). A deterministic fingerprint-rule
      // match that resolved a CatalogIdentity writes an IdentityResolutionLog
      // row (resolutionType='rule'). Idempotent: only the first resolution of
      // this entity→identity is recorded, so a weekly re-sweep of an unchanged
      // estate does not grow the audit log. A later resolution to a different
      // identity writes a new lineage row. Human-confirmed rows are authored
      // elsewhere and are never touched by this rule path (spec §4.1).
      if (entity.catalogIdentityId && entity.identityStatus === "rule_resolved") {
        const existingLog = await tx.identityResolutionLog.findFirst({
          where: {
            inventoryEntityId: persistedEntity.id,
            catalogIdentityId: entity.catalogIdentityId,
            resolutionType: "rule",
          },
          select: { id: true },
        });
        if (existingLog === null) {
          await tx.identityResolutionLog.create({
            data: {
              inventoryEntityId: persistedEntity.id,
              catalogIdentityId: entity.catalogIdentityId,
              fingerprintRuleId: entity.fingerprintRuleId ?? null,
              resolutionType: "rule",
              confidence: entity.identityConfidence ?? null,
              evidence: entity.attributionEvidence ?? null,
              discoveryRunId: run.id,
            },
          });
        }
      }

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
    // Stale detection: any entity previously confirmed by THIS source
    // (via lastConfirmedRun.sourceSlug above) that wasn't observed in
    // the current run is marked stale. Scope filter handles cross-customer
    // isolation; source filter handles cross-source isolation within a
    // scope. A unifi sweep cannot mark dpf_bootstrap or edge-node rows
    // stale because their lastConfirmedRun.sourceSlug differs.
    const staleEntityKeys = [...existingEntityKeys]
      .filter((entityKey) => !currentEntityKeys.has(entityKey));
    const staleEntities = staleEntityKeys.length === 0
      ? 0
      : (await tx.inventoryEntity.updateMany({
          where: { ...scopeWhere, entityKey: { in: staleEntityKeys } },
          data: { status: "stale", lastSeenAt: now },
        })).count;

    let createdRelationships = 0;
    let updatedRelationships = 0;
    // BI-PIR-7d69a445: within a single run, maps each resolved relationship tuple
    // (fromEntityId, toEntityId, relationshipType) to the InventoryRelationship id
    // already upserted for it, so a second relationship that collapses onto the
    // same tuple under a DIFFERENT relationshipKey reuses that row instead of
    // taking the create path and violating the compound @@unique.
    const persistedRelationshipIdByTuple = new Map<string, string>();

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

      // BI-PIR-7d69a445: entity dedup can map two distinct discovered refs onto
      // one persisted entity id, so two relationships with DISTINCT
      // relationshipKeys can resolve to the SAME (fromEntityId, toEntityId,
      // relationshipType) tuple. This in-run map (part 1) collapses same-run tuple
      // collisions so only the first relationship for a tuple upserts and later
      // colliding keys reuse its id. Part 2 re-points the upsert conflict target
      // itself at the tuple @@unique, so a tuple persisted by a PRIOR run (under a
      // different relationshipKey) now UPDATES rather than crashing on the create
      // path. The DiscoveredRelationship below is still written for every
      // relationship, so each source key keeps its own provenance row linked to
      // the shared InventoryRelationship.
      const tupleKey = relationshipTupleKey(
        fromEntityId,
        toEntityId,
        relationship.relationshipType,
      );
      let persistedRelationshipId = persistedRelationshipIdByTuple.get(tupleKey);
      if (!persistedRelationshipId) {
        const existed = existingRelationshipByTuple.has(tupleKey);
        const persistedRelationship = await tx.inventoryRelationship.upsert({
          // BI-PIR-7d69a445 (part 2): conflict target is the compound @@unique,
          // not relationshipKey. When a PRIOR run already persisted this tuple
          // (under any relationshipKey), the upsert now UPDATES that row instead
          // of taking the create path and violating the tuple @@unique (the
          // cross-run P2002). The in-run persistedRelationshipIdByTuple guard above
          // still collapses same-run tuple collisions (part 1).
          where: {
            fromEntityId_toEntityId_relationshipType: {
              fromEntityId,
              toEntityId,
              relationshipType: relationship.relationshipType,
            },
          },
          create: {
            relationshipKey: relationship.relationshipKey,
            relationshipType: relationship.relationshipType,
            status: "active",
            confidence: relationship.confidence ?? null,
            properties: relationship.properties,
            scopeKey: runScope.scopeKey,
            customerAccount: runScope.customerAccountId
              ? { connect: { id: runScope.customerAccountId } }
              : undefined,
            customerSite: runScope.customerSiteId
              ? { connect: { id: runScope.customerSiteId } }
              : undefined,
            firstSeenAt: now,
            lastSeenAt: now,
            lastConfirmedRun: { connect: { id: run.id } },
            fromEntity: { connect: { id: fromEntityId } },
            toEntity: { connect: { id: toEntityId } },
          },
          update: {
            // Refresh relationshipKey to the latest observed source key. The
            // per-run provenance history is preserved on DiscoveredRelationship;
            // this column just carries the most-recent source key for the shared
            // canonical row (now non-unique, so no P2002 on this write).
            relationshipKey: relationship.relationshipKey,
            relationshipType: relationship.relationshipType,
            status: "active",
            confidence: relationship.confidence ?? null,
            properties: relationship.properties,
            scopeKey: runScope.scopeKey,
            customerAccount: runScope.customerAccountId
              ? { connect: { id: runScope.customerAccountId } }
              : { disconnect: true },
            customerSite: runScope.customerSiteId
              ? { connect: { id: runScope.customerSiteId } }
              : { disconnect: true },
            lastSeenAt: now,
            lastConfirmedRun: { connect: { id: run.id } },
            fromEntity: { connect: { id: fromEntityId } },
            toEntity: { connect: { id: toEntityId } },
          },
          select: { id: true, relationshipKey: true },
        });
        persistedRelationshipId = persistedRelationship.id;
        persistedRelationshipIdByTuple.set(tupleKey, persistedRelationshipId);

        if (existed) {
          updatedRelationships += 1;
        } else {
          createdRelationships += 1;
        }
      }

      await tx.discoveredRelationship.create({
        data: {
          discoveryRun: { connect: { id: run.id } },
          relationshipKey: relationship.relationshipKey,
          relationshipType: relationship.relationshipType,
          fromDiscoveredItem: { connect: { id: fromDiscoveredItemId } },
          toDiscoveredItem: { connect: { id: toDiscoveredItemId } },
          confidence: relationship.confidence ?? null,
          rawData: relationship.properties,
          inventoryRelationship: { connect: { id: persistedRelationshipId } },
        },
      });
    }

    // BI-PIR-7d69a445 (part 2): staleness is tuple-identity based. Any tuple this
    // source previously confirmed (existingRelationshipByTuple — already scope +
    // source filtered, same column-based source attribution as entities above)
    // that was NOT re-persisted this run (persistedRelationshipIdByTuple holds
    // every tuple resolved in the loop) is stale, and is marked by row id. Keying
    // on the tuple rather than relationshipKey means a prior run's row re-observed
    // this run under a DIFFERENT relationshipKey is correctly treated as confirmed
    // (its tuple is in persistedRelationshipIdByTuple), not swept stale.
    const staleExistingRelationships = [...existingRelationshipByTuple.entries()]
      .filter(([tupleKey]) => !persistedRelationshipIdByTuple.has(tupleKey))
      .map(([, value]) => value);
    // relationshipKey of each stale row, for the stale-relationship quality issue.
    const staleRelationshipKeys = staleExistingRelationships.map((value) => value.relationshipKey);
    const staleRelationships = staleExistingRelationships.length === 0
      ? 0
      : (await tx.inventoryRelationship.updateMany({
          where: { id: { in: staleExistingRelationships.map((value) => value.id) } },
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

    // Reconcile-on-recovery: an entity or relationship observed active in THIS
    // sweep is no longer stale, so any open stale_entity / stale_relationship
    // issue for it must resolve. The stale-issue writer only ever opened rows and
    // never resolved recovered ones, so a row that went stale for one sweep and
    // came back stayed open forever (the churn that accumulated 1.5k+ open rows).
    // Keyed by issueKey — the entity/relationship key is embedded — so this is
    // source-bounded by construction: a key this sweep confirmed active belongs to
    // this source, and another source's stale issue has a different key and is
    // never matched. Docker-origin churn is handled by suppression at emission (it
    // never recovers under the same key); this closes the loop for real estate.
    const recoveredEntityIssueKeys = [...currentEntityKeys].map(
      (entityKey) => `inventory_entity:${entityKey}:stale`,
    );
    if (recoveredEntityIssueKeys.length > 0) {
      await tx.portfolioQualityIssue.updateMany({
        where: {
          issueType: "stale_entity",
          status: "open",
          issueKey: { in: recoveredEntityIssueKeys },
        },
        data: { status: "resolved", resolvedAt: now },
      });
    }
    const recoveredRelationshipIssueKeys = normalized.inventoryRelationships.map(
      (relationship) => `inventory_relationship:${relationship.relationshipKey}:stale`,
    );
    if (recoveredRelationshipIssueKeys.length > 0) {
      await tx.portfolioQualityIssue.updateMany({
        where: {
          issueType: "stale_relationship",
          status: "open",
          issueKey: { in: recoveredRelationshipIssueKeys },
        },
        data: { status: "resolved", resolvedAt: now },
      });
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
