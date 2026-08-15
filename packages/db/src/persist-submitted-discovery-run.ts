// Sibling to persistBootstrapDiscoveryRun for the Edge Node ingestion path.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Ingestion contract: submit observations, don't trigger sweeps
//
// Roadmap: docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md A4
//
// The bootstrap path runs collectors *inside the portal container* and
// hands the result to persistBootstrapDiscoveryRun. The Edge Node path
// runs collectors *on the agent host* and POSTs a prepared
// CollectorOutput envelope to /api/v1/edge/discovery-runs. The server
// must skip collector execution and go straight to normalization +
// persistence; that's what this function does.
//
// Implementation: thin wrapper. The downstream pipeline
// (deduplication, projection to InventoryEntity, Neo4j sync) is
// shared with the bootstrap path — only the source of the
// CollectorOutput differs and the runMeta carries an `edgeNodeId` so
// the resulting DiscoveryRun row attributes back to the agent.

import {
  type DiscoveryProjectionOptions,
  type DiscoveryPersistenceSummary,
  type DiscoverySyncClient,
  persistBootstrapDiscoveryRun,
} from "./discovery-sync";

import type { CollectorOutput } from "./discovery-types";
import { normalizeDiscoveredFacts } from "./discovery-normalize";
import { loadDiscoveryAttributionInputs } from "./discovery-attribution-inputs";
import { resolveDiscoveryScopeFromIds } from "./discovery-scope";

export type SubmittedDiscoveryRunInput = {
  /** Edge Node row id (cuid surrogate). Threaded onto DiscoveryRun.edgeNodeId. */
  edgeNodeId: string;
  /** Stable nodeId (used in sourceSlug for human-readable provenance). */
  nodeId: string;
  /** Customer account scope derived from the authenticated EdgeNode. */
  customerAccountId?: string | null;
  /** Customer site scope derived from the authenticated EdgeNode. */
  customerSiteId?: string | null;
  /** Agent-supplied idempotency key. Becomes DiscoveryRun.runKey. */
  runKey: string;
  /** Agent-supplied envelope (CollectorOutput shape). */
  submittedOutput: CollectorOutput;
};

const SUBMITTED_TRIGGER = "edge_node";

/**
 * Persist an Edge-Node-submitted discovery run. Returns the standard
 * persistence summary so the caller (the route handler in A2) can
 * report counts back to the agent.
 *
 * The edgeNodeId is threaded onto DiscoveryRun.edgeNodeId via the
 * runMeta-extension landed in this PR's edit to discovery-sync.ts.
 * Bootstrap runs continue to leave it null.
 */
export async function persistSubmittedDiscoveryRun(
  db: DiscoverySyncClient,
  input: SubmittedDiscoveryRunInput,
  options: DiscoveryProjectionOptions = {},
): Promise<DiscoveryPersistenceSummary> {
  // Derive the discovery scope from the server-authenticated edge node's
  // customer/site ids — never from the submitted output body. The
  // normalizer uses this to scope inventory entity and relationship keys,
  // which is what keeps two customers with the same private IP distinct.
  const discoveryScope = resolveDiscoveryScopeFromIds({
    customerAccountId: input.customerAccountId,
    customerSiteId: input.customerSiteId,
  });

  // Load the taxonomy tree + active fingerprint rules so a device is identified
  // + placed the same way it would be on the bootstrap path. Without this, every
  // edge-submitted ARP host fell through to the coarse `host -> /servers` rule
  // with no resolved identity (BI-BAF38ED3). `db` is the real prisma client at
  // runtime (the edge route passes `prisma`); loadDiscoveryAttributionInputs
  // degrades to no-op inputs for a client that cannot answer the queries.
  const attributionInputs = await loadDiscoveryAttributionInputs(db);

  // Normalize the submitted CollectorOutput. The same code path the
  // bootstrap collectors feed; the agent's job is to emit a valid
  // CollectorOutput, not to pre-normalize.
  const normalized = normalizeDiscoveredFacts(input.submittedOutput, {
    discoveryScope,
    ...attributionInputs,
  });

  // Source slug encodes "this came from edge-node X" so admins can
  // filter discovered items by submission origin without joining
  // through the EdgeNode table for every query.
  const sourceSlug = `edge-node:${input.nodeId}`;

  return persistBootstrapDiscoveryRun(
    db,
    normalized,
    {
      runKey: input.runKey,
      sourceSlug,
      trigger: SUBMITTED_TRIGGER,
      status: "completed",
      edgeNodeId: input.edgeNodeId,
      customerAccountId: input.customerAccountId ?? null,
      customerSiteId: input.customerSiteId ?? null,
    },
    options,
  );
}
