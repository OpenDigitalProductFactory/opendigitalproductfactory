// apps/web/lib/graph/scope-helpers.ts
// Pure, sync helpers for interpreting graph-data scope. Split out of
// `apps/web/lib/actions/graph.ts` because that file has a top-level
// `"use server"` directive — server-action files may only export
// async functions, so Turbopack's client-side compilation refuses to
// resolve these sync exports (build-time error in client-component
// import paths such as TopologyGraph.tsx).
//
// The GraphData type is re-exported from `@/lib/actions/graph` via
// `export type`, which IS allowed in "use server" files (types have
// no runtime footprint).

import type { GraphData } from "@/lib/actions/graph";

export function hasSubnetScopeNode(
  data: GraphData,
  subnetId: string | null,
): boolean {
  if (!subnetId || subnetId === "all") {
    return false;
  }

  return data.nodes.some((node) => {
    if (node.id !== subnetId) {
      return false;
    }
    const ciType = (node as { ciType?: string | null }).ciType;
    return ciType === "subnet" || ciType === "vlan";
  });
}

export function getSubnetScopeSignal(
  data: GraphData,
  subnetId: string | null,
): "valid" | "invalid-scope" | "unscoped" {
  if (!subnetId || subnetId === "all") {
    return "unscoped";
  }

  return hasSubnetScopeNode(data, subnetId) ? "valid" : "invalid-scope";
}
