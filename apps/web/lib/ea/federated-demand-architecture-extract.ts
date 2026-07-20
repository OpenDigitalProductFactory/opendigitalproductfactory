import type { SysmlDesiredModel } from "./sysml-model-seed";

export const FEDERATED_DEMAND_PACKAGE_KEY = "fdn:pkg";

const REQUIREMENTS = [
  ["01", "One Canonical Local Backlog Writer"],
  ["02", "Dual Approval Before Exchange"],
  ["03", "Automatic Eligible Demand Reconciliation"],
  ["04", "Relationship Patterns Without Transport Forks"],
  ["05", "Allow-listed Negative-tested Projections"],
  ["06", "Local Operation Through External Outages"],
  ["07", "Origin And Route Provenance"],
  ["08", "Bilateral Revocation"],
  ["09", "Low-expertise Operator Setup"],
  ["10", "Production Environment Boundary"],
  ["11", "Independent Business Demand And Hive Authority"],
] as const;

const PARTS = [
  ["local-backlog", "Local Backlog Authority", "BacklogItem", "Each installation owns its work, priority, status, estimate, and build state."],
  ["pairing-session", "Federation Pairing Session", "FederationPairingSession", "Owns expiring device-binding state and one-time bootstrap delivery; never creates relationship trust."],
  ["federated-mirror", "Federated Demand Mirror", "FederatedRecordMirror", "Stores minimized peer observations and durable protocol outbox state; never owns local work."],
  ["founder-cluster", "Founder Shared Portfolio", "FounderDemandCluster", "Founder Hub owns cluster membership, reach, disposition, and canonical local-item mapping."],
  ["founder-origin", "Founder Deduplicated Origin", "FounderDemandClusterMember", "Counts one immutable installation/envelope origin once while retaining every route attestation."],
  ["hive-ledger", "Hive Result Ledger", "HiveContributionLedger", "Persists result-only contributions independently of forge delivery."],
  ["forge", "Forge Delivery Adapter", null, "Maps an accepted result to the configured forge; GitHub is delivery state, not backlog or federation authority."],
] as const;

const PORTS = [
  ["discovery", "Discovery Port"], ["pairing", "Pairing Port"], ["inbox", "Federation Inbox"],
  ["outbox", "Federation Outbox"], ["delivery-flow", "Delivery Flow Adapter"],
  ["founder-portfolio", "Founder Portfolio Adapter"], ["hive", "Hive Contribution Adapter"],
  ["forge", "Forge Adapter"],
] as const;

const VERIFICATIONS = [
  ["01", "Same-LAN Discovery"], ["02", "Discovery Spoof"], ["03", "Pairing"],
  ["04", "Automatic Internal Sync"], ["05", "Offline Recovery"], ["06", "Customer Minimization"],
  ["07", "Reseller Forwarding"], ["08", "Duplicate Route"], ["09", "Multi-partner"],
  ["10", "Revocation"], ["11", "Founder Hub Outage"], ["12", "GitHub Separation"],
  ["13", "Route Loop"], ["14", "Environment Boundary"], ["15", "Contribution Isolation"],
] as const;

const VERIFIES: Record<string, string[]> = {
  "01": ["05", "09"], "02": ["02"], "03": ["02", "09"], "04": ["03"], "05": ["03", "06"],
  "06": ["05"], "07": ["04", "07"], "08": ["01", "07"], "09": ["04"], "10": ["08"],
  "11": ["06"], "12": ["01", "06"], "13": ["04", "07"], "14": ["10"], "15": ["11"],
};

