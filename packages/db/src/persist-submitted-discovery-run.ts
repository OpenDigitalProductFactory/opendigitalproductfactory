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
import { normalizeDiscoveredFacts } from "./discovery-normalize";
import type { CollectorOutput } from "./discovery-types";

export type SubmittedDiscoveryRunInput = {
  /** Edge Node row id (cuid surrogate). Threaded onto DiscoveryRun.edgeNodeId. */
  edgeNodeId: string;
  /** Stable nodeId (used in sourceSlug for human-readable provenance). */
  nodeId: string;
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
  // Normalize the submitted CollectorOutput. The same code path the
  // bootstrap collectors feed; the agent's job is to emit a valid
  // CollectorOutput, not to pre-normalize.
  const normalized = normalizeDiscoveredFacts(input.submittedOutput);

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
    },
    options,
  );
}
