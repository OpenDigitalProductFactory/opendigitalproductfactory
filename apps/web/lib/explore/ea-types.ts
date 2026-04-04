// Shared types used by both client components and server actions for EA canvas.

export type EaViewMode = "new" | "reference" | "propose";

export type CanvasState = {
  viewport: { x: number; y: number; zoom: number };
  nodes: Record<string, { x: number; y: number }>; // key = EaViewElement.id
};

export type ProjectionLayoutRole =
  | "stream_band"
  | "stream_stage"
  | "context_in"
  | "context_out"
  | "stage_support"
  | "shared_support";

// Serialised view element passed from server → EaCanvas
export type SerializedViewElement = {
  viewElementId: string;     // EaViewElement.id — used as React Flow node id
  elementId: string;
  mode: EaViewMode;
  parentViewElementId: string | null;
  orderIndex: number | null;
  rendererHint: string | null;
  layoutRole?: ProjectionLayoutRole | null;
  structureIssueCount: number;
  proposedProperties: Record<string, unknown> | null;
  elementType: {
    slug: string;
    name: string;
    neoLabel: string;  // used for ArchiMate layer colour
  };
  element: {
    name: string;
    description: string | null;
    lifecycleStage: string;
    lifecycleStatus: string;
    properties: Record<string, unknown> | null;
  };
  childViewElements?: SerializedViewElement[];
  isReadOnly?: boolean;
  onMoveStructuredChild?: (input: {
    childViewElementId: string;
    targetOrderIndex: number;
  }) => void | Promise<void>;
};

// Serialised relationship edge passed from server → EaCanvas
export type SerializedEdge = {
  id: string;                    // EaRelationship.id
  fromElementId: string;         // EaElement.id (source element)
  toElementId: string;           // EaElement.id (target element)
  fromViewElementId: string;     // EaViewElement.id — MUST be used as React Flow edge source
  toViewElementId: string;       // EaViewElement.id — MUST be used as React Flow edge target
  relationshipType: {
    slug: string;
    name: string;
    neoType: string;
  };
};

// ArchiMate layer colours (matches global CSS vars)
export const LAYER_COLOURS: Record<string, { bg: string; border: string }> = {
  business:    { bg: "#FFFFCC", border: "#c8b400" },
  application: { bg: "#CCE5FF", border: "#4a90d9" },
  technology:  { bg: "#CCFFCC", border: "#4a9460" },
  // BPMN 2.0 domain colours
  bpmn_process:     { bg: "#E8F0FE", border: "#4285f4" },  // Blue — activities
  bpmn_event:       { bg: "#FFF3E0", border: "#e88a1a" },  // Amber — events
  bpmn_gateway:     { bg: "#FCE4EC", border: "#d32f2f" },  // Rose — decision points
  bpmn_participant: { bg: "#F3E5F5", border: "#7b1fa2" },  // Purple — pools/lanes
  bpmn_data:        { bg: "#E0F2F1", border: "#00796b" },  // Teal — data objects
};

// Infer colour layer from neoLabel.
// ArchiMate labels: "ArchiMate__<Domain><Concept>"
// BPMN labels: "BPMN__<Concept>"
export function layerFromNeoLabel(neoLabel: string): keyof typeof LAYER_COLOURS {
  const part = neoLabel.replace(/^[^_]+__/, "").toLowerCase();
  // BPMN dispatch — use domain from element type slug prefix
  if (neoLabel.startsWith("BPMN__")) {
    if (part.includes("gateway")) return "bpmn_gateway";
    if (part.includes("event"))   return "bpmn_event";
    if (part.includes("pool") || part.includes("lane")) return "bpmn_participant";
    if (part.includes("data"))    return "bpmn_data";
    return "bpmn_process";
  }
  // ArchiMate dispatch
  if (part.startsWith("business") || part.startsWith("value")) return "business";
  if (part.startsWith("application") || part.startsWith("data") || part.startsWith("interface")) return "application";
  return "technology";
}
