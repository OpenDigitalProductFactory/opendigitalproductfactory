// Display vocabulary for the unified `graph_node` / `graph_edge` mirror (BI-89A149A9).
//
// The mirror is a single table holding several corpora at once — the code graph,
// the Prisma data model, the EA/ArchiMate ontology, infrastructure CIs, and the
// portfolio spine. The raw `labels` values are storage identifiers
// ("ArchiMate__DataObject", "PrismaField"); this module is the one place that
// turns them into operator-facing names, groups them into domains, and assigns a
// colour.
//
// Colours are concrete hex, not `var(--dpf-*)`: they are painted onto a `<canvas>`
// via `ctx.fillStyle`/`strokeStyle`, which cannot resolve CSS custom properties.
// They are category/series colours (the report-kit `statusColors` registry covers
// status→intent, which is a different axis and does not apply here).

export type GraphDomainKey = "code" | "data" | "architecture" | "infrastructure" | "portfolio";

export type GraphDomain = {
  key: GraphDomainKey;
  label: string;
  description: string;
};

export const GRAPH_DOMAINS: GraphDomain[] = [
  {
    key: "code",
    label: "Code",
    description: "Source files, exported symbols, routes, MCP tools, tests, and external modules.",
  },
  {
    key: "data",
    label: "Data model",
    description: "Prisma models and their fields.",
  },
  {
    key: "architecture",
    label: "Architecture",
    description: "EA / ArchiMate ontology elements.",
  },
  {
    key: "infrastructure",
    label: "Infrastructure",
    description: "Discovered configuration items and network topology.",
  },
  {
    key: "portfolio",
    label: "Portfolio",
    description: "Portfolios, digital products, and taxonomy nodes.",
  },
];

export type LabelDescriptor = {
  /** Raw value as stored in `graph_node.labels`. */
  key: string;
  /** Operator-facing name. */
  label: string;
  domain: GraphDomainKey;
  color: string;
  /** Canvas radius. Bigger = structurally coarser. */
  size: number;
};

/**
 * Ordered most-specific-first. A node carries an array of labels (an EA element is
 * both `EaElement` and `ArchiMate__DataObject`); the first entry of this list that
 * the node carries becomes its primary descriptor, so the specific ArchiMate type
 * wins over the generic `EaElement` marker.
 */
const LABEL_DESCRIPTORS: LabelDescriptor[] = [
  // ── Code ────────────────────────────────────────────────────────────────────
  { key: "CodeRoute", label: "Route", domain: "code", color: "#a78bfa", size: 6 },
  { key: "CodeTool", label: "MCP tool", domain: "code", color: "#f472b6", size: 6 },
  { key: "TestFile", label: "Test file", domain: "code", color: "#34d399", size: 4 },
  { key: "CodeFile", label: "Source file", domain: "code", color: "#38bdf8", size: 5 },
  { key: "CodeSymbol", label: "Symbol", domain: "code", color: "#7dd3fc", size: 3 },
  { key: "ExternalModule", label: "External module", domain: "code", color: "#94a3b8", size: 3 },

  // ── Data model ──────────────────────────────────────────────────────────────
  { key: "PrismaModel", label: "Data model", domain: "data", color: "#fbbf24", size: 6 },
  { key: "PrismaField", label: "Field", domain: "data", color: "#fcd34d", size: 3 },

  // ── Architecture ────────────────────────────────────────────────────────────
  { key: "EaElement", label: "EA element", domain: "architecture", color: "#4ade80", size: 5 },

  // ── Infrastructure ──────────────────────────────────────────────────────────
  { key: "InfraCI", label: "Infrastructure CI", domain: "infrastructure", color: "#22d3ee", size: 5 },

  // ── Portfolio ───────────────────────────────────────────────────────────────
  { key: "Portfolio", label: "Portfolio", domain: "portfolio", color: "#818cf8", size: 8 },
  { key: "DigitalProduct", label: "Digital product", domain: "portfolio", color: "#4ade80", size: 5 },
  { key: "TaxonomyNode", label: "Taxonomy node", domain: "portfolio", color: "#fb923c", size: 6 },
];

const DESCRIPTOR_BY_KEY = new Map(LABEL_DESCRIPTORS.map((d) => [d.key, d]));

/** The `ArchiMate__<Type>` family is open-ended — one rule covers every member. */
const ARCHIMATE_PREFIX = "ArchiMate__";

