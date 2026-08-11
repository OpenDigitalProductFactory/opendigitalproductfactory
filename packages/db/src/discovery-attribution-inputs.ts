// Shared loader for the two seed-populated inputs the normalizer needs to
// identify + place a discovered device: the taxonomy tree (heuristic scoring)
// and the active discovery-fingerprint rules (spec §4 layer 0, deterministic
// OUI/vendor identification).
//
// Why this module exists: this exact load used to be inlined only in
// `discovery-runner.ts`. The two OTHER ingestion entry points —
// `persistSubmittedDiscoveryRun` (edge-node ARP/SNMP/UniFi submissions) and the
// portal UniFi connection action — normalized WITHOUT these inputs, so
// `fingerprintAttribution` short-circuited on empty rules and every host fell
// through to the coarse `host -> /servers` attribution. Every real-network
// device (a Whirlpool appliance, an Echo, a Nest) was mis-filed as a "server"
// with no resolved identity. (BI-BAF38ED3.)
//
// Extracting one loader and calling it from all three sites makes the three
// paths structurally identical: a device is identified the same way regardless
// of which collector observed it.

import type { AdapterRule, AdapterRuleStatus } from "./discovery-fingerprint-adapter";
import type { FingerprintMatchExpression, ResolvedIdentity } from "./discovery-fingerprint-rules";
import { flattenEnrichmentForScoring } from "./discovery-attribution";
import type { NormalizeDiscoveryOptions } from "./discovery-normalize";

type TaxonomyNodeCandidate = NonNullable<NormalizeDiscoveryOptions["taxonomyNodes"]>[number];

export type DiscoveryAttributionInputs = {
  taxonomyNodes?: TaxonomyNodeCandidate[];
  fingerprintRules?: AdapterRule[];
};

// Structural view of the Prisma client members this loader touches. Kept narrow
// and duck-typed so any caller holding a real prisma client (or a test double
// exposing these findMany shapes) can supply it without a hard @dpf/db import
// cycle. When a member is absent (e.g. a minimal sync client), that input is
// simply left undefined and the caller falls back to its prior behavior.
type AttributionInputsDb = {
  taxonomyNode?: {
    findMany?: (args: {
      select: { nodeId: true; name: true; description: true; enrichment: true };
    }) => Promise<Array<{ nodeId: string; name: string; description: string | null; enrichment: unknown }>>;
  };
  discoveryFingerprintRule?: {
    findMany?: (args: {
      where: { status: "active" };
      select: {
        id: true;
        ruleKey: true;
        status: true;
        matchExpression: true;
        requiredEvidenceFamilies: true;
        identityConfidence: true;
        taxonomyConfidence: true;
        resolvedIdentity: true;
        catalogIdentityId: true;
        taxonomyNode: { select: { nodeId: true } };
      };
    }) => Promise<Array<{
      id: string;
      ruleKey: string;
      status: string;
      matchExpression: unknown;
      requiredEvidenceFamilies: string[];
      identityConfidence: number;
      taxonomyConfidence: number;
      resolvedIdentity: unknown;
      catalogIdentityId: string | null;
      taxonomyNode: { nodeId: string } | null;
    }>>;
  };
};

/**
 * Load the taxonomy candidates + active fingerprint rules for attribution.
 *
 * Both are optional in the return: if the passed client cannot answer a query
 * (member absent), that field is left `undefined`, exactly matching the
 * pre-existing `?? undefined` guards in the runner. A caller can override
 * either input via `overrides` (used by the runner's test-injection seam and to
 * avoid a redundant query when a caller already has the data).
 */
export async function loadDiscoveryAttributionInputs(
  db: unknown,
  overrides: DiscoveryAttributionInputs = {},
): Promise<DiscoveryAttributionInputs> {
  const client = db as AttributionInputsDb;

  const taxonomyNodes =
    overrides.taxonomyNodes ??
    (typeof client.taxonomyNode?.findMany === "function"
      ? (
          await client.taxonomyNode.findMany({
            select: { nodeId: true, name: true, description: true, enrichment: true },
          })
        ).map((n) => ({
          nodeId: n.nodeId,
          name: n.name,
          description: n.description,
          enrichmentText: flattenEnrichmentForScoring(n.enrichment as Record<string, unknown> | null),
        }))
      : undefined);

  // Active discovery-fingerprint rules (spec §4 layer 0). Loaded joined to the
  // taxonomy node's semantic nodeId, because the normalizer attaches taxonomy by
  // `connect: { nodeId }`. A confident match identifies + places the device
  // deterministically, ahead of the heuristic taxonomy scoring.
  const fingerprintRules =
    overrides.fingerprintRules ??
    (typeof client.discoveryFingerprintRule?.findMany === "function"
      ? (
          await client.discoveryFingerprintRule.findMany({
            where: { status: "active" },
            select: {
              id: true,
              ruleKey: true,
              status: true,
              matchExpression: true,
              requiredEvidenceFamilies: true,
              identityConfidence: true,
              taxonomyConfidence: true,
              resolvedIdentity: true,
              catalogIdentityId: true,
              taxonomyNode: { select: { nodeId: true } },
            },
          })
        ).map((rule): AdapterRule => ({
          id: rule.id,
          ruleKey: rule.ruleKey,
          status: rule.status as AdapterRuleStatus,
          matchExpression: rule.matchExpression as FingerprintMatchExpression,
          requiredEvidenceFamilies: rule.requiredEvidenceFamilies,
          taxonomyNodeId: rule.taxonomyNode?.nodeId ?? null,
          identityConfidence: rule.identityConfidence,
          taxonomyConfidence: rule.taxonomyConfidence,
          resolvedIdentity: (rule.resolvedIdentity ?? {}) as ResolvedIdentity,
          catalogIdentityId: rule.catalogIdentityId ?? null,
        }))
      : undefined);

  return {
    ...(taxonomyNodes ? { taxonomyNodes } : {}),
    ...(fingerprintRules ? { fingerprintRules } : {}),
  };
}
