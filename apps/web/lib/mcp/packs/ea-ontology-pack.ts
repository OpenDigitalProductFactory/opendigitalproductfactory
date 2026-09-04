// Enterprise-Architecture / ontology-graph tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "EA / ArchiMate ontology graph" domain out of the
// mcp-tools.ts executeTool switch: creating and classifying ontology elements
// and typed relationships, querying the graph, running bounded traversal
// patterns, describing an EA view (read-only graph analytics), and importing /
// exporting .archimate XML files. Write handlers persist directly through the EA
// Prisma models; the traversal, view, and archimate handlers lazy-import their
// dedicated EA domain services. Each handler reproduces the former switch case
// verbatim, so behaviour is identical when the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "create_ea_element",
    description: "Create a new element in the ontology graph. Use when a user describes a new architectural entity (product, component, actor, service, etc). Defaults to refinementLevel=conceptual.",
    inputSchema: {
      type: "object",
      properties: {
        name:             { type: "string", description: "Element name" },
        elementTypeSlug:  { type: "string", description: "Element type slug (e.g. digital_product, application_component, business_actor, ai_coworker)" },
        description:      { type: "string", description: "Optional description" },
        refinementLevel:  { type: "string", enum: ["conceptual", "logical", "actual"], description: "Defaults to conceptual" },
        itValueStream:    { type: "string", enum: ["evaluate", "explore", "integrate", "deploy", "release", "consume", "operate"] },
        ontologyRole:     { type: "string", enum: ["governed_thing", "actor", "control", "event_evidence", "information_object", "resource", "offer"] },
        digitalProductId: { type: "string" },
        portfolioId:      { type: "string" },
        properties:       { type: "object" },
      },
      required: ["name", "elementTypeSlug"],
    },
    requiredCapability: "manage_ea_model",
    sideEffect: true,
  },
  {
    name: "create_ea_relationship",
    description: "Connect two ontology graph elements with a typed relationship. Validates against EaRelationshipRule before creating.",
    inputSchema: {
      type: "object",
      properties: {
        fromElementId:        { type: "string" },
        toElementId:          { type: "string" },
        relationshipTypeSlug: { type: "string", enum: ["realizes", "depends_on", "assigned_to", "composed_of", "associated_with", "influences", "triggers", "flows_to", "serves", "accesses"] },
        properties:           { type: "object" },
      },
      required: ["fromElementId", "toElementId", "relationshipTypeSlug"],
    },
    requiredCapability: "manage_ea_model",
    sideEffect: true,
  },
  {
    name: "classify_ea_element",
    description: "Advance an element's IT4IT value stream stage and/or refinement level. Call after the user confirms what stage their architecture work is in.",
    inputSchema: {
      type: "object",
      properties: {
        elementId:       { type: "string" },
        itValueStream:   { type: "string", enum: ["evaluate", "explore", "integrate", "deploy", "release", "consume", "operate"] },
        refinementLevel: { type: "string", enum: ["conceptual", "logical", "actual"] },
        ontologyRole:    { type: "string", enum: ["governed_thing", "actor", "control", "event_evidence", "information_object", "resource", "offer"] },
      },
      required: ["elementId"],
    },
    requiredCapability: "manage_ea_model",
    sideEffect: true,
  },
  {
    name: "query_ontology_graph",
    description: "Query ontology graph elements with filters. Use before creating elements to avoid duplicates. Returns element IDs, names, types, and refinement levels.",
    inputSchema: {
      type: "object",
      properties: {
        elementTypeSlugs:     { type: "array", items: { type: "string" }, description: "Filter by element type slugs" },
        refinementLevel:      { type: "string", enum: ["conceptual", "logical", "actual"] },
        itValueStream:        { type: "string" },
        ontologyRole:         { type: "string" },
        digitalProductId:     { type: "string" },
        portfolioId:          { type: "string" },
        nameContains:         { type: "string" },
        includeRelationships: { type: "boolean" },
        limit:                { type: "number", description: "Max results, default 20" },
      },
    },
    requiredCapability: "view_ea_modeler",
    sideEffect: false,
  },
  {
    name: "run_traversal_pattern",
    description: "Run a named bounded analysis pattern (e.g. blast_radius, governance_audit, ma_separation, cross_layer_impact) from one or more starting elements. Returns traversal paths and summary. cross_layer_impact starts from a data-model element and returns the actual operational/network/integration elements that trace to it (the cross-layer blast radius of a data-model change).",
    inputSchema: {
      type: "object",
      properties: {
        patternSlug:     { type: "string", enum: ["blast_radius", "governance_audit", "architecture_traceability", "ai_oversight", "cost_rollup", "ma_separation", "service_customer_impact", "cross_layer_impact"] },
        startElementIds: { type: "array", items: { type: "string" } },
        maxDepth:        { type: "number" },
      },
      required: ["patternSlug", "startElementIds"],
    },
    requiredCapability: "view_ea_modeler",
    sideEffect: false,
  },
  {
    name: "import_archimate",
    description: "Import a .archimate XML file from the Archi tool into the ontology graph. All elements are created as draft/conceptual. Max file size: 1 MB base64.",
    inputSchema: {
      type: "object",
      properties: {
        fileContentBase64:      { type: "string", description: "Base64-encoded .archimate XML content" },
        fileName:               { type: "string" },
        targetPortfolioId:      { type: "string" },
        targetDigitalProductId: { type: "string" },
      },
      required: ["fileContentBase64", "fileName"],
    },
    requiredCapability: "manage_ea_model",
    sideEffect: true,
  },
  {
    name: "export_archimate",
    description: "Export elements scoped to a portfolio, digital product, or view as a .archimate XML file. Extension types are mapped to standard ArchiMate types with dpf: properties for round-trip fidelity.",
    inputSchema: {
      type: "object",
      properties: {
        scopeType: { type: "string", enum: ["view", "portfolio", "digital_product"] },
        scopeRef:  { type: "string", description: "ID of the view, portfolio, or digital product" },
        fileName:  { type: "string", description: "Output filename (optional)" },
      },
      required: ["scopeType", "scopeRef"],
    },
    requiredCapability: "view_ea_modeler",
    sideEffect: false,
  },
  {
    name: "describe_ea_view",
    description: "Summarize an EA view so a coworker can explain or critique it (read-only). Returns element counts by type, relationship counts by type, connected components, isolated and highest-degree (hub) nodes, containment structure derived from 'contains' edges, viewpoint conformance, and layout density/shape (tree/forest/mesh). Use before suggesting how to arrange or restructure a view.",
    inputSchema: {
      type: "object",
      properties: {
        viewId: { type: "string", description: "EaView id to describe" },
      },
      required: ["viewId"],
    },
    requiredCapability: "view_ea_modeler",
    sideEffect: false,
  },
];

