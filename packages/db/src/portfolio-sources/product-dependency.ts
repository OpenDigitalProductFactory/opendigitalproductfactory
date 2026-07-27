// Product-to-product dependency graph (BI-PORTPRIO-2) — the rail for the DPPM
// line-of-sight priority cascade (BI-PORTPRIO-4): a Goods and Services for Sale
// offering's priority floors the priority of the Foundational / Manufacturing &
// Delivery products it depends on.
//
// Edges are persisted in ProductDependency (relationType "depends_on" | "part_of",
// source = the projector/backfill that asserted it). Emitters address products by
// their public productId; this module resolves to the internal FK id. Idempotent
// (the @@unique([from,to,relationType]) makes re-runs safe).

import { prisma } from "../client";
import {
  PLATFORM_CAPABILITY_MANIFEST,
  type PlatformCapabilityManifestEntry,
} from "./platform-capability-manifest";
import { SUPPORTED_INTEGRATIONS } from "./supported-integrations-manifest";

export type ProductDependencyRelation = "depends_on" | "part_of";

export interface ProductDependencyEdge {
  /** Public productId of the dependent (the "from"). */
  fromProductId: string;
  /** Public productId of the dependency (the "to"). */
  toProductId: string;
  relationType: ProductDependencyRelation;
  /** Source kind that asserted the edge (e.g. "manual_entry", "platform_capability"). */
  source?: string;
}

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type ProductDependencyClient = {
  digitalProduct: { findUnique: (args: unknown) => Promise<unknown> };
  productDependency: {
    findUnique: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown>;
  };
};

export type LinkOutcome = "created" | "exists" | "skipped";

/**
 * Link two products by public productId. Resolves both to internal ids; skips if
 * either is missing or the edge is a self-loop. Idempotent on (from,to,relation).
 */
export async function linkProductDependency(input: {
  fromProductId: string;
  toProductId: string;
  relationType: ProductDependencyRelation;
  source?: string;
  db?: ProductDependencyClient;
}): Promise<LinkOutcome> {
  const db = input.db ?? (prisma as unknown as ProductDependencyClient);

  const [from, to] = (await Promise.all([
    db.digitalProduct.findUnique({
      where: { productId: input.fromProductId },
      select: { id: true },
    }),
    db.digitalProduct.findUnique({
      where: { productId: input.toProductId },
      select: { id: true },
    }),
  ])) as Array<{ id: string } | null>;

  if (!from || !to || from.id === to.id) return "skipped";

  const existing = (await db.productDependency.findUnique({
    where: {
      fromProductId_toProductId_relationType: {
        fromProductId: from.id,
        toProductId: to.id,
        relationType: input.relationType,
      },
    },
    select: { id: true },
  })) as { id: string } | null;
  if (existing) return "exists";

  await db.productDependency.create({
    data: {
      fromProductId: from.id,
      toProductId: to.id,
      relationType: input.relationType,
      source: input.source ?? null,
    },
  });
  return "created";
}

export type ProjectDependencyResult = {
  total: number;
  created: number;
  exists: number;
  skipped: number;
};

/** Link a batch of edges, accumulating outcomes. */
export async function linkProductDependencies(
  edges: ProductDependencyEdge[],
  options: { db?: ProductDependencyClient } = {},
): Promise<ProjectDependencyResult> {
  const result: ProjectDependencyResult = {
    total: edges.length,
    created: 0,
    exists: 0,
    skipped: 0,
  };
  for (const edge of edges) {
    const outcome = await linkProductDependency({ ...edge, db: options.db });
    result[outcome]++;
  }
  return result;
}

// ── Edge sources (pure) ──────────────────────────────────────────────────────

type RegistryProduct = {
  product_id: string;
  depends_on_product_ids?: string[];
  is_part_of_product_ids?: string[];
};

/** Derive dependency edges from the digital_product_registry.json shape. */
export function registryDependencyEdges(products: RegistryProduct[]): ProductDependencyEdge[] {
  const edges: ProductDependencyEdge[] = [];
  for (const p of products) {
    for (const dep of p.depends_on_product_ids ?? []) {
      if (dep) edges.push({ fromProductId: p.product_id, toProductId: dep, relationType: "depends_on", source: "manual_entry" });
    }
    for (const parent of p.is_part_of_product_ids ?? []) {
      if (parent) edges.push({ fromProductId: p.product_id, toProductId: parent, relationType: "part_of", source: "manual_entry" });
    }
  }
  return edges;
}

