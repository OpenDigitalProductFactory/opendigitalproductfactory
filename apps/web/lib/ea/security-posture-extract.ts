// apps/web/lib/ea/security-posture-extract.ts
//
// Pure extractor for the Security Operations (SOC) SysML projection (Parity
// Engine, living-graph — EP-ARCH-GRAPH-LIVE / EP-SOVEREIGN-SOC). Projects the
// security domain — the OCSF normalization spine, the detection engine + kernel
// rule pack, the case worklist, governed response, and the AI-SOC roster — into
// the one architecture graph so the SOC is a first-class, navigable surface and
// cannot drift from the implementation (the gap the arch-review flagged,
// BI-79B599BF).
//
// SysML mapping (cross-LAYER edges to the data model are applied by
// applySysmlModel.crossLayerRelationships):
//   - package        security:pkg                 "Security Operations (SOC)"
//   - plane          security:plane:<plane>        part_definition (normalization, detection, cases, response, roster)
//   - detection rule security:rule:<ruleKey>       part_usage (one KERNEL_DETECTION_PACK rule)
//   - coworker       security:coworker:<agentId>   part_usage (one AGT-SOC-* role)
// Each plane `traces` to its Prisma data-model node(s) (prisma:model:SecurityEvent,
// :Detection, :DetectionRule, :ThreatIndicator, :SecurityCase) so a data-model
// change's blast_radius reaches the SOC surface.

import { KERNEL_DETECTION_PACK } from "@/lib/security/detection-pack";

import type { SysmlDesiredModel } from "./sysml-model-seed";

export const SECURITY_PACKAGE_KEY = "security:pkg";

interface SocCoworker {
  agentId: string;
  name: string;
  tier: string;
}

/** The canonical AI-SOC roster (mirrors the AGT-SOC-* registry entries). */
export const SOC_ROSTER: readonly SocCoworker[] = [
  { agentId: "AGT-SOC-TRIAGE", name: "SOC Tier-1 Triage Analyst", tier: "tier-1" },
  { agentId: "AGT-SOC-INVESTIGATOR", name: "SOC Tier-2 Investigator", tier: "tier-2" },
  { agentId: "AGT-SOC-HUNTER", name: "SOC Threat Hunter", tier: "tier-3" },
  { agentId: "AGT-SOC-IR-LEAD", name: "SOC Incident Commander", tier: "incident-commander" },
];

interface SecurityPlane {
  key: string;
  name: string;
  description: string;
  /** Prisma model names this plane traces to (cross-layer). */
  dataModels: string[];
}

export const SECURITY_PLANES: readonly SecurityPlane[] = [
  {
    key: "security:plane:normalization",
    name: "Normalization (OCSF)",
    description: "OCSF-normalized security telemetry from edge collectors and internal audit sources.",
    dataModels: ["SecurityEvent"],
  },
  {
    key: "security:plane:detection",
    name: "Detection",
    description: "Rules, correlation, and threat intel that turn security events into detections.",
    dataModels: ["Detection", "DetectionRule", "ThreatIndicator"],
  },
  {
    key: "security:plane:cases",
    name: "Cases",
    description: "The AI-SOC analyst worklist: detections grouped into investigated cases.",
    dataModels: ["SecurityCase"],
  },
  {
    key: "security:plane:response",
    name: "Governed response",
    description: "Band + kernel gated, propose-only containment and remediation.",
    dataModels: [],
  },
  {
    key: "security:plane:roster",
    name: "AI SOC roster",
    description: "The governed coworkers that operate the SOC: triage, investigation, hunting, incident command.",
    dataModels: [],
  },
];

function dataModelKey(model: string): string {
  return `prisma:model:${model}`;
}

export function buildSecurityPostureModel(): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];
  const crossLayerRelationships: SysmlDesiredModel["relationships"] = [];

  elements.push({
    sysmlKey: SECURITY_PACKAGE_KEY,
    typeSlug: "package",
    name: "Security Operations (SOC)",
    description:
      "Live SysML projection of the AI-operated SOC: OCSF normalization, the detection engine and kernel rule pack, the case worklist, governed response, and the AI-SOC coworker roster — derived from the implementation so the security surface cannot drift.",
    properties: { sourceKey: "security-posture", planeCount: SECURITY_PLANES.length },
  });

  for (const plane of SECURITY_PLANES) {
    elements.push({
      sysmlKey: plane.key,
      typeSlug: "part_definition",
      name: plane.name,
      description: plane.description,
      properties: { sourceKey: plane.key, layer: "operational" },
    });
    relationships.push({ fromKey: SECURITY_PACKAGE_KEY, toKey: plane.key, relSlug: "contains" });
    for (const model of plane.dataModels) {
      crossLayerRelationships.push({ fromKey: plane.key, toKey: dataModelKey(model), relSlug: "traces" });
    }
  }

  for (const rule of [...KERNEL_DETECTION_PACK].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey))) {
    const ruleKey = `security:rule:${rule.ruleKey}`;
    elements.push({
      sysmlKey: ruleKey,
      typeSlug: "part_usage",
      name: rule.name,
      description: rule.description,
      properties: {
        sourceKey: ruleKey,
        layer: "operational",
        refinementLevel: "actual",
        severity: rule.severity,
        mitreTechniques: rule.mitreTechniques.join(","),
      },
    });
    relationships.push({ fromKey: "security:plane:detection", toKey: ruleKey, relSlug: "contains" });
  }

  for (const cw of SOC_ROSTER) {
    const cwKey = `security:coworker:${cw.agentId}`;
    elements.push({
      sysmlKey: cwKey,
      typeSlug: "part_usage",
      name: cw.name,
      description: `AI SOC coworker (${cw.tier}).`,
      properties: { sourceKey: cwKey, layer: "operational", agentId: cw.agentId, tier: cw.tier },
    });
    relationships.push({ fromKey: "security:plane:roster", toKey: cwKey, relSlug: "contains" });
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition", "part_usage"],
    relTypeSlugs: ["contains", "traces"],
    view: {
      name: "Security Operations — Live Projection",
      description:
        "Live, system-maintained projection of the AI-operated SOC: its planes, the kernel detection rules, and the coworker roster, each tracing to its data model.",
      viewpointName: "System Decomposition & Interfaces",
      scopeRef: "security",
    },
    softRemovePrefix: "security:",
    crossLayerRelationships,
  };
}
