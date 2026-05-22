import { describe, expect, it, vi } from "vitest";
import { generateAndPersistBuildBom } from "./bom-job";

const packageJson = JSON.stringify({ name: "web", version: "0.1.0" });
const lockText = `
lockfileVersion: '9.0'
importers:
  apps/web:
    dependencies:
      next:
        specifier: ^16.2.6
        version: 16.2.6(react@19.2.6)
`;

describe("generateAndPersistBuildBom", () => {
  it("returns skipped when the build does not exist", async () => {
    const db = {
      featureBuild: { findUnique: vi.fn(async () => null) },
    };

    await expect(generateAndPersistBuildBom({
      db,
      buildId: "missing",
      requestedByUserId: "user-1",
      projectRoot: "D:/DPF",
      now: new Date("2026-05-22T00:00:00.000Z"),
    })).resolves.toEqual({ skipped: true, reason: "build not found" });
  });

  it("creates run, receipt, persisted BOM, and build activity for an existing build", async () => {
    const db = {
      featureBuild: {
        findUnique: vi.fn(async () => ({
          buildId: "BUILD-1",
          title: "Assurance build",
          threadId: null,
          createdById: "creator-1",
          digitalProductId: "product-1",
        })),
      },
      modelProfile: {
        findMany: vi.fn(async () => [{ providerId: "openai", modelId: "gpt-5.4", modelStatus: "active" }]),
      },
      toolExecution: {
        create: vi.fn(async () => ({ id: "tool-1" })),
      },
      toolExecutionReceipt: {
        create: vi.fn(async () => ({ id: "receipt-1" })),
      },
      assuranceRun: {
        create: vi.fn(async () => ({ id: "run-db-1", runId: "run-1" })),
      },
      bomComponent: {
        upsert: vi.fn(async ({ where }: { where: { componentKey: string } }) => ({
          id: `db-${where.componentKey}`,
          componentKey: where.componentKey,
        })),
      },
      bomDocument: {
        upsert: vi.fn(async ({ create }: { create: { documentId: string } }) => ({
          id: "document-db-1",
          documentId: create.documentId,
        })),
      },
      bomComponentOccurrence: {
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      },
      buildActivity: {
        create: vi.fn(async () => ({})),
      },
    };

    const queueScan = vi.fn(async () => ({ ids: ["evt-scan-1"] }));
    const result = await generateAndPersistBuildBom({
      db,
      buildId: "BUILD-1",
      requestedByUserId: "user-1",
      projectRoot: "D:/DPF",
      now: new Date("2026-05-22T00:00:00.000Z"),
      gitRef: "abc123",
      readTextFile: vi.fn(async (path: string) => path.endsWith("package.json") ? packageJson : lockText),
      queueScan,
    });

    expect(result).toMatchObject({ skipped: false, componentCount: 2, occurrenceCount: 2 });
    expect(queueScan).toHaveBeenCalledWith({ buildId: "BUILD-1", requestedByUserId: "user-1" });
    expect(db.toolExecution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        toolName: "generate_cyclonedx_bom",
        success: true,
        userId: "user-1",
      }),
    }));
    expect(db.toolExecutionReceipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        toolExecutionId: "tool-1",
        receiptKind: "assurance-bom",
      }),
    }));
    expect(db.assuranceRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        runId: "assurance_bom_BUILD-1_tool-1",
        status: "passed",
        toolExecutionId: "tool-1",
        toolExecutionReceiptId: "receipt-1",
      }),
    }));
    expect(db.bomDocument.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        buildId: "BUILD-1",
        digitalProductId: "product-1",
        assuranceRunId: "run-db-1",
      }),
    }));
    expect(db.buildActivity.create).toHaveBeenCalled();
  });

  it("still returns success when the auto-scan trigger fails (best-effort)", async () => {
    const db = {
      featureBuild: {
        findUnique: vi.fn(async () => ({
          buildId: "BUILD-2",
          title: "Trigger-failure build",
          threadId: null,
          createdById: "creator-1",
          digitalProductId: null,
        })),
      },
      modelProfile: { findMany: vi.fn(async () => []) },
      toolExecution: { create: vi.fn(async () => ({ id: "tool-2" })) },
      toolExecutionReceipt: { create: vi.fn(async () => ({ id: "receipt-2" })) },
      assuranceRun: { create: vi.fn(async () => ({ id: "run-db-2", runId: "run-2" })) },
      bomComponent: {
        upsert: vi.fn(async ({ where }: { where: { componentKey: string } }) => ({
          id: `db-${where.componentKey}`,
          componentKey: where.componentKey,
        })),
      },
      bomDocument: {
        upsert: vi.fn(async ({ create }: { create: { documentId: string } }) => ({
          id: "document-db-2",
          documentId: create.documentId,
        })),
      },
      bomComponentOccurrence: {
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      },
      buildActivity: { create: vi.fn() },
    };

    const queueScan = vi.fn(async () => {
      throw new Error("queue offline");
    });

    const result = await generateAndPersistBuildBom({
      db,
      buildId: "BUILD-2",
      requestedByUserId: "user-1",
      projectRoot: "D:/DPF",
      now: new Date("2026-05-22T00:00:00.000Z"),
      readTextFile: vi.fn(async (path: string) => path.endsWith("package.json") ? packageJson : lockText),
      queueScan,
    });

    expect(result.skipped).toBe(false);
    expect(queueScan).toHaveBeenCalledOnce();
  });
});