/** Derive dependency edges from the platform-capability manifest's dependsOn. */
export function platformCapabilityDependencyEdges(
  manifest: readonly PlatformCapabilityManifestEntry[] = PLATFORM_CAPABILITY_MANIFEST,
): ProductDependencyEdge[] {
  const edges: ProductDependencyEdge[] = [];
  for (const entry of manifest) {
    for (const dep of entry.dependsOn ?? []) {
      if (dep) edges.push({ fromProductId: entry.productId, toProductId: dep, relationType: "depends_on", source: "platform_capability" });
    }
  }
  return edges;
}

/**
 * Cross-portfolio DPPM line-of-sight edges (BI-PORTPRIO-5) so the cascade reaches
 * beyond Foundational. A Goods and Services for Sale offering is DELIVERED BY the
 * Manufacturing & Delivery pipeline; integrations (For Employees + others) RUN ON
 * the foundational MCP plane. The sold→AI Workforce edge now lives in
 * digital_product_registry.json (`dpf-platform-standard` → `dpf-ai-workforce`)
 * because AI Workforce is a first-class For Employees DigitalProduct.
 */
export function crossPortfolioDependencyEdges(): ProductDependencyEdge[] {
  const edges: ProductDependencyEdge[] = [];

  // Goods and Services for Sale → Manufacturing & Delivery: the platform offer is
  // delivered by the build / source-control / deploy pipeline.
  for (const to of ["cap-build-studio", "cap-github-delivery", "cap-self-upgrade"]) {
    edges.push({
      fromProductId: "dpf-platform-standard",
      toProductId: to,
      relationType: "depends_on",
      source: "platform_capability",
    });
  }

  // Supported integrations → Foundational: every connector runs on the MCP plane.
  for (const integration of SUPPORTED_INTEGRATIONS) {
    edges.push({
      fromProductId: `int-${integration.slug}`,
      toProductId: "cap-mcp-plane",
      relationType: "depends_on",
      source: "integration_registry",
    });
  }

  return edges;
}

/**
 * Materialize the product dependency graph: registry-declared edges + the
 * platform-capability manifest's edges + cross-portfolio DPPM edges. Idempotent;
 * missing endpoints skip.
 */
export async function projectProductDependencyGraph(input: {
  registryProducts: RegistryProduct[];
  db?: ProductDependencyClient;
}): Promise<ProjectDependencyResult> {
  const edges = [
    ...registryDependencyEdges(input.registryProducts),
    ...platformCapabilityDependencyEdges(),
    ...crossPortfolioDependencyEdges(),
  ];
  return linkProductDependencies(edges, { db: input.db });
}

// ── Traversal (for the cascade) ──────────────────────────────────────────────

/** Internal-id reader subset. */
export type DependencyTraversalClient = {
  productDependency: { findMany: (args: unknown) => Promise<unknown> };
};

/**
 * Transitive dependencies of a product (everything it depends on / is part of),
 * following from→to edges. Returns internal ids. Cycle-safe + depth-bounded.
 */
export async function getProductDependencies(
  rootInternalId: string,
  options: { db?: DependencyTraversalClient; maxDepth?: number } = {},
): Promise<string[]> {
  const db = options.db ?? (prisma as unknown as DependencyTraversalClient);
  const maxDepth = options.maxDepth ?? 12;
  const visited = new Set<string>();
  let frontier = [rootInternalId];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const edges = (await db.productDependency.findMany({
      where: { fromProductId: { in: frontier } },
      select: { toProductId: true },
    })) as Array<{ toProductId: string }>;
    const next = edges
      .map((e) => e.toProductId)
      .filter((id) => id !== rootInternalId && !visited.has(id));
    for (const id of next) visited.add(id);
    frontier = Array.from(new Set(next));
    depth++;
  }
  return Array.from(visited);
}

/**
 * Transitive dependents of a product (everything that depends on it), following
 * to→from edges. The cascade direction: a sold offering's dependents are upstream;
 * its DEPENDENCIES (getProductDependencies) are what its priority floors.
 */
export async function getProductDependents(
  rootInternalId: string,
  options: { db?: DependencyTraversalClient; maxDepth?: number } = {},
): Promise<string[]> {
  const db = options.db ?? (prisma as unknown as DependencyTraversalClient);
  const maxDepth = options.maxDepth ?? 12;
  const visited = new Set<string>();
  let frontier = [rootInternalId];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const edges = (await db.productDependency.findMany({
      where: { toProductId: { in: frontier } },
      select: { fromProductId: true },
    })) as Array<{ fromProductId: string }>;
    const next = edges
      .map((e) => e.fromProductId)
      .filter((id) => id !== rootInternalId && !visited.has(id));
    for (const id of next) visited.add(id);
    frontier = Array.from(new Set(next));
    depth++;
  }
  return Array.from(visited);
}