export function buildFederatedDemandArchitectureModel(): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [{
    sysmlKey: FEDERATED_DEMAND_PACKAGE_KEY,
    typeSlug: "package",
    name: "DPF Federated Demand Network",
    description: "System context for sovereign backlog collaboration, reseller channels, Founder Hub portfolio curation, and result-only Hive delivery.",
    properties: { sourceKey: "docs/superpowers/specs/2026-07-19-federated-demand-network-design.md#14-architecture-note-sysml-ea" },
  }];
  const relationships: SysmlDesiredModel["relationships"] = [];
  for (const [id, name] of REQUIREMENTS) {
    const key = `fdn:req:${id}`;
    elements.push({ sysmlKey: key, typeSlug: "requirement", name: `R-FDN-${id} ${name}`, description: name, properties: { stableId: `R-FDN-${id}` } });
    relationships.push({ fromKey: FEDERATED_DEMAND_PACKAGE_KEY, toKey: key, relSlug: "contains" });
  }
  for (const [id, name, prismaModel, description] of PARTS) {
    const key = `fdn:part:${id}`;
    elements.push({
      sysmlKey: key, typeSlug: "part_definition", name, description,
      properties: { authorityOwner: name, prismaModel, sourceKey: prismaModel ? `packages/db/prisma/schema.prisma#${prismaModel}` : "apps/web/lib/forge/types.ts" },
    });
    relationships.push({ fromKey: FEDERATED_DEMAND_PACKAGE_KEY, toKey: key, relSlug: "contains" });
  }
  for (const [id, name] of PORTS) {
    const key = `fdn:port:${id}`;
    elements.push({ sysmlKey: key, typeSlug: "part_definition", name, description: `${name} boundary contract.`, properties: { elementKind: "port", stableId: `PORT-FDN-${id.toUpperCase()}` } });
    relationships.push({ fromKey: FEDERATED_DEMAND_PACKAGE_KEY, toKey: key, relSlug: "contains" });
  }
  relationships.push(
    { fromKey: "fdn:part:pairing-session", toKey: "fdn:port:pairing", relSlug: "connects" },
    { fromKey: "fdn:part:pairing-session", toKey: "fdn:req:02", relSlug: "satisfies" },
    { fromKey: "fdn:part:pairing-session", toKey: "fdn:req:09", relSlug: "satisfies" },
    { fromKey: "fdn:part:local-backlog", toKey: "fdn:port:delivery-flow", relSlug: "connects" },
    { fromKey: "fdn:port:delivery-flow", toKey: "fdn:part:federated-mirror", relSlug: "connects" },
    { fromKey: "fdn:part:federated-mirror", toKey: "fdn:port:founder-portfolio", relSlug: "connects" },
    { fromKey: "fdn:port:founder-portfolio", toKey: "fdn:part:founder-cluster", relSlug: "connects" },
    { fromKey: "fdn:part:founder-cluster", toKey: "fdn:part:founder-origin", relSlug: "contains" },
    { fromKey: "fdn:port:hive", toKey: "fdn:part:hive-ledger", relSlug: "connects" },
    { fromKey: "fdn:part:hive-ledger", toKey: "fdn:part:forge", relSlug: "connects" },
    { fromKey: "fdn:part:forge", toKey: "fdn:port:forge", relSlug: "connects" },
    { fromKey: "fdn:part:local-backlog", toKey: "fdn:req:01", relSlug: "satisfies" },
    { fromKey: "fdn:part:founder-origin", toKey: "fdn:req:07", relSlug: "satisfies" },
    { fromKey: "fdn:part:founder-origin", toKey: "fdn:req:10", relSlug: "satisfies" },
    { fromKey: "fdn:part:hive-ledger", toKey: "fdn:req:11", relSlug: "satisfies" },
  );
  for (const [id, name] of VERIFICATIONS) {
    const key = `fdn:vc:${id}`;
    elements.push({ sysmlKey: key, typeSlug: "verification_case", name: `V-${id} ${name}`, description: name, properties: { stableId: `V-${id}` } });
    relationships.push({ fromKey: FEDERATED_DEMAND_PACKAGE_KEY, toKey: key, relSlug: "contains" });
    for (const req of VERIFIES[id] ?? []) relationships.push({ fromKey: key, toKey: `fdn:req:${req}`, relSlug: "verifies" });
  }
  return {
    elements,
    relationships,
    crossLayerRelationships: [],
    elementTypeSlugs: ["package", "requirement", "part_definition", "verification_case"],
    relTypeSlugs: ["contains", "connects", "satisfies", "verifies"],
    view: {
      name: "Federated Demand Network - SysML Projection",
      description: "Authority boundaries from local backlog through Founder Hub and independent Hive/forge delivery.",
      viewpointName: "System Architecture",
      scopeRef: "federated-demand-network",
    },
    softRemovePrefix: "fdn:",
  };
}