async function createEaElementHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
  if (!notation) return { success: false, message: "ArchiMate 4 notation not seeded", error: "Notation not found" };
  const et = await prisma.eaElementType.findUnique({
    where: { notationId_slug: { notationId: notation.id, slug: String(params["elementTypeSlug"] ?? "") } },
  });
  if (!et) return { success: false, message: `Element type "${String(params["elementTypeSlug"])}" not found`, error: "Element type not found" };
  const el = await prisma.eaElement.create({
    data: {
      elementTypeId: et.id,
      name: String(params["name"]),
      description: typeof params["description"] === "string" ? params["description"] : null,
      refinementLevel: typeof params["refinementLevel"] === "string" ? params["refinementLevel"] : "conceptual",
      itValueStream: typeof params["itValueStream"] === "string" ? params["itValueStream"] : null,
      ontologyRole: typeof params["ontologyRole"] === "string" ? params["ontologyRole"] : null,
      digitalProductId: typeof params["digitalProductId"] === "string" ? params["digitalProductId"] : null,
      portfolioId: typeof params["portfolioId"] === "string" ? params["portfolioId"] : null,
      createdById: userId,
      properties: (typeof params["properties"] === "object" && params["properties"] !== null) ? params["properties"] as import("@dpf/db").Prisma.InputJsonValue : {},
    },
  });
  return { success: true, entityId: el.id, message: `Created ${et.name} element "${String(params["name"])}"`, data: { elementId: el.id, elementTypeName: et.name, refinementLevel: el.refinementLevel } };
}

