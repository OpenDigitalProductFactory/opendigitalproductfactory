import type {
  syncInventoryEntityAsInfraCI,
  syncInventoryRelationship,
} from "./graph-sync";
import type { InventoryEntityHeapIntegrityTx } from "./inventory-entity-heap-integrity";

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

export type DiscoveryRunMeta = {
  runKey: string;
  sourceSlug: string;
  trigger?: string;
  status?: string;
  // Optional for bootstrap discovery; scoped edge runs carry these values.
  edgeNodeId?: string | null;
  customerAccountId?: string | null;
  customerSiteId?: string | null;
};

export type DiscoveryProjectionOptions = {
  projectInventoryEntity?: typeof syncInventoryEntityAsInfraCI;
  projectInventoryRelationship?: typeof syncInventoryRelationship;
};

export type DiscoverySyncTx = InventoryEntityHeapIntegrityTx & {
  discoveryRun: {
    create(args: {
      data: {
        runKey: string;
        sourceSlug: string;
        trigger: string;
        status: string;
        // Written explicitly rather than deferred to the schema's
        // `@default(now())`: the default is evaluated by Postgres at INSERT,
        // AFTER the transaction's own `now` has already been stamped onto every
        // observed entity as `lastSeenAt` — which made every freshly-confirmed
        // entity read as stale. Required, not optional, so a future caller
        // cannot silently fall back to the skewed default.
        startedAt: Date;
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
        mergedIntoId?: null;
        status?: { not: string };
      };
      select: { entityKey: true };
    }): Promise<Array<{ entityKey: string }>>;
    upsert(args: {
      where: { entityKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
      // Identity columns are selected back so quality evaluation can read the
      // PERSISTED row. `manufacturer` / `supportStatus` are sticky across sources
      // while `properties` is replaced each sweep, so the row is the only complete
      // view of what discovery has established about an entity.
      select: {
        id: true;
        entityKey: true;
        manufacturer: true;
        observedVersion: true;
        normalizedVersion: true;
        supportStatus: true;
      };
    }): Promise<{
      id: string;
      entityKey: string;
      manufacturer: string | null;
      observedVersion: string | null;
      normalizedVersion: string | null;
      supportStatus: string;
    }>;
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
        mergedIntoId?: null;
        status?: { not: string };
      };
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
      where: {
        id: { in: string[] };
        mergedIntoId?: null;
        status?: { not: string };
      };
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
