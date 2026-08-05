// Display vocabulary for the unified `graph_node` / `graph_edge` mirror (BI-89A149A9).
//
// The mirror is a single table holding several corpora at once — the code graph,
// the Prisma data model, the EA/ArchiMate ontology, infrastructure CIs, and the
// portfolio spine. The raw `labels` values are storage identifiers
// ("ArchiMate__DataObject", "PrismaField"); this module is the one place that
// turns them into operator-facing names, groups them into domains, and assigns a
// colour.
//
// The raw colour values live in `explorer-chart-colors.ts` — canvas category
// colours cannot be `var(--dpf-*)` because `ctx.fillStyle` does not resolve CSS
// custom properties, so they get the guard-approved chart-colour home.

import {
  ARCHIMATE_DEFAULT_COLOR,
  NODE_CATEGORY_COLORS,
  REL_TYPE_COLORS,
  UNKNOWN_CATEGORY_COLOR,
  WIKI_DEFAULT_COLOR,
} from "./explorer-chart-colors";

export type GraphDomainKey =
  | "code"
  | "data"
  | "knowledge"
  | "architecture"
  | "infrastructure"
  | "portfolio";

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
    key: "knowledge",
    label: "Knowledge",
    description:
      "Wiki pages and the links between them: decision rules, organizational stances, profession corpora, and the founder kernel.",
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
  { key: "CodeRoute", label: "Route", domain: "code", color: NODE_CATEGORY_COLORS.CodeRoute, size: 6 },
  { key: "CodeTool", label: "MCP tool", domain: "code", color: NODE_CATEGORY_COLORS.CodeTool, size: 6 },
  { key: "TestFile", label: "Test file", domain: "code", color: NODE_CATEGORY_COLORS.TestFile, size: 4 },
  { key: "CodeFile", label: "Source file", domain: "code", color: NODE_CATEGORY_COLORS.CodeFile, size: 5 },
  { key: "CodeSymbol", label: "Symbol", domain: "code", color: NODE_CATEGORY_COLORS.CodeSymbol, size: 3 },
  {
    key: "ExternalModule",
    label: "External module",
    domain: "code",
    color: NODE_CATEGORY_COLORS.ExternalModule,
    size: 3,
  },

  // ── Data model ──────────────────────────────────────────────────────────────
  { key: "PrismaModel", label: "Data model", domain: "data", color: NODE_CATEGORY_COLORS.PrismaModel, size: 6 },
  { key: "PrismaField", label: "Field", domain: "data", color: NODE_CATEGORY_COLORS.PrismaField, size: 3 },

  // ── Architecture ────────────────────────────────────────────────────────────
  {
    key: "EaElement",
    label: "EA element",
    domain: "architecture",
    color: NODE_CATEGORY_COLORS.EaElement,
    size: 5,
  },

  // ── Infrastructure ──────────────────────────────────────────────────────────
  {
    key: "InfraCI",
    label: "Infrastructure CI",
    domain: "infrastructure",
    color: NODE_CATEGORY_COLORS.InfraCI,
    size: 5,
  },

  // ── Knowledge ───────────────────────────────────────────────────────────────
  //
  // One label per node, not a generic `WikiPage` marker plus a specific kind. The
  // census sums per-label counts, so a node carrying two labels is counted twice —
  // which is exactly why `EaElement` needs a hard-coded skip there. A single
  // specific label keeps the knowledge domain out of that trap (BI-3045CC18).
  {
    key: "Wiki__Principle",
    label: "Principle",
    domain: "knowledge",
    color: NODE_CATEGORY_COLORS.Wiki__Principle,
    size: 6,
  },
  { key: "Wiki__Stance", label: "Stance", domain: "knowledge", color: NODE_CATEGORY_COLORS.Wiki__Stance, size: 6 },
  {
    key: "Wiki__Heuristic",
    label: "Heuristic",
    domain: "knowledge",
    color: NODE_CATEGORY_COLORS.Wiki__Heuristic,
    size: 5,
  },
  {
    key: "Wiki__Decision",
    label: "Decision rule",
    domain: "knowledge",
    color: NODE_CATEGORY_COLORS.Wiki__Decision,
    size: 6,
  },
  { key: "Wiki__Entity", label: "Entity page", domain: "knowledge", color: NODE_CATEGORY_COLORS.Wiki__Entity, size: 5 },
  { key: "Wiki__Summary", label: "Summary", domain: "knowledge", color: NODE_CATEGORY_COLORS.Wiki__Summary, size: 4 },
  { key: "Wiki__Runbook", label: "Runbook", domain: "knowledge", color: NODE_CATEGORY_COLORS.Wiki__Runbook, size: 5 },
  { key: "Wiki__Index", label: "Index page", domain: "knowledge", color: NODE_CATEGORY_COLORS.Wiki__Index, size: 7 },

  // ── Portfolio ───────────────────────────────────────────────────────────────
  { key: "Portfolio", label: "Portfolio", domain: "portfolio", color: NODE_CATEGORY_COLORS.Portfolio, size: 8 },
  {
    key: "DigitalProduct",
    label: "Digital product",
    domain: "portfolio",
    color: NODE_CATEGORY_COLORS.DigitalProduct,
    size: 5,
  },
  {
    key: "TaxonomyNode",
    label: "Taxonomy node",
    domain: "portfolio",
    color: NODE_CATEGORY_COLORS.TaxonomyNode,
    size: 6,
  },
];

const DESCRIPTOR_BY_KEY = new Map(LABEL_DESCRIPTORS.map((d) => [d.key, d]));

/** The `ArchiMate__<Type>` family is open-ended — one rule covers every member. */
const ARCHIMATE_PREFIX = "ArchiMate__";

/** `Wiki__<PageKind>`. `WikiPage.pageKind` is a plain string in the schema, so a
 *  kind added later must still land in the knowledge domain rather than in the
 *  architecture-flavoured unknown bucket (BI-3045CC18). */
const WIKI_PREFIX = "Wiki__";

const UNKNOWN_DESCRIPTOR: Omit<LabelDescriptor, "key" | "label"> = {
  domain: "architecture",
  color: UNKNOWN_CATEGORY_COLOR,
  size: 4,
};

/** Split a PascalCase / prefixed storage label into readable words. */
export function humanizeLabel(raw: string): string {
  const stripped = raw.startsWith(ARCHIMATE_PREFIX)
    ? raw.slice(ARCHIMATE_PREFIX.length)
    : raw.startsWith(WIKI_PREFIX)
      ? raw.slice(WIKI_PREFIX.length)
      : raw;
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
      color: ARCHIMATE_DEFAULT_COLOR,
      size: 4,
    };
  }

  if (raw.startsWith(WIKI_PREFIX)) {
    return {
      key: raw,
      label: humanizeLabel(raw),
      domain: "knowledge",
      color: WIKI_DEFAULT_COLOR,
      size: 5,
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

export type RelTypeDescriptor = {
  key: string;
  label: string;
  color: string;
};

export function describeRelType(raw: string): RelTypeDescriptor {
  return {
    key: raw,
    label: REL_TYPE_LABELS[raw] ?? humanizeLabel(raw.toLowerCase().replace(/_/g, " ")),
    color: REL_TYPE_COLORS[raw] ?? UNKNOWN_CATEGORY_COLOR,
  };
}