async function createEaRelationshipHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
  if (!notation) return { success: false, message: "ArchiMate 4 notation not seeded", error: "Notation not found" };
  const relSlug = String(params["relationshipTypeSlug"] ?? "");
  const rt = await prisma.eaRelationshipType.findUnique({ where: { notationId_slug: { notationId: notation.id, slug: relSlug } } });
  if (!rt) return { success: false, message: `Relationship type "${relSlug}" not found`, error: "Relationship type not found" };
  const fromEl = await prisma.eaElement.findUnique({ where: { id: String(params["fromElementId"]) }, select: { elementTypeId: true, name: true } });
  const toEl   = await prisma.eaElement.findUnique({ where: { id: String(params["toElementId"])   }, select: { elementTypeId: true, name: true } });
  if (!fromEl || !toEl) return { success: false, message: "One or both elements not found", error: "Element not found" };
  const rule = await prisma.eaRelationshipRule.findFirst({
    where: { fromElementTypeId: fromEl.elementTypeId, toElementTypeId: toEl.elementTypeId, relationshipTypeId: rt.id },
  });
  if (!rule) return { success: false, message: `Relationship "${relSlug}" not permitted between these element types`, error: "Rule not permitted", data: { validationResult: "blocked" } };
  // Upsert on the (from, to, type) natural key so a repeat call is idempotent rather than
  // hitting the unique constraint. BI-8C121D30.
  const relProps = (typeof params["properties"] === "object" && params["properties"] !== null) ? params["properties"] as import("@dpf/db").Prisma.InputJsonValue : {};
  const rel = await prisma.eaRelationship.upsert({
    where: { fromElementId_toElementId_relationshipTypeId: { fromElementId: String(params["fromElementId"]), toElementId: String(params["toElementId"]), relationshipTypeId: rt.id } },
    create: {
      fromElementId: String(params["fromElementId"]),
      toElementId: String(params["toElementId"]),
      relationshipTypeId: rt.id,
      notationSlug: "archimate4",
      createdById: userId,
      properties: relProps,
    },
    update: { properties: relProps },
  });
  return { success: true, entityId: rel.id, message: `Created "${relSlug}" relationship`, data: { relationshipId: rel.id, fromElementName: fromEl.name, toElementName: toEl.name, validationResult: "allowed" } };
}

async function classifyEaElementHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const data: Record<string, unknown> = {};
  if (typeof params["itValueStream"] === "string")   data["itValueStream"]   = params["itValueStream"];
  if (typeof params["refinementLevel"] === "string") data["refinementLevel"] = params["refinementLevel"];
  if (typeof params["ontologyRole"] === "string")    data["ontologyRole"]    = params["ontologyRole"];
  if (Object.keys(data).length === 0) return { success: false, message: "No classification fields provided", error: "Nothing to update" };
  const updated = await prisma.eaElement.update({ where: { id: String(params["elementId"]) }, data });
  return { success: true, entityId: updated.id, message: `Classified element ${updated.id}`, data: { elementId: updated.id, refinementLevel: updated.refinementLevel, itValueStream: updated.itValueStream } };
}

async function queryOntologyGraphHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
  if (!notation) return { success: false, message: "ArchiMate 4 notation not seeded", error: "Notation not found" };
  const where: Record<string, unknown> = {};
  const slugs = Array.isArray(params["elementTypeSlugs"]) ? params["elementTypeSlugs"] as string[] : [];
  if (slugs.length > 0) {
    const ets = await prisma.eaElementType.findMany({ where: { notationId: notation.id, slug: { in: slugs } }, select: { id: true } });
    where["elementTypeId"] = { in: ets.map(et => et.id) };
  }
  if (typeof params["refinementLevel"] === "string") where["refinementLevel"] = params["refinementLevel"];
  if (typeof params["itValueStream"] === "string") where["itValueStream"] = params["itValueStream"];
  if (typeof params["ontologyRole"] === "string") where["ontologyRole"] = params["ontologyRole"];
  if (typeof params["digitalProductId"] === "string") where["digitalProductId"] = params["digitalProductId"];
  if (typeof params["portfolioId"] === "string") where["portfolioId"] = params["portfolioId"];
  if (typeof params["nameContains"] === "string") where["name"] = { contains: params["nameContains"], mode: "insensitive" };
  const limit = typeof params["limit"] === "number" ? Math.min(params["limit"], 50) : 20;
  const includeRels = params["includeRelationships"] === true;
  const elements = await prisma.eaElement.findMany({
    where,
    take: limit,
    include: {
      elementType: { select: { slug: true, name: true } },
      ...(includeRels ? { fromRelationships: { include: { relationshipType: { select: { slug: true } }, toElement: { select: { id: true, name: true } } } } } : {}),
    },
  });
  const total = await prisma.eaElement.count({ where });

  // BI-4501D3C8: never return ontology elements without a staleness signal.
  // The mirror is a NIGHTLY reconcile, so an element merged since the last run
  // is legitimately absent here — and a bare empty result made that
  // indistinguishable from "does not exist".
  let trust: unknown = undefined;
  let staleness = "";
  try {
    const { buildMirrorFreshnessTrust } = await import("@/lib/ea/mirror-freshness-trust");
    const { DATA_MODEL_MIRROR_TASK_ID } = await import("@dpf/db");
    const task = await prisma.scheduledAgentTask.findUnique({
      where: { taskId: DATA_MODEL_MIRROR_TASK_ID },
      select: { lastRunAt: true, lastStatus: true, isActive: true },
    });
    const assessment = buildMirrorFreshnessTrust({
      lastRunAt: task?.lastRunAt ?? null,
      lastStatus: task?.lastStatus ?? null,
      isActive: task?.isActive ?? false,
      elementCount: total,
    });
    trust = assessment;
    if (total === 0) {
      staleness =
        ` — NO MATCHES. This is a nightly mirror (${assessment.tier} trust, ${assessment.action}): ` +
        `${assessment.primaryRationale} An empty result is NOT evidence the model does not exist; ` +
        "check the committed schema with describe_committed_model before concluding absence.";
    } else if (assessment.tier === "low" || assessment.action === "qualify") {
      staleness = ` — mirror trust ${assessment.tier} (${assessment.action}): ${assessment.primaryRationale}`;
    }
  } catch {
    // Advisory only; a scoring failure must not fail the read.
  }

  return {
    success: true,
    message: `Found ${elements.length} elements (${total} total)${staleness}`,
    data: {
      ...(trust ? { trust } : {}),
      elements: elements.map(el => ({
        elementId: el.id,
        name: el.name,
        elementTypeName: el.elementType.name,
        refinementLevel: el.refinementLevel,
        itValueStream: el.itValueStream,
        ontologyRole: el.ontologyRole,
      })),
      totalCount: total,
    },
  };
}

