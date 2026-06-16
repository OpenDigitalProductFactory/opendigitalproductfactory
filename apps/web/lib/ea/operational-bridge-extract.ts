// apps/web/lib/ea/operational-bridge-extract.ts
//
// Pure extractor for the Operational Graph SysML projection (Parity Engine,
// living-graph Phase C — EP-ARCH-GRAPH-LIVE). Projects the LIVE runtime — the
// deployable services and their actual running instances — from the RuntimeTarget
// coordination registry into the SysML notation, so operational reality is
// represented in the one architecture graph at refinement=actual and cannot drift.
// This is where systems architecture meets operational reality.
//
// SysML mapping (intra-model; cross-LAYER edges to logical parts are a separate phase
// via applySysmlModel.crossLayerRelationships):
//   - package        operational:pkg                "Operational Graph"
//   - service def    operational:service:<svc>      part_definition (distinct serviceName/kind), package contains it
//   - actual run     operational:instance:<targetId> part_usage (one RuntimeTarget row), service contains it
// Stable `operational:*` source keys; pure — the reconcile shell supplies IO.
//
// Design: docs/superpowers/specs/2026-06-16-living-architecture-graph-and-operational-bridge-design.md §4-§6.

import type { SysmlDesiredModel } from "./sysml-model-seed";

/** One RuntimeTarget row, decoupled from the Prisma shape so the builder is pure. */
export interface RuntimeTargetFact {
  targetId: string;
  kind: string;
  status: string;
  serviceName: string | null;
  containerName: string | null;
  hostUrl: string | null;
  serviceVersion: string | null;
  port: number | null;
  lastHeartbeatAt: string | null; // ISO
}

export const OPERATIONAL_PACKAGE_KEY = "operational:pkg";

/** The logical deployable service a runtime target belongs to (serviceName, else kind). */
export function serviceOf(t: RuntimeTargetFact): string {
  return (t.serviceName && t.serviceName.trim()) || t.kind || "service";
}

export function buildOperationalGraphModel(targets: RuntimeTargetFact[]): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];

  elements.push({
    sysmlKey: OPERATIONAL_PACKAGE_KEY,
    typeSlug: "package",
    name: "Operational Graph",
    description:
      "Live SysML projection of the running platform — deployable services and their actual runtime instances — derived from the RuntimeTarget coordination registry so the operational layer is represented in the architecture graph (refinement=actual) and cannot drift.",
    properties: { sourceKey: "RuntimeTarget", instanceCount: targets.length },
  });

  // Group instances by their logical service.
  const byService = new Map<string, RuntimeTargetFact[]>();
  for (const t of targets) {
    const svc = serviceOf(t);
    const arr = byService.get(svc) ?? [];
    arr.push(t);
    byService.set(svc, arr);
  }

  for (const svc of [...byService.keys()].sort()) {
    const serviceKey = `operational:service:${svc}`;
    const instances = byService.get(svc)!;
    elements.push({
      sysmlKey: serviceKey,
      typeSlug: "part_definition",
      name: svc,
      description: `Deployable runtime service: ${svc}.`,
      properties: { sourceKey: `runtime:service:${svc}`, layer: "operational", instanceCount: instances.length },
    });
    relationships.push({ fromKey: OPERATIONAL_PACKAGE_KEY, toKey: serviceKey, relSlug: "contains" });

    for (const t of [...instances].sort((a, b) => a.targetId.localeCompare(b.targetId))) {
      const instanceKey = `operational:instance:${t.targetId}`;
      elements.push({
        sysmlKey: instanceKey,
        typeSlug: "part_usage",
        name: `${svc} · ${t.targetId}`,
        description: `Running instance ${t.targetId} (${t.status}).`,
        properties: {
          sourceKey: `RuntimeTarget#${t.targetId}`,
          layer: "operational",
          refinementLevel: "actual",
          targetId: t.targetId,
          kind: t.kind,
          status: t.status,
          serviceName: t.serviceName,
          containerName: t.containerName,
          hostUrl: t.hostUrl,
          serviceVersion: t.serviceVersion,
          port: t.port,
          lastHeartbeatAt: t.lastHeartbeatAt,
        },
      });
      relationships.push({ fromKey: serviceKey, toKey: instanceKey, relSlug: "contains" });
    }
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition", "part_usage"],
    relTypeSlugs: ["contains"],
    view: {
      name: "Operational Graph — Live Projection",
      description: "Live, system-maintained projection of running platform services and their instances.",
      viewpointName: "System Decomposition & Interfaces",
      scopeRef: "operational-graph",
    },
    softRemovePrefix: "operational:",
  };
}
