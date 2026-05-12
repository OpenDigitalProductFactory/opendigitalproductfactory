// Edge Node observation submission orchestration.
//
// Wraps `persistSubmittedDiscoveryRun` with the request-level concerns
// the spec lists: envelope validation, schema validation, trust-state
// gate, and routing to the shared normalization + persistence pipeline.
//
// Per the spec's "Ingestion contract" section:
//
//   Edge Node submission
//     → validate envelope (auth, schema, freshness, edgeNodeId trust)
//     → normalizeDiscoveredFacts(submittedItems, submittedRelationships)
//     → inferCrossCollectorRelationships
//     → persistSubmittedDiscoveryRun({...})
//
// Auth + trust-state happens in `lib/edge-nodes/auth.ts`; this module
// owns schema + freshness + the call into the persistence pipeline.

import {
  inferCrossCollectorRelationships,
  normalizeDiscoveredFacts,
  persistSubmittedDiscoveryRun,
  prisma,
  type CollectorOutput,
  type DiscoveredItemInput,
  type DiscoveredRelationshipInput,
} from "@dpf/db";

import type { EdgeAuthContext } from "./auth";

const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_ITEMS_PER_RUN = 5_000;
const MAX_RELATIONSHIPS_PER_RUN = 10_000;

export type SubmitObservationsInput = {
  authContext: EdgeAuthContext;
  envelope: {
    nodeId: string;
    agentMode: string;
    agentVersion: string;
    observedAt: string;
    capabilities: ReadonlyArray<string>;
    items: ReadonlyArray<unknown>;
    relationships?: ReadonlyArray<unknown>;
    warnings?: ReadonlyArray<unknown>;
  };
};

export type SubmitObservationsResult =
  | {
      ok: true;
      runId?: string;
      itemCount: number;
      relationshipCount: number;
      summary: {
        createdEntities: number;
        updatedEntities: number;
        staleEntities: number;
        createdRelationships: number;
        updatedRelationships: number;
        staleRelationships: number;
        createdIssues: number;
      };
    }
  | {
      ok: false;
      status: 400 | 401 | 413;
      error:
        | "nodeId_mismatch"
        | "missing_envelope_fields"
        | "items_payload_too_large"
        | "relationships_payload_too_large"
        | "stale_observation"
        | "invalid_observedAt";
    };

function isItemLike(value: unknown): value is DiscoveredItemInput {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.itemType === "string"
    && typeof record.name === "string";
}

function isRelationshipLike(value: unknown): value is DiscoveredRelationshipInput {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.relationshipType === "string";
}

export async function submitObservations(
  input: SubmitObservationsInput,
): Promise<SubmitObservationsResult> {
  const env = input.envelope;
  if (!env.nodeId || !env.agentVersion || !env.observedAt || !env.agentMode) {
    return { ok: false, status: 400, error: "missing_envelope_fields" };
  }

  if (env.nodeId !== input.authContext.nodeId) {
    return { ok: false, status: 401, error: "nodeId_mismatch" };
  }

  const observedAt = new Date(env.observedAt);
  if (Number.isNaN(observedAt.getTime())) {
    return { ok: false, status: 400, error: "invalid_observedAt" };
  }
  // Reject anything more than the freshness window into the past or the
  // future. Future-dated submissions are a clock-skew red flag; far-past
  // submissions are stale and inventory truth shouldn't drift backward.
  const skewMs = Math.abs(Date.now() - observedAt.getTime());
  if (skewMs > FRESHNESS_WINDOW_MS) {
    return { ok: false, status: 400, error: "stale_observation" };
  }

  if (env.items.length > MAX_ITEMS_PER_RUN) {
    return { ok: false, status: 413, error: "items_payload_too_large" };
  }
  const relationshipsArr = env.relationships ?? [];
  if (relationshipsArr.length > MAX_RELATIONSHIPS_PER_RUN) {
    return { ok: false, status: 413, error: "relationships_payload_too_large" };
  }

  const items = env.items.filter(isItemLike);
  const relationships = relationshipsArr.filter(isRelationshipLike);

  const collectorOutput: CollectorOutput = {
    items,
    relationships,
    software: [],
    warnings: [],
  };

  const enriched = inferCrossCollectorRelationships(collectorOutput);
  const normalized = normalizeDiscoveredFacts(enriched);

  const summary = await persistSubmittedDiscoveryRun(
    prisma as never,
    normalized,
    {
      edgeNodeId: input.authContext.edgeNodeId,
      agentVersion: env.agentVersion,
      agentMode: env.agentMode,
    },
  );

  return {
    ok: true,
    runId: summary.runId,
    itemCount: items.length,
    relationshipCount: relationships.length,
    summary: {
      createdEntities: summary.createdEntities,
      updatedEntities: summary.updatedEntities,
      staleEntities: summary.staleEntities,
      createdRelationships: summary.createdRelationships,
      updatedRelationships: summary.updatedRelationships,
      staleRelationships: summary.staleRelationships,
      createdIssues: summary.createdIssues,
    },
  };
}
