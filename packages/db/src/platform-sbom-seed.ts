import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { upsertIdentityForComponent } from "./sbom-catalog-bridge";
import { createBomComponentKey } from "./bom-component-key";

const MAX_PLATFORM_COMPONENTS = 50_000;
const OCCURRENCE_BATCH_SIZE = 500;

export type PlatformCycloneDxComponent = {
  "bom-ref"?: string;
  type?: string;
  name?: string;
  version?: string;
  purl?: string;
  supplier?: { name?: string };
  properties?: Array<{ name?: string; value?: string }>;
};

export type PlatformCycloneDxDocument = {
  bomFormat: "CycloneDX";
  specVersion: string;
  serialNumber?: string;
  version: number;
  metadata: Record<string, unknown>;
  components: PlatformCycloneDxComponent[];
  dependencies: Array<Record<string, unknown>>;
};

type PlatformComponentType = "library" | "framework" | "application" | "container" | "model";

export type NormalizedPlatformComponent = {
  componentKey: string;
  componentType: PlatformComponentType;
  name: string;
  version: string | null;
  packageUrl: string | null;
  supplierName: string | null;
  licenseExpression: string | null;
  ecosystem: string | null;
  scope: string;
  metadata: Record<string, unknown>;
};

export type NormalizedPlatformOccurrence = {
  occurrenceKey: string;
  componentKey: string;
  workspaceName: string;
  workspacePath: string;
  dependencyKind: string;
  direct: boolean;
  evidence: Record<string, unknown>;
};

