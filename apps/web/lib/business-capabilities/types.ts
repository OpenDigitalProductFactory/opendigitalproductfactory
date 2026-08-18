export const IT4IT_VALUE_STREAMS = [
  { slug: "evaluate", label: "Evaluate" },
  { slug: "explore", label: "Explore" },
  { slug: "integrate", label: "Integrate" },
  { slug: "deploy", label: "Deploy" },
  { slug: "release", label: "Release" },
  { slug: "consume", label: "Consume" },
  { slug: "operate", label: "Operate" },
] as const;

export const MATURITY_LEVELS = [
  { value: 1, label: "Initial" },
  { value: 2, label: "Managed" },
  { value: 3, label: "Defined" },
  { value: 4, label: "Measured" },
  { value: 5, label: "Optimized" },
] as const;

export const TRACE_TARGET_TYPES = [
  { value: "taxonomy_node", label: "Taxonomy" },
  { value: "digital_product", label: "Product" },
  { value: "backlog_item", label: "Backlog" },
  { value: "ea_element", label: "Architecture" },
] as const;

export const TRACE_RELATIONSHIPS = [
  { value: "classifies", label: "Classifies" },
  { value: "supported_by", label: "Supported By" },
  { value: "impacted_by", label: "Impacted By" },
  { value: "realized_by", label: "Realized By" },
] as const;

export const CAPABILITY_OVERLAY_MODES = [
  { value: "maturity", label: "Maturity Gap" },
  { value: "coverage", label: "Operational Coverage" },
  { value: "planning", label: "Planning Impact" },
  { value: "it4it", label: "IT4IT Alignment" },
  { value: "optimization", label: "Optimization Impact" },
] as const;

export type It4itValueStream = (typeof IT4IT_VALUE_STREAMS)[number]["slug"];
export type MaturityValue = (typeof MATURITY_LEVELS)[number]["value"];
export type TraceTargetType = (typeof TRACE_TARGET_TYPES)[number]["value"];
export type CapabilityMaturityBand = "aligned" | "watch" | "gap";
export type CapabilityOverlayMode = (typeof CAPABILITY_OVERLAY_MODES)[number]["value"];
export type CapabilityOverlayTone = CapabilityMaturityBand | "neutral" | "covered" | "active";
export type BacklogTraceStatus = "triaging" | "open" | "in-progress" | "done" | "deferred" | "retired" | null;

export const IT4IT_VALUE_STREAM_SET = new Set<string>(
  IT4IT_VALUE_STREAMS.map((stream) => stream.slug),
);

export const TRACE_TARGET_TYPE_SET = new Set<string>(
  TRACE_TARGET_TYPES.map((target) => target.value),
);

export const TRACE_RELATIONSHIP_SET = new Set<string>(
  TRACE_RELATIONSHIPS.map((relationship) => relationship.value),
);
