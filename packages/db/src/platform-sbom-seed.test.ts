import { describe, expect, it, vi } from "vitest";

import {
  loadPlatformSbomFromRepository,
  normalizePlatformCycloneDx,
  persistPlatformSbom,
  type PlatformCycloneDxDocument,
  type PlatformSbomClient,
} from "./platform-sbom-seed";
import { createBomComponentKey } from "./bom-component-key";

function documentWith(componentCount = 2): PlatformCycloneDxDocument {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: "urn:uuid:generated-value",
    version: 1,
    metadata: {
      timestamp: "2026-08-27T00:00:00.000Z",
      component: { type: "application", name: "dpf-platform", version: "0.1.0" },
    },
    components: Array.from({ length: componentCount }, (_, index) => ({
      "bom-ref": `pkg:npm/package-${index}@1.0.${index}`,
      type: index === 1 ? "container" : "library",
      name: `package-${index}`,
      version: `1.0.${index}`,
      purl: index === 1 ? undefined : `pkg:npm/package-${index}@1.0.${index}`,
    })),
    dependencies: [],
  };
}

describe("normalizePlatformCycloneDx", () => {
  it("creates deterministic canonical component and occurrence identities from the source digest", () => {
    const input = documentWith();
    const first = normalizePlatformCycloneDx(input, "lock-digest-123");
    const second = normalizePlatformCycloneDx(
      { ...input, serialNumber: "urn:uuid:different", metadata: { ...input.metadata, timestamp: "2026-08-28T00:00:00.000Z" } },
      "lock-digest-123",
    );

    expect(first.documentId).toBe("bom_platform_lock-digest-123");
    expect(first.documentId).toBe(second.documentId);
    expect(first.components.map((row) => row.componentKey)).toEqual(second.components.map((row) => row.componentKey));
    expect(first.components[0]?.componentKey).toBe(createBomComponentKey({
      componentType: "library",
      ecosystem: "npm",
      name: "package-0",
      version: "1.0.0",
      packageUrl: "pkg:npm/package-0@1.0.0",
    }));
    expect(first.occurrences.map((row) => row.occurrenceKey)).toEqual(second.occurrences.map((row) => row.occurrenceKey));
    expect(first.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "package-0", componentType: "library", ecosystem: "npm" }),
      expect.objectContaining({ name: "package-1", componentType: "container", ecosystem: "container" }),
    ]));
  });
});

describe("loadPlatformSbomFromRepository", () => {
  it("uses the existing platform generator and derives source identity from pnpm-lock.yaml", async () => {
    const generatedAt = new Date("2026-08-27T00:00:00.000Z");
    const generate = vi.fn(async () => ({ cyclonedx: documentWith() }));
    const loaded = await loadPlatformSbomFromRepository({
      repositoryRoot: "D:/repo",
      generatedAt,
      gitRef: "abc123",
      readFile: async (path) => {
        expect(path.replaceAll("\\", "/")).toBe("D:/repo/pnpm-lock.yaml");
        return "lockfileVersion: '9.0'\n";
      },
      generate,
    });

    expect(generate).toHaveBeenCalledWith({ root: "D:/repo", generatedAt, gitRef: "abc123" });
    expect(loaded.cyclonedx).toEqual(documentWith());
    expect(loaded.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("persistPlatformSbom", () => {
  it("replaces the deterministic document occurrences, supersedes older platform documents, and links catalog identities", async () => {
    const calls = {
      supersede: [] as unknown[],
      deleteOccurrences: [] as unknown[],
      createOccurrences: [] as unknown[],
      catalog: [] as unknown[],
      links: [] as unknown[],
    };
    let componentId = 0;
    const tx = {
      digitalProduct: { findUnique: vi.fn(async () => ({ id: "product-row" })) },
      bomComponent: {
        upsert: vi.fn(async () => ({ id: `component-${++componentId}` })),
        update: vi.fn(async (args: unknown) => (calls.links.push(args), {})),
      },
      catalogIdentity: {
        upsert: vi.fn(async (args: unknown) => (calls.catalog.push(args), { id: `catalog-${calls.catalog.length + 1}` })),
      },
      bomDocument: {
        updateMany: vi.fn(async (args: unknown) => (calls.supersede.push(args), { count: 1 })),
        upsert: vi.fn(async () => ({ id: "document-row", documentId: "bom_platform_lock-digest-123" })),
      },
      bomComponentOccurrence: {
        deleteMany: vi.fn(async (args: unknown) => (calls.deleteOccurrences.push(args), { count: 2 })),
        createMany: vi.fn(async (args: unknown) => {
          calls.createOccurrences.push(args);
          return { count: (args as { data: unknown[] }).data.length };
        }),
      },
    };
    const db = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) } as PlatformSbomClient;

    const result = await persistPlatformSbom(db, {
      cyclonedx: documentWith(),
      sourceDigest: "lock-digest-123",
    });

    expect(result).toEqual({
      documentId: "bom_platform_lock-digest-123",
      componentCount: 2,
      occurrenceCount: 2,
      supersededDocumentCount: 1,
    });
    expect(tx.digitalProduct.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { productId: "dpf-portal" } }));
    expect(calls.supersede).toEqual([expect.objectContaining({
      where: expect.objectContaining({ digitalProductId: "product-row", sourceKind: "platform-pnpm-lock", status: "current" }),
      data: { status: "superseded" },
    })]);
    expect(calls.deleteOccurrences).toEqual([{ where: { bomDocumentId: "document-row" } }]);
    expect(calls.createOccurrences).toHaveLength(1);
    const persistedOccurrences = (calls.createOccurrences[0] as { data: Array<Record<string, unknown>> }).data;
    expect(persistedOccurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        occurrenceKey: expect.any(String),
        bomDocumentId: "document-row",
        componentId: "component-1",
      }),
    ]));
    expect(persistedOccurrences.every((row) => !("componentKey" in row))).toBe(true);
    expect(calls.catalog).toHaveLength(2);
    expect(calls.links).toHaveLength(2);
  });

  it("writes occurrences in bounded 500-row batches without truncating the composition", async () => {
    let componentId = 0;
    const batchSizes: number[] = [];
    const tx = {
      digitalProduct: { findUnique: vi.fn(async () => ({ id: "product-row" })) },
      bomComponent: {
        upsert: vi.fn(async () => ({ id: `component-${++componentId}` })),
        update: vi.fn(async () => ({})),
      },
      catalogIdentity: { upsert: vi.fn(async () => ({ id: `catalog-${componentId}` })) },
      bomDocument: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        upsert: vi.fn(async () => ({ id: "document-row", documentId: "bom_platform_scale" })),
      },
      bomComponentOccurrence: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async (args: unknown) => {
          const size = (args as { data: unknown[] }).data.length;
          batchSizes.push(size);
          return { count: size };
        }),
      },
    };
    const db = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) } as PlatformSbomClient;

    const result = await persistPlatformSbom(db, { cyclonedx: documentWith(501), sourceDigest: "scale" });

    expect(batchSizes).toEqual([500, 1]);
    expect(result.occurrenceCount).toBe(501);
  });
});
