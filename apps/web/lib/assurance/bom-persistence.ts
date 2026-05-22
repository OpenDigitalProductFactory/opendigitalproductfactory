import type { Prisma } from "@dpf/db";
import type { GeneratedBom, NormalizedBomComponent } from "./bom-types";

type BomPersistenceDb = {
  bomComponent: {
    upsert(args: unknown): Promise<{ id: string; componentKey: string }>;
  };
  bomDocument: {
    create(args: unknown): Promise<{ id: string; documentId: string }>;
  };
  bomComponentOccurrence: {
    createMany(args: unknown): Promise<{ count: number }>;
  };
};

function componentCreateData(component: NormalizedBomComponent) {
  return {
    componentKey: component.componentKey,
    componentType: component.componentType,
    name: component.name,
    version: component.version,
    packageUrl: component.packageUrl,
    supplierName: component.supplierName,
    licenseExpression: component.licenseExpression,
    ecosystem: component.ecosystem,
    scope: component.scope,
    metadata: component.metadata as Prisma.InputJsonValue,
  };
}

export async function persistGeneratedBom(
  db: BomPersistenceDb,
  input: {
    buildId: string | null;
    digitalProductId: string | null;
    assuranceRunId: string | null;
    artifactRevisionId?: string | null;
    generatedBom: GeneratedBom;
  },
): Promise<{ documentDbId: string; documentId: string; componentCount: number; occurrenceCount: number }> {
  const componentRows = new Map<string, { id: string; componentKey: string }>();

  for (const component of input.generatedBom.components) {
    const data = componentCreateData(component);
    const row = await db.bomComponent.upsert({
      where: { componentKey: component.componentKey },
      create: data,
      update: {
        ...data,
        lastSeenAt: new Date(),
      },
    });
    componentRows.set(component.componentKey, row);
  }

  const documentId = `bom_${input.generatedBom.documentDigest.slice(0, 24)}`;
  const document = await db.bomDocument.create({
    data: {
      documentId,
      format: "cyclonedx-json",
      formatVersion: input.generatedBom.cyclonedx.specVersion,
      serialNumber: input.generatedBom.cyclonedx.serialNumber,
      version: input.generatedBom.cyclonedx.version,
      digest: input.generatedBom.documentDigest,
      sourceKind: "pnpm-lock",
      sourceDigest: input.generatedBom.sourceDigest,
      componentCount: input.generatedBom.components.length,
      raw: input.generatedBom.cyclonedx as unknown as Prisma.InputJsonValue,
      buildId: input.buildId,
      digitalProductId: input.digitalProductId,
      assuranceRunId: input.assuranceRunId,
      artifactRevisionId: input.artifactRevisionId ?? null,
    },
  });

  const occurrenceRows = input.generatedBom.occurrences.flatMap((occurrence) => {
    const component = componentRows.get(occurrence.componentKey);
    if (!component) return [];
    return [{
      occurrenceKey: occurrence.occurrenceKey,
      bomDocumentId: document.id,
      componentId: component.id,
      workspaceName: occurrence.workspaceName,
      workspacePath: occurrence.workspacePath,
      dependencyKind: occurrence.dependencyKind,
      direct: occurrence.direct,
      evidence: occurrence.evidence as Prisma.InputJsonValue,
    }];
  });

  const createdOccurrences = await db.bomComponentOccurrence.createMany({
    data: occurrenceRows,
    skipDuplicates: true,
  });

  return {
    documentDbId: document.id,
    documentId: document.documentId,
    componentCount: input.generatedBom.components.length,
    occurrenceCount: createdOccurrences.count,
  };
}
