"use server";

import { prisma } from "@dpf/db";
import { parseArchimateXml, generateArchimateXml } from "@/lib/ea/archimate-xml";

// ─── Import ───────────────────────────────────────────────────────────────────

type ImportInput = {
  fileContentBase64: string;
  fileName: string;
  userId: string;
  targetPortfolioId?: string;
  targetDigitalProductId?: string;
};

type ImportResult = {
  ok: boolean;
  error?: string;
  data?: {
    elementsCreated: number;
    relationshipsCreated: number;
    extensionTypesRestored: number;
    conformanceIssues: Array<{ elementName: string; issueType: string; severity: string; message: string }>;
  };
};

export async function importArchimateFile(input: ImportInput): Promise<ImportResult> {
  const { fileContentBase64, fileName: _fileName, userId, targetPortfolioId, targetDigitalProductId } = input;

  // 1MB base64 cap (~750KB raw XML)
  if (fileContentBase64.length > 1_400_000) {
    return { ok: false, error: "File exceeds 1MB limit. Split the model into smaller exports before importing." };
  }

  // 1. Resolve notation
  const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
  if (!notation) return { ok: false, error: "ArchiMate 4 notation not found in database. Run the seed first." };

  // 2. Parse XML
  let parsed;
  try {
    const xml = Buffer.from(fileContentBase64, "base64").toString("utf-8");
    parsed = parseArchimateXml(xml);
  } catch (e) {
    return { ok: false, error: `Failed to parse .archimate XML: ${String(e)}` };
  }

  // 3. Build slug → elementTypeId map (scoped to archimate4)
  const elementTypes = await prisma.eaElementType.findMany({
    where: { notationId: notation.id },
    select: { id: true, slug: true },
  });
  const etMap = new Map(elementTypes.map(et => [et.slug, et.id]));

  // 4. Create elements
  const createdElementIdMap = new Map<string, string>();
  const conformanceIssues: NonNullable<ImportResult["data"]>["conformanceIssues"] = [];
  let elementsCreated = 0;
  let extensionTypesRestored = 0;

  for (const el of parsed.elements) {
    const etId = etMap.get(el.slug) ?? etMap.get("object")!;

    const created = await prisma.eaElement.create({
      data: {
        elementTypeId: etId,
        name: el.name,
        lifecycleStage: "plan",
        lifecycleStatus: "draft",
        refinementLevel: "conceptual",
        createdById: userId,
        ...(targetPortfolioId ? { portfolioId: targetPortfolioId } : {}),
        ...(targetDigitalProductId ? { digitalProductId: targetDigitalProductId } : {}),
        properties: {
          archimateId: el.archimateId,
          archimateFolder: el.folder ?? null,
          ...(el.archimateRelType ? { archimateRelType: el.archimateRelType } : {}),
        },
      },
    });
    createdElementIdMap.set(el.archimateId, created.id);
    elementsCreated++;

    // Count extension types that were restored from dpf:elementType property
    if (!el.unknownArchimateType && etMap.has(el.slug) && el.slug !== "object") {
      const etRecord = elementTypes.find(e => e.slug === el.slug);
      if (etRecord) extensionTypesRestored++;
    }

    if (el.unknownArchimateType) {
      const issue = await prisma.eaConformanceIssue.create({
        data: {
          elementId: created.id,
          issueType: "unknown_archimate_type",
          severity: "warn",
          message: `Unrecognised ArchiMate type "${el.unknownArchimateType}". Imported as "object" (common domain).`,
          detailsJson: { originalType: el.unknownArchimateType },
        },
      });
      conformanceIssues.push({ elementName: el.name, issueType: issue.issueType, severity: issue.severity, message: issue.message });
    }
  }

  // 5. Resolve relationship types and create relationships
  const relTypes = await prisma.eaRelationshipType.findMany({
    where: { notationId: notation.id },
    select: { id: true, slug: true },
  });
  const rtMap = new Map(relTypes.map(rt => [rt.slug, rt.id]));

  let relationshipsCreated = 0;
  for (const rel of parsed.relationships) {
    const fromId = createdElementIdMap.get(rel.fromArchimateId);
    const toId = createdElementIdMap.get(rel.toArchimateId);
    const rtId = rtMap.get(rel.slug);
    if (!fromId || !toId || !rtId) continue;
    await prisma.eaRelationship.create({
      data: {
        fromElementId: fromId,
        toElementId: toId,
        relationshipTypeId: rtId,
        notationSlug: "archimate4",
        properties: rel.archimateRelType ? { archimateRelType: rel.archimateRelType } : {},
        createdById: userId,
      },
    });
    relationshipsCreated++;
  }

  return {
    ok: true,
    data: { elementsCreated, relationshipsCreated, extensionTypesRestored, conformanceIssues },
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

type ExportInput = {
  scopeType: "view" | "portfolio" | "digital_product";
  scopeRef: string;
  fileName?: string;
  userId: string;
};

type ExportResult = {
  ok: boolean;
  error?: string;
  data?: {
    fileContentBase64: string;
    fileName: string;
    elementCount: number;
    relationshipCount: number;
    extensionTypesMapped: Array<{ platformSlug: string; archimateExportSlug: string; count: number }>;
  };
};

export async function exportArchimateFile(input: ExportInput): Promise<ExportResult> {
  const { scopeType, scopeRef, fileName } = input;

  const whereClause: Record<string, unknown> | null =
    scopeType === "portfolio"       ? { portfolioId: scopeRef } :
    scopeType === "digital_product" ? { digitalProductId: scopeRef } :
    scopeType === "view"            ? { viewElements: { some: { viewId: scopeRef } } } :
    null;

  if (!whereClause) return { ok: false, error: `Unknown scopeType: ${scopeType}` };

  const elements = await prisma.eaElement.findMany({
    where: whereClause,
    include: { elementType: { select: { slug: true, isExtension: true, archimateExportSlug: true } } },
  });

  const elementIds = elements.map(e => e.id);
  const relationships = await prisma.eaRelationship.findMany({
    where: { fromElementId: { in: elementIds }, toElementId: { in: elementIds } },
    include: { relationshipType: { select: { slug: true } } },
  });

  const generateElements = elements.map(el => ({
    archimateId: ((el.properties as Record<string, unknown>)?.archimateId as string) ?? el.id,
    name: el.name,
    slug: el.elementType.slug,
    archimateExportSlug: el.elementType.archimateExportSlug,
    isExtension: el.elementType.isExtension,
    ontologyRole: el.ontologyRole,
  }));

  const generateRels = relationships.map(rel => ({
    archimateId: rel.id,
    fromArchimateId: ((elements.find(e => e.id === rel.fromElementId)?.properties as Record<string, unknown>)?.archimateId as string) ?? rel.fromElementId,
    toArchimateId: ((elements.find(e => e.id === rel.toElementId)?.properties as Record<string, unknown>)?.archimateId as string) ?? rel.toElementId,
    slug: rel.relationshipType.slug,
  }));

  const xml = generateArchimateXml({ modelName: `DPF Export - ${scopeRef}`, elements: generateElements, relationships: generateRels });
  const fileContentBase64 = Buffer.from(xml, "utf-8").toString("base64");

  // Build extension type summary
  const extMap = new Map<string, { slug: string; exportSlug: string; count: number }>();
  for (const el of elements.filter(e => e.elementType.isExtension)) {
    const key = el.elementType.slug;
    const existing = extMap.get(key);
    if (existing) existing.count++;
    else extMap.set(key, { slug: key, exportSlug: el.elementType.archimateExportSlug ?? "unknown", count: 1 });
  }

  const outFileName = fileName ?? `dpf-${scopeType}-${scopeRef}-${new Date().toISOString().slice(0, 10)}.archimate`;

  return {
    ok: true,
    data: {
      fileContentBase64,
      fileName: outFileName,
      elementCount: elements.length,
      relationshipCount: relationships.length,
      extensionTypesMapped: [...extMap.values()].map(e => ({ platformSlug: e.slug, archimateExportSlug: e.exportSlug, count: e.count })),
    },
  };
}
