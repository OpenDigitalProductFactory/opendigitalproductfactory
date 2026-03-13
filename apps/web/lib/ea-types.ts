// Shared types used by both client components and server actions for EA canvas.

export type EaViewMode = "new" | "reference" | "propose";

export type CanvasState = {
  viewport: { x: number; y: number; zoom: number };
  nodes: Record<string, { x: number; y: number }>; // key = EaViewElement.id
};

// Serialised view element passed from server → EaCanvas
export type SerializedViewElement = {
  viewElementId: string;     // EaViewElement.id — used as React Flow node id
  elementId: string;
  mode: EaViewMode;
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
  };
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
};

// Infer layer from elementType.neoLabel prefix
export function layerFromNeoLabel(neoLabel: string): keyof typeof LAYER_COLOURS {
  const lower = neoLabel.toLowerCase();
  if (lower.startsWith("business")) return "business";
  if (lower.startsWith("app") || lower.startsWith("data") || lower.startsWith("interface")) return "application";
  return "technology";
}