async function runTraversalPatternHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { runTraversalPattern } = await import("@/lib/ea/traversal-executor");
  const result = await runTraversalPattern({
    patternSlug: String(params["patternSlug"] ?? ""),
    startElementIds: Array.isArray(params["startElementIds"]) ? params["startElementIds"] as string[] : [],
    maxDepth: typeof params["maxDepth"] === "number" ? params["maxDepth"] : 6,
  });
  if (!result.ok) return { success: false, message: result.error ?? "Traversal failed", error: result.error };
  return { success: true, message: `Traversal complete: ${result.data!.summary.nodesTraversed} nodes`, data: result.data as Record<string, unknown> };
}

async function describeEaViewHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const viewId = String(params["viewId"] ?? "");
  if (!viewId) return { success: false, message: "viewId is required", error: "MissingViewId" };
  const { getEaView } = await import("@/lib/ea-data");
  const view = await getEaView(viewId);
  if (!view) return { success: false, message: "View not found", error: "ViewNotFound" };

  const elements = view.elements;
  const edges = view.edges;
  const n = elements.length;

  const elementsByType: Record<string, number> = {};
  for (const el of elements) {
    elementsByType[el.elementType.name] = (elementsByType[el.elementType.name] ?? 0) + 1;
  }
  const relationshipsByType: Record<string, number> = {};
  for (const e of edges) {
    relationshipsByType[e.relationshipType.name] = (relationshipsByType[e.relationshipType.name] ?? 0) + 1;
  }

  // Degree + connected components (union-find) over de-duplicated undirected edges.
  const index = new Map(elements.map((el, i) => [el.viewElementId, i]));
  const parent = elements.map((_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[x] !== root) { const next = parent[x]!; parent[x] = root; x = next; }
    return root;
  };
  const degree = new Map<string, number>(elements.map((el) => [el.viewElementId, 0]));
  const seenPair = new Set<string>();
  let hasCycle = false;
  for (const e of edges) {
    const a = index.get(e.fromViewElementId);
    const b = index.get(e.toViewElementId);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    degree.set(e.fromViewElementId, (degree.get(e.fromViewElementId) ?? 0) + 1);
    degree.set(e.toViewElementId, (degree.get(e.toViewElementId) ?? 0) + 1);
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) hasCycle = true; else parent[ra] = rb;
  }
  const components = new Set(elements.map((_, i) => find(i))).size;
  const edgeCount = seenPair.size;
  const nameByVe = new Map(elements.map((el) => [el.viewElementId, el.element.name]));
  const byDegree = [...degree.entries()].sort((x, y) => y[1] - x[1]);
  const hubs = byDegree.filter(([, d]) => d > 0).slice(0, 5).map(([ve, d]) => ({ name: nameByVe.get(ve) ?? ve, degree: d }));
  const isolatedNodes = byDegree.filter(([, d]) => d === 0).length;

  // Containment derived from "contains" edges (parent → child).
  const childSet = new Set<string>();
  const containerSet = new Set<string>();
  for (const e of edges) {
    if (e.relationshipType.slug !== "contains") continue;
    containerSet.add(e.fromViewElementId);
    childSet.add(e.toViewElementId);
  }
  const containmentRoots = [...containerSet].filter((id) => !childSet.has(id)).length;

  const allowed = (view.viewpoint as { allowedElementTypeSlugs?: string[] } | null)?.allowedElementTypeSlugs ?? null;
  const nonConformingElements = allowed
    ? elements.filter((el) => !allowed.includes(el.elementType.slug)).length
    : null;

  const density = n > 0 ? Number((edgeCount / n).toFixed(2)) : 0;
  const shape = edgeCount === 0
    ? "no relationships"
    : !hasCycle
    ? (components === 1 ? "tree" : "forest")
    : density > 1.5
    ? "dense mesh"
    : "general graph";

  return {
    success: true,
    message: `View "${view.name}" — ${n} elements, ${edgeCount} relationships, ${components} component(s); shape: ${shape}${isolatedNodes ? `, ${isolatedNodes} isolated` : ""}.`,
    data: {
      viewId,
      name: view.name,
      viewpoint: view.viewpoint?.name ?? null,
      elementCount: n,
      relationshipCount: edgeCount,
      elementsByType,
      relationshipsByType,
      connectedComponents: components,
      isolatedNodes,
      hubs,
      containment: { containerCount: containerSet.size, roots: containmentRoots },
      nonConformingElements,
      densityEdgesPerNode: density,
      shape,
    },
  };
}

