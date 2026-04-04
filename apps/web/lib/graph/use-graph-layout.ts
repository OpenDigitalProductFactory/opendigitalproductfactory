import { useState, useEffect } from "react";
import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult, ViewConfig } from "./types";
import { computeHierarchicalLayout } from "./layout-hierarchical";
import { computeRadialLayout } from "./layout-radial";
import { computeSwimLaneLayout } from "./layout-swimlane";

/**
 * Computes positioned node coordinates for the given view.
 * Returns null for "force" layout (signals the component to use its own simulation).
 */
export function useGraphLayout(
  data: GraphData,
  view: ViewConfig,
  focusNodeId: string | null,
  dimensions: { width: number; height: number },
): LayoutResult | null {
  const [result, setResult] = useState<LayoutResult | null>(null);

  useEffect(() => {
    // Filter data by view config
    const filteredNodes = data.nodes.filter((n) => view.nodeTypesShown.has(n.label));
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = data.links.filter(
      (l) =>
        view.edgesShown.has(l.type) &&
        filteredNodeIds.has(l.source) &&
        filteredNodeIds.has(l.target),
    );
    const filtered: GraphData = { nodes: filteredNodes, links: filteredLinks };

    if (filtered.nodes.length === 0) {
      setResult({ nodes: [], links: [] });
      return;
    }

    switch (view.layout) {
      case "hierarchical": {
        const roots = detectRoots(filtered, view);
        setResult(
          computeHierarchicalLayout(filtered, {
            direction: view.direction,
            rootIds: roots,
          }),
        );
        break;
      }
      case "radial": {
        const rootId = focusNodeId ?? filtered.nodes[0]?.id ?? "";
        setResult(
          computeRadialLayout(filtered, {
            rootId,
            centerX: dimensions.width / 2,
            centerY: dimensions.height / 2,
          }),
        );
        break;
      }
      case "swimlane": {
        if (view.name === "subnet-topology") {
          // Build subnet membership map from MEMBER_OF edges
          const subnetMap = new Map<string, string>();
          const subnetNodes = new Set(
            filtered.nodes
              .filter((n) => {
                const ct = (n as Record<string, unknown>).ciType;
                return ct === "subnet" || ct === "vlan";
              })
              .map((n) => n.id),
          );
          for (const link of filtered.links) {
            if (link.type === "MEMBER_OF" && subnetNodes.has(link.target)) {
              subnetMap.set(link.source, link.target);
            }
          }
          // Subnet nodes belong to their own partition
          for (const id of subnetNodes) subnetMap.set(id, id);
          // Find subnet name for partition labels
          const subnetNames = new Map<string, string>();
          for (const n of filtered.nodes) {
            if (subnetNodes.has(n.id)) subnetNames.set(n.id, n.name);
          }
          computeSwimLaneLayout(
            filtered,
            (id) => subnetMap.get(id) ?? null,
            { partitionLabels: subnetNames },
          ).then(setResult);
        } else {
          // Default OSI layer partitioning
          const osiMap = new Map(
            filtered.nodes.map((n) => [
              n.id,
              (n as Record<string, unknown>).osiLayer as number | null ?? null,
            ]),
          );
          computeSwimLaneLayout(filtered, (id) => osiMap.get(id) ?? null).then(
            setResult,
          );
        }
        break;
      }
      case "force":
      default:
        // Return null to signal the existing force simulation should be used
        setResult(null);
        break;
    }
  }, [data, view, focusNodeId, dimensions]);

  return result;
}

function detectRoots(data: GraphData, view: ViewConfig): string[] {
  switch (view.rootDetection) {
    case "gateway":
      return data.nodes
        .filter(
          (n) =>
            n.name.toLowerCase().includes("gateway") ||
            n.name.toLowerCase().startsWith("gw ") ||
            (n as Record<string, unknown>).ciType === "gateway",
        )
        .map((n) => n.id);
    case "docker_host":
      return data.nodes
        .filter(
          (n) =>
            (n as Record<string, unknown>).ciType === "docker_host" ||
            (n.name.toLowerCase().includes("docker") &&
              n.name.toLowerCase().includes("host")),
        )
        .map((n) => n.id);
    default:
      return [];
  }
}
