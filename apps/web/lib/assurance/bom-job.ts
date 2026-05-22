import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@dpf/db";
import { generateCycloneDxBom } from "./cyclonedx-generator";
import { persistGeneratedBom } from "./bom-persistence";

type BomJobDb = {
  featureBuild: {
    findUnique(args: unknown): Promise<null | {
      buildId: string;
      title: string;
      threadId: string | null;
      createdById: string;
      digitalProductId: string | null;
    }>;
  };
  modelProfile?: {
    findMany(args: unknown): Promise<Array<{ providerId: string; modelId: string; modelStatus: string | null }>>;
  };
  toolExecution?: {
    create(args: unknown): Promise<{ id: string }>;
  };
  toolExecutionReceipt?: {
    create(args: unknown): Promise<{ id: string }>;
  };
  assuranceRun?: {
    create(args: unknown): Promise<{ id: string; runId: string }>;
  };
  buildActivity?: {
    create(args: unknown): Promise<unknown>;
  };
  bomComponent?: {
    upsert(args: unknown): Promise<{ id: string; componentKey: string }>;
  };
  bomDocument?: {
    upsert(args: unknown): Promise<{ id: string; documentId: string }>;
  };
  bomComponentOccurrence?: {
    createMany(args: unknown): Promise<{ count: number }>;
  };
};

export type GenerateAndPersistBuildBomResult =
  | { skipped: true; reason: string }
  | { skipped: false; documentId: string; componentCount: number; occurrenceCount: number; runId: string };

export interface GenerateAndPersistBuildBomInput {
  db: BomJobDb;
  buildId: string;
  requestedByUserId: string;
  projectRoot: string;
  now: Date;
  gitRef?: string;
  readTextFile?: (path: string) => Promise<string>;
}

async function defaultReadTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function requirePersistenceDb(db: BomJobDb) {
  if (!db.toolExecution || !db.toolExecutionReceipt || !db.assuranceRun || !db.bomComponent || !db.bomDocument || !db.bomComponentOccurrence) {
    throw new Error("BOM persistence requires tool execution, receipt, run, document, component, and occurrence delegates");
  }
  return db as BomJobDb & Required<Pick<BomJobDb, "toolExecution" | "toolExecutionReceipt" | "assuranceRun" | "bomComponent" | "bomDocument" | "bomComponentOccurrence">>;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function createRunId(buildId: string, toolExecutionId: string): string {
  const buildPart = buildId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const executionPart = toolExecutionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return `assurance_bom_${buildPart}_${executionPart}`;
}

export async function generateAndPersistBuildBom(input: GenerateAndPersistBuildBomInput): Promise<GenerateAndPersistBuildBomResult> {
  const build = await input.db.featureBuild.findUnique({
    where: { buildId: input.buildId },
    select: {
      buildId: true,
      title: true,
      threadId: true,
      createdById: true,
      digitalProductId: true,
    },
  });

  if (!build) return { skipped: true, reason: "build not found" };

  const db = requirePersistenceDb(input.db);
  const readTextFile = input.readTextFile ?? defaultReadTextFile;
  const [packageJson, lockText, modelProfiles] = await Promise.all([
    readTextFile(join(input.projectRoot, "apps/web/package.json")),
    readTextFile(join(input.projectRoot, "pnpm-lock.yaml")),
    input.db.modelProfile?.findMany({
      where: { modelStatus: "active" },
      select: { providerId: true, modelId: true, modelStatus: true },
    }) ?? Promise.resolve([]),
  ]);

  const generatedBom = generateCycloneDxBom({
    workspacePath: "apps/web",
    packageJson,
    lockText,
    generatedAt: input.now,
    gitRef: input.gitRef ?? process.env.GIT_COMMIT ?? "unknown",
    modelProfiles,
  });

  const toolExecution = await db.toolExecution.create({
    data: {
      threadId: build.threadId ?? build.buildId,
      agentId: "system:assurance-ledger",
      userId: input.requestedByUserId,
      toolName: "generate_cyclonedx_bom",
      parameters: {
        buildId: build.buildId,
        digitalProductId: build.digitalProductId,
        workspacePath: "apps/web",
      } satisfies Prisma.InputJsonValue,
      result: {
        documentDigest: generatedBom.documentDigest,
        componentCount: generatedBom.components.length,
      } satisfies Prisma.InputJsonValue,
      success: true,
      executionMode: "background",
      routeContext: "/build",
      durationMs: null,
      summary: `Generated CycloneDX BOM for ${build.title}.`,
    },
  });

  const receipt = await db.toolExecutionReceipt.create({
    data: {
      toolExecutionId: toolExecution.id,
      buildId: build.buildId,
      receiptKind: "assurance-bom",
      inputFingerprint: generatedBom.sourceDigest,
      outputDigest: { sha256: generatedBom.documentDigest } satisfies Prisma.InputJsonValue,
      executionStatus: "passed",
      expiresAt: addDays(input.now, 365),
    },
  });

  const assuranceRun = await db.assuranceRun.create({
    data: {
      runId: createRunId(build.buildId, toolExecution.id),
      scopeType: "build",
      scopeId: build.buildId,
      adapterKey: "cyclonedx-pnpm-lock",
      adapterVersion: "1.0.0",
      status: "passed",
      summary: {
        documentDigest: generatedBom.documentDigest,
        componentCount: generatedBom.components.length,
      } satisfies Prisma.InputJsonValue,
      startedAt: input.now,
      completedAt: input.now,
      buildId: build.buildId,
      digitalProductId: build.digitalProductId,
      toolExecutionId: toolExecution.id,
      toolExecutionReceiptId: receipt.id,
    },
  });

  const persisted = await persistGeneratedBom(db, {
    buildId: build.buildId,
    digitalProductId: build.digitalProductId,
    assuranceRunId: assuranceRun.id,
    generatedBom,
  });

  await input.db.buildActivity?.create({
    data: {
      buildId: build.buildId,
      tool: "assurance-bom",
      summary: `Generated shareable CycloneDX SBOM ${persisted.documentId} with ${persisted.componentCount} components.`,
    },
  });

  if (build.threadId) {
    const { agentEventBus } = await import("@/lib/agent-event-bus");
    agentEventBus.emit(build.threadId, {
      type: "evidence:update",
      buildId: build.buildId,
      field: "assuranceBom",
    });
  }

  return {
    skipped: false,
    documentId: persisted.documentId,
    componentCount: persisted.componentCount,
    occurrenceCount: persisted.occurrenceCount,
    runId: assuranceRun.runId,
  };
}