async function importArchimateHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const { importArchimateFile } = await import("@/lib/actions/ea-archimate");
  const fileContent = String(params["fileContentBase64"] ?? "");
  const result = await importArchimateFile({
    fileContentBase64: fileContent,
    fileName: String(params["fileName"] ?? "import.archimate"),
    userId,
    targetPortfolioId: typeof params["targetPortfolioId"] === "string" ? params["targetPortfolioId"] : undefined,
    targetDigitalProductId: typeof params["targetDigitalProductId"] === "string" ? params["targetDigitalProductId"] : undefined,
  });
  if (!result.ok) return { success: false, message: result.error ?? "Import failed", error: result.error };
  return { success: true, message: `Imported ${result.data!.elementsCreated} elements, ${result.data!.relationshipsCreated} relationships`, data: result.data as Record<string, unknown> };
}

async function exportArchimateHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const { exportArchimateFile } = await import("@/lib/actions/ea-archimate");
  const result = await exportArchimateFile({
    scopeType: String(params["scopeType"] ?? "") as "view" | "portfolio" | "digital_product",
    scopeRef: String(params["scopeRef"] ?? ""),
    fileName: typeof params["fileName"] === "string" ? params["fileName"] : undefined,
    userId,
  });
  if (!result.ok) return { success: false, message: result.error ?? "Export failed", error: result.error };
  return { success: true, message: `Exported ${result.data!.elementCount} elements to ${result.data!.fileName}`, data: result.data as Record<string, unknown> };
}

const handlers: Record<string, ToolPackHandler> = {
  create_ea_element: (params, userId) => createEaElementHandler(params, userId),
  create_ea_relationship: (params, userId) => createEaRelationshipHandler(params, userId),
  classify_ea_element: (params) => classifyEaElementHandler(params),
  query_ontology_graph: (params) => queryOntologyGraphHandler(params),
  run_traversal_pattern: (params) => runTraversalPatternHandler(params),
  import_archimate: (params, userId) => importArchimateHandler(params, userId),
  export_archimate: (params, userId) => exportArchimateHandler(params, userId),
  describe_ea_view: (params) => describeEaViewHandler(params),
};

export const eaOntologyPack: ToolPack = {
  packId: "ea-ontology",
  definitions,
  handlers,
  grants: {
    create_ea_element: ["ea_graph_write"],
    create_ea_relationship: ["ea_graph_write"],
    classify_ea_element: ["ea_graph_write"],
    import_archimate: ["ea_graph_write"],
    query_ontology_graph: ["ea_graph_read"],
    run_traversal_pattern: ["ea_graph_read"],
    export_archimate: ["ea_graph_read"],
    describe_ea_view: ["ea_graph_read"],
  },
};
