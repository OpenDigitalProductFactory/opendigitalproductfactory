// packages/db/src/graph-sync.ts
// Projection sync: push Prisma records into the Postgres graph mirror after writes.
// BET-5 (BI-A1E864A5): the writes formerly ran Cypher MERGE against Neo4j; they now
// UPSERT into the `graph_node` / `graph_edge` tables (see 20260714120000_bet5_graph_mirror)
// that pg-graph.ts reads. These are fire-and-forget projections — failures are logged
// but never allowed to bubble up to the caller. Postgres is always the authority.
//
// Node-key model (graph_node.key — the universal key pg-graph.ts joins on):
//   DigitalProduct → productId   Portfolio → slug        InfraCI → ciId
//   TaxonomyNode   → nodeId      Document  → documentId  EaElement → elementId
// The read side (pg-graph.ts getProductsByTaxonomySubtree) keys taxonomy nodes by
// `nodeId` and traverses CHILD_OF / CATEGORIZED_AS in that key space. The Prisma
// DigitalProduct/EaElement carry only the taxonomy FK (= TaxonomyNode.id = the `pgId`
// property), so before wiring a CATEGORIZED_AS / EA_REPRESENTS edge we resolve the FK
// to the taxonomy `nodeId` and use THAT as dst_key — otherwise the edge would be keyed
// by pgId and the nodeId-keyed subtree read would never find the product.

import { prisma } from "./client";
import { NETWORK_RELATIONSHIP_TYPES } from "./neo4j-schema";

// ─── Graph-mirror primitives ──────────────────────────────────────────────────

/** UPSERT a node. On conflict, labels are UNION-merged (existing order preserved,
 *  genuinely-new labels appended) so labels added out-of-band — IT4IT value-stream
 *  labels on DigitalProduct, the type-specific EaElement label — survive a re-sync
 *  (Neo4j `MERGE ... SET` never touched the label set). Props are shallow-merged,
 *  mirroring `SET n.x = …` (only named keys change; others are left intact). */
export async function upsertGraphNode(
  key: string,
  labels: string[],
  props: Record<string, unknown>,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO graph_node (key, labels, props)
     VALUES ($1, $2::text[], $3::jsonb)
     ON CONFLICT (key) DO UPDATE
       SET labels = graph_node.labels || COALESCE((
             SELECT array_agg(l ORDER BY ord)
               FROM unnest(excluded.labels) WITH ORDINALITY AS t(l, ord)
              WHERE NOT (l = ANY(graph_node.labels))
           ), '{}'),
           props  = graph_node.props || excluded.props`,
    key,
    labels,
    JSON.stringify(props),
  );
}

/** Append labels to an already-present node (Neo4j apoc.create.addLabels parity).
 *  No-op if the node is absent or is not of `requiredLabel`. */
async function addGraphNodeLabels(
  key: string,
  requiredLabel: string,
  labels: string[],
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE graph_node
        SET labels = labels || COALESCE((
              SELECT array_agg(l ORDER BY ord)
                FROM unnest($2::text[]) WITH ORDINALITY AS t(l, ord)
               WHERE NOT (l = ANY(graph_node.labels))
            ), '{}')
      WHERE key = $1 AND $3 = ANY(labels)`,
    key,
    labels,
    requiredLabel,
  );
}

