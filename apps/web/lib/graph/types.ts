import type { GraphData } from "@/lib/actions/graph";

export type GraphViewName =
  | "network-topology"
  | "subnet-topology"
  | "hosting-stack"
  | "impact-blast-radius"
  | "dependency-audit"
  | "exploration";

export type LayoutAlgorithm = "force" | "hierarchical" | "radial" | "swimlane";

export type PositionedNode = GraphData["nodes"][0] & {
  x: number;
  y: number;
  osiLayer?: number | null;
  partition?: string | number;
};

export type LayoutResult = {
  nodes: PositionedNode[];
  links: GraphData["links"];
};

export type ViewConfig = {
  name: GraphViewName;
  label: string;
  layout: LayoutAlgorithm;
  direction?: "TB" | "LR";
  edgesShown: Set<string>;
  nodeTypesShown: Set<string>;
  rootDetection: "gateway" | "docker_host" | "focus" | "product" | "none";
  description: string;
};