const UNKNOWN_DESCRIPTOR: Omit<LabelDescriptor, "key" | "label"> = {
  domain: "architecture",
  color: "#8888a0",
  size: 4,
};

/** Split a PascalCase / prefixed storage label into readable words. */
export function humanizeLabel(raw: string): string {
  const stripped = raw.startsWith(ARCHIMATE_PREFIX) ? raw.slice(ARCHIMATE_PREFIX.length) : raw;
  return stripped
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_+/g, " ")
    .trim();
}

/** Descriptor for a single raw label value. Never throws — unknown labels degrade. */
export function describeLabel(raw: string): LabelDescriptor {
  const known = DESCRIPTOR_BY_KEY.get(raw);
  if (known) return known;

  if (raw.startsWith(ARCHIMATE_PREFIX)) {
    return {
      key: raw,
      label: humanizeLabel(raw),
      domain: "architecture",
      color: "#86efac",
      size: 4,
    };
  }

  return { key: raw, label: humanizeLabel(raw), ...UNKNOWN_DESCRIPTOR };
}

/**
 * The descriptor a node is drawn with, given its full `labels` array.
 * Specific labels win over generic markers; an empty array degrades to "Node".
 */
export function describeNodeLabels(labels: readonly string[]): LabelDescriptor {
  for (const descriptor of LABEL_DESCRIPTORS) {
    if (labels.includes(descriptor.key)) {
      // `EaElement` is a generic marker — prefer a concrete ArchiMate type when present.
      if (descriptor.key === "EaElement") {
        const archimate = labels.find((l) => l.startsWith(ARCHIMATE_PREFIX));
        if (archimate) return describeLabel(archimate);
      }
      return descriptor;
    }
  }

  const archimate = labels.find((l) => l.startsWith(ARCHIMATE_PREFIX));
  if (archimate) return describeLabel(archimate);

  const first = labels[0];
  return first ? describeLabel(first) : { key: "Node", label: "Node", ...UNKNOWN_DESCRIPTOR };
}

// ── Relationships ─────────────────────────────────────────────────────────────

const REL_TYPE_LABELS: Record<string, string> = {
  IMPORTS: "Imports",
  DEFINES: "Defines",
  HAS_FIELD: "Has field",
  TESTED_BY: "Tested by",
  ASSOCIATED_WITH: "Associated with",
  RELATES_TO: "Relates to",
  IMPLEMENTS_ROUTE: "Implements route",
  EXPOSES_TOOL: "Exposes tool",
  BELONGS_TO: "Belongs to",
  CLASSIFIED_AS: "Classified as",
  PARENT_OF: "Parent of",
  DEPENDS_ON: "Depends on",
  MEMBER_OF: "Member of",
  MONITORS: "Monitors",
  HOSTS: "Hosts",
  RUNS_ON: "Runs on",
  ROUTES_THROUGH: "Routes through",
  LISTENS_ON: "Listens on",
  CARRIED_BY: "Carried by",
  CONNECTS_TO: "Connects to",
  PEER_OF: "Peer of",
};

const REL_TYPE_COLORS: Record<string, string> = {
  IMPORTS: "#38bdf8",
  DEFINES: "#7dd3fc",
  HAS_FIELD: "#fcd34d",
  TESTED_BY: "#34d399",
  ASSOCIATED_WITH: "#86efac",
  RELATES_TO: "#4ade80",
  IMPLEMENTS_ROUTE: "#a78bfa",
  EXPOSES_TOOL: "#f472b6",
  BELONGS_TO: "#818cf8",
  DEPENDS_ON: "#22d3ee",
  MEMBER_OF: "#a78bfa",
  MONITORS: "#fbbf24",
  HOSTS: "#22d3ee",
  RUNS_ON: "#34d399",
  ROUTES_THROUGH: "#f472b6",
};

const REL_TYPE_FALLBACK_COLOR = "#8888a0";

export type RelTypeDescriptor = {
  key: string;
  label: string;
  color: string;
};

export function describeRelType(raw: string): RelTypeDescriptor {
  return {
    key: raw,
    label: REL_TYPE_LABELS[raw] ?? humanizeLabel(raw.toLowerCase().replace(/_/g, " ")),
    color: REL_TYPE_COLORS[raw] ?? REL_TYPE_FALLBACK_COLOR,
  };
}