/** UPSERT a directed edge keyed by (src_key, dst_key, rel_type). Props shallow-merged. */
export async function upsertGraphEdge(
  srcKey: string,
  dstKey: string,
  relType: string,
  props: Record<string, unknown> = {},
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO graph_edge (src_key, dst_key, rel_type, props)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (src_key, dst_key, rel_type) DO UPDATE
       SET props = graph_edge.props || excluded.props`,
    srcKey,
    dstKey,
    relType,
    JSON.stringify(props),
  );
}

/** Resolve a Prisma TaxonomyNode FK (= TaxonomyNode.id, stored as the `pgId`
 *  property) to its semantic `nodeId`, which is the graph_node.key the read side
 *  uses. Returns null when the taxonomy row is absent. */
async function resolveTaxonomyNodeKey(taxonomyNodeId: string): Promise<string | null> {
  const tn = await prisma.taxonomyNode.findUnique({
    where: { id: taxonomyNodeId },
    select: { nodeId: true },
  });
  return tn?.nodeId ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Upsert a DigitalProduct node and wire its Portfolio + TaxonomyNode edges. */
export async function syncDigitalProduct(dp: {
  productId: string;
  name: string;
  lifecycleStage: string;
  lifecycleStatus: string;
  portfolioSlug?: string | null;
  taxonomyNodeId?: string | null;
}): Promise<void> {
  // Upsert the node
  await upsertGraphNode(dp.productId, ["DigitalProduct"], {
    productId: dp.productId,
    name: dp.name,
    lifecycleStage: dp.lifecycleStage,
    lifecycleStatus: dp.lifecycleStatus,
    syncedAt: nowIso(),
  });

  // BELONGS_TO Portfolio (dst = portfolio slug)
  if (dp.portfolioSlug) {
    await upsertGraphEdge(dp.productId, dp.portfolioSlug, "BELONGS_TO");
  }

  // CATEGORIZED_AS TaxonomyNode. The Prisma FK is the taxonomy pgId; the read side
  // keys taxonomy nodes by nodeId, so resolve FK → nodeId and use that as dst_key.
  if (dp.taxonomyNodeId) {
    const taxonomyKey = await resolveTaxonomyNodeKey(dp.taxonomyNodeId);
    if (taxonomyKey) {
      await upsertGraphEdge(dp.productId, taxonomyKey, "CATEGORIZED_AS");
    }
  }
}

/**
 * Apply IT4IT value stream labels to a DigitalProduct node.
 * Labels: :S2P (Strategy to Portfolio), :R2D (Requirement to Deploy),
 *         :R2F (Request to Fulfill), :D2C (Detect to Correct)
 * See neo4j-schema.ts for label definitions.
 */
export async function syncIT4ITLabels(
  productId: string,
  labels: Array<"S2P" | "R2D" | "R2F" | "D2C">,
): Promise<void> {
  if (labels.length === 0) return;
  await addGraphNodeLabels(productId, "DigitalProduct", labels);
}

/** Upsert a TaxonomyNode node and its CHILD_OF parent edge. */
export async function syncTaxonomyNode(tn: {
  nodeId: string;
  name: string;
  pgId: string;
  parentNodeId?: string | null;
}): Promise<void> {
  await upsertGraphNode(tn.nodeId, ["TaxonomyNode"], {
    nodeId: tn.nodeId,
    name: tn.name,
    pgId: tn.pgId,
    syncedAt: nowIso(),
  });

  // CHILD_OF: child (src = nodeId) → parent (dst = parentNodeId)
  if (tn.parentNodeId) {
    await upsertGraphEdge(tn.nodeId, tn.parentNodeId, "CHILD_OF");
  }
}

/** Upsert a Portfolio node. */
export async function syncPortfolio(p: {
  slug: string;
  name: string;
}): Promise<void> {
  await upsertGraphNode(p.slug, ["Portfolio"], {
    slug: p.slug,
    name: p.name,
    syncedAt: nowIso(),
  });
}

/**
 * Storage label for a wiki page, derived from its `pageKind` (BI-3045CC18).
 *
 * One label per node rather than a generic `WikiPage` marker plus a specific kind:
 * the explorer census sums per-label counts, so a dual-labelled node is counted
 * twice — the reason `EaElement` needs a hard-coded skip on the read side.
 *
 * `pageKind` is a plain string in the schema, so an unrecognised kind still yields
 * a well-formed `Wiki__*` label and lands in the knowledge domain via the prefix
 * rule in explorer-vocabulary.ts.
 */
export function wikiPageLabel(pageKind: string): string {
  const pascal = pageKind
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
  return `Wiki__${pascal || "Page"}`;
}

/** Upsert a WikiPage node and its OVERRIDES edge onto the kernel page it refines.
 *
 *  Keyed by `id`, not `slug`: `WikiPage` is unique on (organizationId, slug), so a
 *  slug is ambiguous across the kernel page and each organization's overlay of it.
 *  This matches EaElement, which is also keyed by its cuid. */
export async function syncWikiPage(page: {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  status: string;
  isKernel: boolean;
  organizationId?: string | null;
  kernelPageId?: string | null;
}): Promise<void> {
  await upsertGraphNode(page.id, [wikiPageLabel(page.pageKind)], {
    pageId: page.id,
    slug: page.slug,
    // `name` is the property the explorer's search and canvas labels read across
    // every domain; carrying the title under it keeps wiki pages findable without
    // special-casing the read side.
    name: page.title,
    title: page.title,
    pageKind: page.pageKind,
    status: page.status,
    isKernel: page.isKernel,
    organizationId: page.organizationId ?? null,
    syncedAt: nowIso(),
  });

  // An organization's overlay page refines a kernel page. This is the edge that
  // makes the WWWD-over-kernel relationship visible rather than implied.
  if (page.kernelPageId) {
    await upsertGraphEdge(page.id, page.kernelPageId, "OVERRIDES");
  }
}

/** Upsert the page-to-page link edge (`WikiPageLink`). */
export async function syncWikiPageLink(link: {
  fromPageId: string;
  toPageId: string;
}): Promise<void> {
  await upsertGraphEdge(link.fromPageId, link.toPageId, "LINKS_TO");
}

export async function syncDocumentNode(doc: {
  documentId: string;
  title: string;
  currentState?: string | null;
  documentKind?: string | null;
}): Promise<void> {
  await upsertGraphNode(doc.documentId, ["Document"], {
    documentId: doc.documentId,
    title: doc.title,
    currentState: doc.currentState ?? null,
    documentKind: doc.documentKind ?? null,
    syncedAt: nowIso(),
  });
}

export async function syncDocumentReference(ref: {
  sourceDocumentId: string;
  sourceTitle: string;
  sourceState?: string | null;
  sourceKind?: string | null;
  sourceVersionId?: string | null;
  targetDocumentId: string;
  targetTitle: string;
  targetState?: string | null;
  targetKind?: string | null;
  targetVersionId?: string | null;
  refType: string;
  anchor?: string | null;
}): Promise<void> {
  const syncedAt = nowIso();
  await upsertGraphNode(ref.sourceDocumentId, ["Document"], {
    documentId: ref.sourceDocumentId,
    title: ref.sourceTitle,
    currentState: ref.sourceState ?? null,
    documentKind: ref.sourceKind ?? null,
    syncedAt,
  });
  await upsertGraphNode(ref.targetDocumentId, ["Document"], {
    documentId: ref.targetDocumentId,
    title: ref.targetTitle,
    currentState: ref.targetState ?? null,
    documentKind: ref.targetKind ?? null,
    syncedAt,
  });
  // DOC_REFERENCES edge. The Neo4j edge identity also carried refType +
  // source/targetVersionId; the mirror's (src,dst,rel_type) uniqueness cannot
  // hold parallel references, so those are stored as props on the single edge.
  await upsertGraphEdge(ref.sourceDocumentId, ref.targetDocumentId, "DOC_REFERENCES", {
    refType: ref.refType,
    sourceVersionId: ref.sourceVersionId ?? null,
    targetVersionId: ref.targetVersionId ?? null,
    anchor: ref.anchor ?? null,
    syncedAt,
  });
}

export interface InfraCIExtendedProps {
  baseUrl?: string;
  gpu?: string;
  vramGb?: number | null;
  modelCount?: number;
  // OSI layer context (Phase 1 — multi-layer topology graph)
  osiLayer?: number;
  osiLayerName?: string;
  networkAddress?: string;
  networkMask?: string;
  protocolFamily?: string;
  parentCiId?: string;
  // Customer-estate scope (Phase: customer topology isolation).
  // scopeKey defaults to "organization:internal" via the InventoryEntity column
  // default; customerAccountId/customerSiteId are null for MSP-internal nodes.
  scopeKey?: string;
  customerAccountId?: string | null;
  customerSiteId?: string | null;
}

/** Upsert an InfraCI node. */
export async function syncInfraCI(
  ci: {
    ciId: string;
    name: string;
    ciType: string;   // server | container | database | service | network
    status: string;   // operational | degraded | offline
    portfolioSlug?: string | null;
  },
  extendedProps?: InfraCIExtendedProps,
): Promise<void> {
  const props: Record<string, unknown> = {
    ciId: ci.ciId,
    name: ci.name,
    ciType: ci.ciType,
    status: ci.status,
    syncedAt: nowIso(),
  };

  if (extendedProps) {
    // Only carry keys that were explicitly provided (parity with the conditional
    // Neo4j SET clauses — an absent key leaves any existing prop untouched).
    if (extendedProps.baseUrl !== undefined) props.baseUrl = extendedProps.baseUrl;
    if (extendedProps.gpu !== undefined) props.gpu = extendedProps.gpu;
    if (extendedProps.vramGb !== undefined) props.vramGb = extendedProps.vramGb;
    if (extendedProps.modelCount !== undefined) props.modelCount = extendedProps.modelCount;
    if (extendedProps.osiLayer !== undefined) props.osiLayer = extendedProps.osiLayer;
    if (extendedProps.osiLayerName !== undefined) props.osiLayerName = extendedProps.osiLayerName;
    if (extendedProps.networkAddress !== undefined) props.networkAddress = extendedProps.networkAddress;
    if (extendedProps.networkMask !== undefined) props.networkMask = extendedProps.networkMask;
    if (extendedProps.protocolFamily !== undefined) props.protocolFamily = extendedProps.protocolFamily;
    if (extendedProps.parentCiId !== undefined) props.parentCiId = extendedProps.parentCiId;
    if (extendedProps.scopeKey !== undefined) props.scopeKey = extendedProps.scopeKey;
    if (extendedProps.customerAccountId !== undefined) props.customerAccountId = extendedProps.customerAccountId;
    if (extendedProps.customerSiteId !== undefined) props.customerSiteId = extendedProps.customerSiteId;
  }

  await upsertGraphNode(ci.ciId, ["InfraCI"], props);

  if (ci.portfolioSlug) {
    await upsertGraphEdge(ci.ciId, ci.portfolioSlug, "BELONGS_TO");
  }
}

/** Create or replace a DEPENDS_ON relationship between two nodes.
 *  fromLabel / toLabel: "DigitalProduct" | "InfraCI"
 *  fromId / toId: the unique key value (productId or ciId respectively)
 */
export async function syncDependsOn(dep: {
  fromLabel: "DigitalProduct" | "InfraCI";
  fromId: string;
  toLabel: "InfraCI";
  toId: string;
  role?: string;   // e.g. "database" | "runtime" | "network"
  since?: string;  // ISO date string
}): Promise<void> {
  await upsertGraphEdge(dep.fromId, dep.toId, "DEPENDS_ON", {
    role: dep.role ?? null,
    since: dep.since ?? null,
    syncedAt: nowIso(),
  });
}

// ─── EA Modeling sync ─────────────────────────────────────────────────────────

/** Upsert an EaElement node with dual labels (:EaElement:NeoLabel).
 *  Also creates EA_REPRESENTS edges to any bridge entities that are set.
 *  Note: infraCiKey is stored as a scalar property on the node — there is
 *  no EA_REPRESENTS bridge edge to InfraCI (the key is denormalised for
 *  direct lookup in queries without requiring an extra hop). */
/** Default OSI layer for known entity types. */
const DEFAULT_OSI_LAYER: Record<string, number> = {
  host: 3,
  container: 7,
  runtime: 7,
  database: 7,
  service: 7,
  network: 3,
  "ai-inference": 7,
  network_interface: 3,
  subnet: 3,
  gateway: 3,
  docker_host: 3,
  router: 3,
  network_client: 3,
  network_device: 3,
  switch: 2,
  access_point: 2,
  vlan: 2,
};

const OSI_LAYER_NAMES: Record<number, string> = {
  1: "physical",
  2: "data_link",
  3: "network",
  4: "transport",
  5: "session",
  6: "presentation",
  7: "application",
};

export async function syncInventoryEntityAsInfraCI(entity: {
  entityKey: string;
  name: string;
  entityType: string;
  status: string;
  portfolioSlug?: string | null;
  properties?: Record<string, unknown> | null;
}): Promise<void> {
  const ciType =
    entity.entityType === "host" ? "server"
    : entity.entityType === "container" ? "container"
    : entity.entityType === "runtime" ? "service"
    : entity.entityType;
  const operationalStatus =
    entity.status === "stale" ? "degraded"
    : entity.status === "inactive" ? "offline"
    : "operational";

  // Resolve OSI layer: explicit from entity properties, else default by type
  const props = entity.properties ?? {};
  const osiLayer = (props.osiLayer as number | undefined)
    ?? DEFAULT_OSI_LAYER[entity.entityType];
  const osiLayerName = (props.osiLayerName as string | undefined)
    ?? (osiLayer != null ? OSI_LAYER_NAMES[osiLayer] : undefined);

  const extendedProps: InfraCIExtendedProps = {};
  if (osiLayer != null) extendedProps.osiLayer = osiLayer;
  if (osiLayerName != null) extendedProps.osiLayerName = osiLayerName;
  if (props.networkAddress != null) extendedProps.networkAddress = props.networkAddress as string;
  if (props.networkMask != null) extendedProps.networkMask = props.networkMask as string;
  if (props.protocolFamily != null) extendedProps.protocolFamily = props.protocolFamily as string;
  if (props.parentCiId != null) extendedProps.parentCiId = props.parentCiId as string;
  if (props.scopeKey != null) extendedProps.scopeKey = props.scopeKey as string;
  if (props.customerAccountId !== undefined) {
    extendedProps.customerAccountId = props.customerAccountId as string | null;
  }
  if (props.customerSiteId !== undefined) {
    extendedProps.customerSiteId = props.customerSiteId as string | null;
  }

  await syncInfraCI(
    {
      ciId: entity.entityKey,
      name: entity.name,
      ciType,
      status: operationalStatus,
      portfolioSlug: entity.portfolioSlug ?? null,
    },
    Object.keys(extendedProps).length > 0 ? extendedProps : undefined,
  );
}

/** Relationship types that get their own typed edge instead of DEPENDS_ON. */
const TYPED_EDGE_RELATIONSHIP_TYPES = new Set([
  ...NETWORK_RELATIONSHIP_TYPES.map((t) => t.toUpperCase()),
  "MONITORS",
]);

export async function syncInventoryRelationship(rel: {
  fromEntityKey: string;
  toEntityKey: string;
  relationshipType: string;
}): Promise<void> {
  const neoType = rel.relationshipType.toUpperCase();

  if (TYPED_EDGE_RELATIONSHIP_TYPES.has(neoType)) {
    await upsertGraphEdge(rel.fromEntityKey, rel.toEntityKey, neoType, {
      syncedAt: nowIso(),
    });
    return;
  }

  await syncDependsOn({
    fromLabel: "InfraCI",
    fromId: rel.fromEntityKey,
    toLabel: "InfraCI",
    toId: rel.toEntityKey,
    role: rel.relationshipType,
  });
}

export async function syncEaElement(element: {
  id: string;
  neoLabel: string;         // from EaElementType.neoLabel
  notationSlug: string;     // from EaElementType.notation.slug
  elementTypeSlug: string;  // from EaElementType.slug
  name: string;
  lifecycleStage: string;
  lifecycleStatus: string;
  infraCiKey?: string | null;
  digitalProductId?: string | null;
  portfolioSlug?: string | null;
  taxonomyNodeId?: string | null;
}): Promise<void> {
  // Upsert the node with the dual label set (:EaElement:NeoLabel) applied directly
  // — the mirror has no APOC step; both labels go on at insert and survive re-sync.
  await upsertGraphNode(element.id, ["EaElement", element.neoLabel], {
    elementId: element.id,
    notationId: element.notationSlug,
    elementType: element.elementTypeSlug,
    name: element.name,
    lifecycleStage: element.lifecycleStage,
    lifecycleStatus: element.lifecycleStatus,
    infraCiKey: element.infraCiKey ?? null,
    syncedAt: nowIso(),
  });

  // EA_REPRESENTS → DigitalProduct
  if (element.digitalProductId) {
    await upsertGraphEdge(element.id, element.digitalProductId, "EA_REPRESENTS");
  }

  // EA_REPRESENTS → Portfolio
  if (element.portfolioSlug != null) {
    await upsertGraphEdge(element.id, element.portfolioSlug, "EA_REPRESENTS");
  }

  // EA_REPRESENTS → TaxonomyNode. Resolve the Prisma FK (pgId) to the taxonomy
  // nodeId — the key the graph mirror uses — before wiring the edge.
  if (element.taxonomyNodeId) {
    const taxonomyKey = await resolveTaxonomyNodeKey(element.taxonomyNodeId);
    if (taxonomyKey) {
      await upsertGraphEdge(element.id, taxonomyKey, "EA_REPRESENTS");
    }
  }
}

/** Upsert an EaRelationship edge between two EaElement nodes. */
export async function syncEaRelationship(rel: {
  id: string;
  fromElementId: string;
  toElementId: string;
  neoType: string;      // from EaRelationshipType.neoType
  notationSlug: string;
  relationshipTypeSlug: string;
}): Promise<void> {
  // Edge identity in Neo4j also carried relationshipId; the mirror keys edges by
  // (src,dst,rel_type) and stores relationshipId as a prop (used by deleteEaRelationship).
  await upsertGraphEdge(rel.fromElementId, rel.toElementId, rel.neoType, {
    relationshipId: rel.id,
    notationId: rel.notationSlug,
    relationshipType: rel.relationshipTypeSlug,
    syncedAt: nowIso(),
  });
}

/** Remove an EaElement node and all its EA edges. */
export async function deleteEaElement(elementId: string): Promise<void> {
  // DETACH DELETE equivalent: drop incident edges first, then the node.
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_edge WHERE src_key = $1 OR dst_key = $1`,
    elementId,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_node WHERE key = $1 AND 'EaElement' = ANY(labels)`,
    elementId,
  );
}

/** Remove a single EaRelationship edge by its relationshipId property. */
export async function deleteEaRelationship(relationshipId: string): Promise<void> {
  // No rel-type filter — matches any type by relationshipId (low volume, intentional).
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_edge WHERE props->>'relationshipId' = $1`,
    relationshipId,
  );
}