export type NormalizedPlatformSbom = {
  documentId: string;
  sourceDigest: string;
  documentDigest: string;
  components: NormalizedPlatformComponent[];
  occurrences: NormalizedPlatformOccurrence[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type PlatformSbomGenerator = (input: {
  root: string;
  generatedAt: Date;
  gitRef: string;
}) => Promise<{ cyclonedx: PlatformCycloneDxDocument }> | { cyclonedx: PlatformCycloneDxDocument };

async function generateWithExistingPlatformScript(input: {
  root: string;
  generatedAt: Date;
  gitRef: string;
}): Promise<{ cyclonedx: PlatformCycloneDxDocument }> {
  const moduleUrl = pathToFileURL(join(input.root, "scripts", "sbom", "generate-platform-sbom.mjs")).href;
  const generatorModule = await import(moduleUrl) as {
    generatePlatformSbom(args: { root: string; generatedAt: Date; gitRef: string }): {
      cyclonedx: PlatformCycloneDxDocument;
    };
  };
  return generatorModule.generatePlatformSbom(input);
}

export async function loadPlatformSbomFromRepository(input: {
  repositoryRoot: string;
  generatedAt: Date;
  gitRef: string;
  readFile?: (path: string) => Promise<string>;
  generate?: PlatformSbomGenerator;
}): Promise<{ cyclonedx: PlatformCycloneDxDocument; sourceDigest: string }> {
  const lockPath = join(input.repositoryRoot, "pnpm-lock.yaml");
  const lockText = await (input.readFile ?? ((path) => readFile(path, "utf8")))(lockPath);
  const generated = await (input.generate ?? generateWithExistingPlatformScript)({
    root: input.repositoryRoot,
    generatedAt: input.generatedAt,
    gitRef: input.gitRef,
  });
  return { cyclonedx: generated.cyclonedx, sourceDigest: sha256(lockText.replace(/\r\n/g, "\n")) };
}

function componentType(value: string | undefined): PlatformComponentType {
  if (value === "framework" || value === "application" || value === "container" || value === "library") return value;
  if (value === "machine-learning-model" || value === "model") return "model";
  return "library";
}

function ecosystem(component: PlatformCycloneDxComponent): string {
  if (component.purl?.startsWith("pkg:")) {
    return component.purl.slice(4).split("/")[0] || "unknown";
  }
  return component.type === "container" ? "container" : "unknown";
}

export function normalizePlatformCycloneDx(
  cyclonedx: PlatformCycloneDxDocument,
  sourceDigest: string,
): NormalizedPlatformSbom {
  if (cyclonedx.bomFormat !== "CycloneDX") throw new Error("Platform SBOM must use CycloneDX");
  if (cyclonedx.components.length > MAX_PLATFORM_COMPONENTS) {
    throw new Error(`Platform SBOM exceeds the ${MAX_PLATFORM_COMPONENTS}-component ingestion ceiling`);
  }

  const components = cyclonedx.components.map((source, index) => {
    const name = source.name?.trim();
    if (!name) throw new Error(`Platform SBOM component ${index + 1} has no name`);
    const normalized: NormalizedPlatformComponent = {
      componentKey: "",
      componentType: componentType(source.type),
      name,
      version: source.version ?? null,
      packageUrl: source.purl ?? null,
      supplierName: source.supplier?.name ?? null,
      licenseExpression: null,
      ecosystem: ecosystem(source),
      scope: "platform-runtime",
      metadata: {
        bomRef: source["bom-ref"] ?? null,
        properties: source.properties ?? [],
      },
    };
    normalized.componentKey = createBomComponentKey(normalized);
    return normalized;
  });
  const documentId = `bom_platform_${sourceDigest.slice(0, 24)}`;
  const occurrences = components.map((component) => ({
    occurrenceKey: sha256(`${documentId}::${component.componentKey}`).slice(0, 24),
    componentKey: component.componentKey,
    workspaceName: "dpf-platform",
    workspacePath: ".",
    dependencyKind: "platform-composition",
    direct: false,
    evidence: { source: "pnpm-lock.yaml", sourceDigest },
  }));

  return {
    documentId,
    sourceDigest,
    documentDigest: sha256(JSON.stringify(cyclonedx)),
    components,
    occurrences,
  };
}

type PlatformSbomTx = {
  digitalProduct: { findUnique(args: unknown): Promise<{ id: string } | null> };
  bomComponent: {
    upsert(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
  catalogIdentity: { upsert(args: unknown): Promise<{ id: string }> };
  bomDocument: {
    updateMany(args: unknown): Promise<{ count: number }>;
    upsert(args: unknown): Promise<{ id: string; documentId: string }>;
  };
  bomComponentOccurrence: {
    deleteMany(args: unknown): Promise<{ count: number }>;
    createMany(args: unknown): Promise<{ count: number }>;
  };
};

export type PlatformSbomClient = {
  $transaction<T>(work: (tx: PlatformSbomTx) => Promise<T>): Promise<T>;
};

function documentTimestamp(metadata: Record<string, unknown>): Date {
  const value = metadata.timestamp;
  if (typeof value !== "string") return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
}

export async function persistPlatformSbom(
  db: PlatformSbomClient,
  input: { cyclonedx: PlatformCycloneDxDocument; sourceDigest: string },
): Promise<{
  documentId: string;
  componentCount: number;
  occurrenceCount: number;
  supersededDocumentCount: number;
}> {
  const normalized = normalizePlatformCycloneDx(input.cyclonedx, input.sourceDigest);

  return db.$transaction(async (tx) => {
    const product = await tx.digitalProduct.findUnique({
      where: { productId: "dpf-portal" },
      select: { id: true },
    });
    if (!product) throw new Error("Digital product dpf-portal must exist before platform SBOM ingestion");

    const componentIds = new Map<string, string>();
    for (const component of normalized.components) {
      const row = await tx.bomComponent.upsert({
        where: { componentKey: component.componentKey },
        create: component,
        update: { ...component, lastSeenAt: new Date() },
        select: { id: true },
      });
      componentIds.set(component.componentKey, row.id);
      await upsertIdentityForComponent(tx, { id: row.id, ...component });
    }

    const superseded = await tx.bomDocument.updateMany({
      where: {
        digitalProductId: product.id,
        sourceKind: "platform-pnpm-lock",
        status: "current",
        documentId: { not: normalized.documentId },
      },
      data: { status: "superseded" },
    });
    const document = await tx.bomDocument.upsert({
      where: { documentId: normalized.documentId },
      create: {
        documentId: normalized.documentId,
        format: "cyclonedx-json",
        formatVersion: input.cyclonedx.specVersion,
        serialNumber: input.cyclonedx.serialNumber ?? null,
        version: input.cyclonedx.version,
        digest: normalized.documentDigest,
        sourceKind: "platform-pnpm-lock",
        sourceDigest: normalized.sourceDigest,
        componentCount: normalized.components.length,
        raw: input.cyclonedx,
        status: "current",
        generatedAt: documentTimestamp(input.cyclonedx.metadata),
        digitalProductId: product.id,
      },
      update: {
        formatVersion: input.cyclonedx.specVersion,
        serialNumber: input.cyclonedx.serialNumber ?? null,
        version: input.cyclonedx.version,
        digest: normalized.documentDigest,
        sourceDigest: normalized.sourceDigest,
        componentCount: normalized.components.length,
        raw: input.cyclonedx,
        status: "current",
        generatedAt: documentTimestamp(input.cyclonedx.metadata),
        digitalProductId: product.id,
      },
      select: { id: true, documentId: true },
    });

    await tx.bomComponentOccurrence.deleteMany({ where: { bomDocumentId: document.id } });
    const rows = normalized.occurrences.map(({ componentKey, ...occurrence }) => {
      const componentId = componentIds.get(componentKey);
      if (!componentId) throw new Error(`Platform SBOM component ${componentKey} was not persisted`);
      return {
        ...occurrence,
        bomDocumentId: document.id,
        componentId,
      };
    });
    let occurrenceCount = 0;
    for (let start = 0; start < rows.length; start += OCCURRENCE_BATCH_SIZE) {
      const batch = rows.slice(start, start + OCCURRENCE_BATCH_SIZE);
      occurrenceCount += (await tx.bomComponentOccurrence.createMany({ data: batch })).count;
    }

    return {
      documentId: document.documentId,
      componentCount: normalized.components.length,
      occurrenceCount,
      supersededDocumentCount: superseded.count,
    };
  });
}
