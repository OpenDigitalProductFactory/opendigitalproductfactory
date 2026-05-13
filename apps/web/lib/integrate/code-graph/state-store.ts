import { prisma } from "@dpf/db";

export type CodeGraphIndexStateRecord = {
  graphKey: string;
  indexStatus?: string | null;
  indexedFileCount?: number | null;
  lastIndexedHeadSha: string | null;
  lastIndexedAt?: Date | null;
};

type CodeGraphPrisma = {
  codeGraphIndexState: {
    findUnique(args: { where: { graphKey: string } }): Promise<CodeGraphIndexStateRecord | null>;
    upsert(args: Record<string, unknown>): Promise<unknown>;
  };
  codeGraphFileHash: {
    upsert(args: Record<string, unknown>): Promise<unknown>;
    deleteMany(args: Record<string, unknown>): Promise<unknown>;
    count(args: { where: { graphKey: string } }): Promise<number>;
  };
};

const codeGraphPrisma = prisma as unknown as CodeGraphPrisma;

export async function findCodeGraphIndexState(graphKey: string): Promise<CodeGraphIndexStateRecord | null> {
  return codeGraphPrisma.codeGraphIndexState.findUnique({ where: { graphKey } });
}

export async function markCodeGraphIndexing(
  graphKey: string,
  input: {
    workspaceRoot: string;
    headSha: string | null;
    branch: string | null;
    previousHeadSha: string | null;
    workspaceDirty: boolean;
    observedAt: Date;
  },
): Promise<void> {
  await codeGraphPrisma.codeGraphIndexState.upsert({
    where: { graphKey },
    create: {
      graphKey,
      graphVersion: 1,
      workspaceRoot: input.workspaceRoot,
      indexStatus: "updating",
      lastIndexedBranch: input.branch,
      lastIndexedHeadSha: input.previousHeadSha,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      lastError: null,
    },
    update: {
      workspaceRoot: input.workspaceRoot,
      indexStatus: "updating",
      lastIndexedBranch: input.branch,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      lastError: null,
    },
  });
}

export async function markCodeGraphReady(
  graphKey: string,
  input: {
    workspaceRoot: string;
    headSha: string | null;
    branch: string | null;
    workspaceDirty: boolean;
    observedAt: Date;
    indexedFileCount: number;
  },
): Promise<void> {
  await codeGraphPrisma.codeGraphIndexState.upsert({
    where: { graphKey },
    create: {
      graphKey,
      graphVersion: 1,
      workspaceRoot: input.workspaceRoot,
      indexStatus: "ready",
      lastIndexedAt: input.observedAt,
      lastIndexedBranch: input.branch,
      lastIndexedHeadSha: input.headSha,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      indexedFileCount: input.indexedFileCount,
      lastError: null,
    },
    update: {
      workspaceRoot: input.workspaceRoot,
      indexStatus: "ready",
      lastIndexedAt: input.observedAt,
      lastIndexedBranch: input.branch,
      lastIndexedHeadSha: input.headSha,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      indexedFileCount: input.indexedFileCount,
      lastError: null,
    },
  });
}

export async function markCodeGraphFailed(
  graphKey: string,
  input: {
    workspaceRoot: string;
    previousHeadSha: string | null;
    branch: string | null;
    workspaceDirty: boolean;
    observedAt: Date;
    error: unknown;
  },
): Promise<void> {
  const lastError = input.error instanceof Error ? input.error.message : "Unknown reconcile failure";
  await codeGraphPrisma.codeGraphIndexState.upsert({
    where: { graphKey },
    create: {
      graphKey,
      graphVersion: 1,
      workspaceRoot: input.workspaceRoot,
      indexStatus: "failed",
      lastIndexedBranch: input.branch,
      lastIndexedHeadSha: input.previousHeadSha,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      lastError,
    },
    update: {
      workspaceRoot: input.workspaceRoot,
      indexStatus: "failed",
      lastIndexedBranch: input.branch,
      workspaceDirty: input.workspaceDirty,
      workspaceDirtyObservedAt: input.observedAt,
      lastError,
    },
  });
}

export async function upsertCodeGraphFileHash(input: {
  graphKey: string;
  filePath: string;
  checksum: string;
  indexedAt: Date;
}): Promise<void> {
  await codeGraphPrisma.codeGraphFileHash.upsert({
    where: { graphKey_filePath: { graphKey: input.graphKey, filePath: input.filePath } },
    create: {
      graphKey: input.graphKey,
      filePath: input.filePath,
      checksum: input.checksum,
      authority: "git",
      lastIndexedAt: input.indexedAt,
    },
    update: {
      checksum: input.checksum,
      authority: "git",
      lastIndexedAt: input.indexedAt,
    },
  });
}

export async function deleteCodeGraphFileHash(graphKey: string, filePath: string): Promise<void> {
  await codeGraphPrisma.codeGraphFileHash.deleteMany({ where: { graphKey, filePath } });
}

export async function countCodeGraphFileHashes(graphKey: string): Promise<number> {
  return codeGraphPrisma.codeGraphFileHash.count({ where: { graphKey } });
}
