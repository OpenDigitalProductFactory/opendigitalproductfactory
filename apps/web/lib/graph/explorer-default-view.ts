// Curated default view for the admin graph explorer (BI-F9AA0872).
//
// The explorer is query-first by design and that design is correct — the corpus is
// ~25k nodes and drawing it whole is not viable. The consequence not reckoned with
// was that the page opened EMPTY: to see anything you had to already know a search
// term, so someone being shown the platform had no way in.
//
// WHY A CURATED SEED RATHER THAN A SAMPLE
//
// A random sample of this graph looks like unconnected dust, which demonstrates the
// opposite of what is wanted. Measured cross-domain edges on the live install:
//
//   infra -> portfolio   562
//   code  -> data        397
//   portfolio -> infra   291
//
// ...and nothing else. The graph is a set of weakly-connected islands, so a seed
// has to be chosen to land ON the bridges rather than hoping a sample finds them.
//
// WHAT THIS DELIBERATELY DOES NOT CLAIM
//
// The originally-wished-for slice was "a route -> its implementing file -> the
// model it touches". That path does not exist: `schema.prisma` has zero inbound
// edges and PrismaModel nodes are reachable only from it or from each other, so no
// route or application file reaches a data model. The code->data bridge below is
// the real one (the file that DEFINES the models), and it is described as such.
//
// SEEDS ARE RESOLVED, NOT HARDCODED
//
// A hardcoded node key is an install-specific fact and would silently produce an
// empty canvas on any other install. Each slice instead names a rule — "the file
// that defines the most data models" — resolved against whatever the install
// actually holds, with the key used only as a deterministic tie-break. A slice
// that resolves to nothing is dropped rather than rendering an empty frame.

import { prisma } from "@dpf/db";

import type { GraphSubgraph } from "./explorer-queries";

/** The arrival picture: a merged subgraph plus the slices that produced it.
 *  Declared here rather than in the server-action module, which may only export
 *  async functions (BI-11AC7524). */
export type GraphDefaultView = GraphSubgraph & {
  slices: DefaultViewSlice[];
};

/** One island of the default view. */
export type DefaultViewSlice = {
  key: string;
  /** Operator-facing name; short, because it is drawn on arrival. */
  label: string;
  /** The rule used to resolve the seed, for documentation and debugging. */
  rule: string;
  seedKey: string;
};

type SeedRow = { key: string };

/**
 * The file that defines the most data models — in practice `schema.prisma`. This is
 * the genuine code -> data bridge, and the only one: nothing imports the schema, so
 * the models hang off their definer and off each other.
 */
async function resolveDataModelDefiner(): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<SeedRow[]>(
    `SELECT e.src_key AS key
       FROM graph_edge e
       JOIN graph_node d ON d.key = e.dst_key
      WHERE e.rel_type = 'DEFINES' AND 'PrismaModel' = ANY(d.labels)
      GROUP BY e.src_key
      ORDER BY COUNT(*) DESC, e.src_key ASC
      LIMIT 1`,
  );
  return rows[0]?.key ?? null;
}

/**
 * The most-linked page in the knowledge corpus. The corpus is 127 isolated pages
 * and 232 connected ones averaging 3.57 links, so seeding on the largest hub is
 * what makes the slice look like a body of reasoning rather than scattered dots.
 */
async function resolveKnowledgeHub(): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<SeedRow[]>(
    `SELECT n.key
       FROM graph_node n
       JOIN graph_edge e ON (e.src_key = n.key OR e.dst_key = n.key) AND e.rel_type = 'LINKS_TO'
      WHERE EXISTS (SELECT 1 FROM unnest(n.labels) l WHERE l LIKE 'Wiki\\_\\_%')
      GROUP BY n.key
      ORDER BY COUNT(*) DESC, n.key ASC
      LIMIT 1`,
  );
  return rows[0]?.key ?? null;
}

/**
 * The busiest portfolio node. Portfolio sits on the infra <-> portfolio bridge, the
 * densest cross-domain link in the graph, so this slice reaches business and
 * infrastructure in one picture.
 */
async function resolvePortfolioHub(): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<SeedRow[]>(
    `SELECT n.key
       FROM graph_node n
       JOIN graph_edge e ON (e.src_key = n.key OR e.dst_key = n.key)
      WHERE 'Portfolio' = ANY(n.labels)
      GROUP BY n.key
      ORDER BY COUNT(*) DESC, n.key ASC
      LIMIT 1`,
  );
  return rows[0]?.key ?? null;
}

const SLICE_DEFINITIONS = [
  {
    key: "data-model",
    label: "Data model",
    rule: "The file that defines the most data models.",
    resolve: resolveDataModelDefiner,
  },
  {
    key: "knowledge",
    label: "Knowledge",
    rule: "The most-linked page in the knowledge corpus.",
    resolve: resolveKnowledgeHub,
  },
  {
    key: "portfolio",
    label: "Portfolio",
    rule: "The busiest portfolio node.",
    resolve: resolvePortfolioHub,
  },
] as const;

/**
 * Resolve every slice that this install can actually produce.
 *
 * Slices resolve independently and a slice that finds nothing is dropped, so a
 * fresh install with no knowledge corpus still gets a data-model picture rather
 * than an empty canvas or an error.
 */
export async function resolveDefaultViewSlices(): Promise<DefaultViewSlice[]> {
  const resolved = await Promise.all(
    SLICE_DEFINITIONS.map(async (slice): Promise<DefaultViewSlice | null> => {
      const seedKey = await slice.resolve();
      return seedKey ? { key: slice.key, label: slice.label, rule: slice.rule, seedKey } : null;
    }),
  );
  return resolved.filter((s): s is DefaultViewSlice => s !== null);
}

/** Depth and per-slice cap for the arrival picture.
 *
 *  One hop, and deliberately small. A first attempt used 120 per slice and drew 268
 *  nodes on arrival — accurate, but not the "small, hand-picked slice" this is meant
 *  to be, and more than an operator can read at a glance. 40 keeps each island to a
 *  hub and its immediate neighbours, which is what makes the shape legible rather
 *  than merely present. The seeds are hubs, so every slice hits this cap on a
 *  populated install and the arrival size is stable rather than data-dependent. */
export const DEFAULT_VIEW_DEPTH = 1;
export const DEFAULT_VIEW_NODE_CAP = 40;
