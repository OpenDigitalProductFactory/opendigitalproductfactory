import { prisma } from "@dpf/db";
import { runCypher } from "@dpf/db";
import { computeNextRunAt } from "@/lib/ai-provider-types";
import { inngest } from "@/lib/queue/inngest-client";
import { lazyCrypto, lazyExec, lazyFsPromises, lazyPath } from "@/lib/shared/lazy-node";

export const CODE_GRAPH_JOB_ID = "code-graph-reconcile";
export const CODE_GRAPH_JOB_NAME = "Code Graph Reconcile";
export const CODE_GRAPH_JOB_SCHEDULE = "every-15m";
export const CODE_GRAPH_EVENT_NAME = "ops/code-graph.reconcile";
export const CODE_GRAPH_GRAPH_KEY = "source-code";

export type CodeGraphRefreshMode = "noop" | "incremental" | "full";

export type CodeGraphRefreshPlan = {
  mode: CodeGraphRefreshMode;
  changedFiles: string[];
};

export type QueueCodeGraphReconcileInput = {
  reason: "git-commit" | "git-backup" | "scheduled" | "manual";
  headSha?: string | null;
  branch?: string | null;
  graphKey?: string;
};

export type ReconcileCodeGraphInput = {
  reason: QueueCodeGraphReconcileInput["reason"];
  graphKey?: string;
  forceFull?: boolean;
};

export type ReconcileCodeGraphResult = {
  mode: CodeGraphRefreshMode;
  graphKey: string;
  headSha: string | null;
  branch: string | null;
  workspaceDirty: boolean;
  changedFiles: string[];
};

type CodeGraphIndexStateRecord = {
  graphKey: string;
  lastIndexedHeadSha: string | null;
};

type CodeGraphPrisma = {
  codeGraphIndexState: {
    findUnique(args: { where: { graphKey: string } }): Promise<CodeGraphIndexStateRecord | null>;
    upsert(args: Record<string, unknown>): Promise<unknown>;
    update(args: Record<string, unknown>): Promise<unknown>;
  };
  codeGraphFileHash: {
    upsert(args: Record<string, unknown>): Promise<unknown>;
    deleteMany(args: Record<string, unknown>): Promise<unknown>;
    count(args: { where: { graphKey: string } }): Promise<number>;
  };
};

const codeGraphPrisma = prisma as unknown as CodeGraphPrisma;
const CODE_GRAPH_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".prisma",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const exec = lazyExec();

function getGitRoot(): string {
  const { resolve } = lazyPath();
  return process.env.PROJECT_ROOT
    ? resolve(process.env.PROJECT_ROOT)
    : resolve(process.cwd(), "..", "..");
}

function normalizeGitOutput(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function shouldIndexCodeGraphPath(filePath: string): boolean {
  return CODE_GRAPH_FILE_EXTENSIONS.has(lazyPath().extname(filePath).toLowerCase());
}

function buildCodeFileKey(graphKey: string, filePath: string): string {
  return `${graphKey}:${filePath}`;
}

async function getCurrentHeadSha(gitRoot: string): Promise<string | null> {
  const { stdout } = await exec("git rev-parse HEAD", { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim() || null;
}

async function getCurrentBranch(gitRoot: string): Promise<string | null> {
  const { stdout } = await exec("git rev-parse --abbrev-ref HEAD", { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim() || null;
}

async function isWorkspaceDirty(gitRoot: string): Promise<boolean> {
  const { stdout } = await exec("git status --porcelain", { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim().length > 0;
}

async function listTrackedFiles(gitRoot: string): Promise<string[]> {
  const { stdout } = await exec("git ls-files", { cwd: gitRoot, timeout: 30_000, maxBuffer: 1024 * 1024 * 4 });
  return normalizeGitOutput(stdout).filter(shouldIndexCodeGraphPath);
}

async function getChangedFiles(gitRoot: string, fromSha: string, toSha: string): Promise<string[]> {
  const { stdout } = await exec(`git diff --name-only ${fromSha}..${toSha}`, {
    cwd: gitRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return normalizeGitOutput(stdout).filter(shouldIndexCodeGraphPath);
}

async function clearCodeGraph(graphKey: string): Promise<void> {
  await runCypher(
    "MATCH (n:CodeFile {graphKey: $graphKey}) DETACH DELETE n",
    { graphKey },
  );
}

async function ensureCodeGraphNeo4jSchema(): Promise<void> {
  const statements = [
    "CREATE CONSTRAINT cf_codeFileKey IF NOT EXISTS FOR (n:CodeFile) REQUIRE n.codeFileKey IS UNIQUE",
    "CREATE INDEX cf_graphKey IF NOT EXISTS FOR (n:CodeFile) ON (n.graphKey)",
    "CREATE INDEX cf_path IF NOT EXISTS FOR (n:CodeFile) ON (n.path)",
  ];

  for (const statement of statements) {
    try {
      await runCypher(statement);
    } catch {
      // Best-effort. Reconcile can still proceed even if the schema already
      // exists in a slightly different form.
    }
  }
}

function checksumContent(content: string): string {
  return lazyCrypto().createHash("sha256").update(content).digest("hex");
}

async function syncTrackedFile(graphKey: string, gitRoot: string, filePath: string): Promise<void> {
  const { readFile } = lazyFsPromises();
  const fullPath = lazyPath().resolve(gitRoot, filePath);
  const codeFileKey = buildCodeFileKey(graphKey, filePath);

  try {
    const content = await readFile(fullPath, "utf-8");
    const checksum = checksumContent(content);
    const indexedAt = new Date().toISOString();

    await runCypher(
      [
        "MERGE (f:CodeFile {codeFileKey: $codeFileKey})",
        "SET f.graphKey = $graphKey,",
        "    f.path = $filePath,",
        "    f.extension = $extension,",
        "    f.checksum = $checksum,",
        "    f.indexedAt = datetime($indexedAt)",
      ].join("\n"),
      {
        codeFileKey,
        graphKey,
        filePath,
        extension: lazyPath().extname(filePath).toLowerCase(),
        checksum,
        indexedAt,
      },
    );

    await codeGraphPrisma.codeGraphFileHash.upsert({
      where: { graphKey_filePath: { graphKey, filePath } },
      create: {
        graphKey,
        filePath,
        checksum,
        authority: "git",
        lastIndexedAt: new Date(indexedAt),
      },
      update: {
        checksum,
        authority: "git",
        lastIndexedAt: new Date(indexedAt),
      },
    });
  } catch {
    await runCypher(
      "MATCH (f:CodeFile {codeFileKey: $codeFileKey}) DETACH DELETE f",
      { codeFileKey },
    );
    await codeGraphPrisma.codeGraphFileHash.deleteMany({
      where: { graphKey, filePath },
    });
  }
}

export function planCodeGraphRefresh(input: {
  currentHeadSha: string | null;
  lastIndexedHeadSha: string | null;
  changedFiles: string[];
  diffFailed: boolean;
  forceFull: boolean;
}): CodeGraphRefreshPlan {
  if (input.forceFull || !input.lastIndexedHeadSha || !input.currentHeadSha || input.diffFailed) {
    return { mode: "full", changedFiles: [] };
  }

  if (input.currentHeadSha === input.lastIndexedHeadSha) {
    return { mode: "noop", changedFiles: [] };
  }

  return {
    mode: "incremental",
    changedFiles: input.changedFiles,
  };
}

export async function registerCodeGraphScheduledJob(): Promise<void> {
  const now = new Date();
  const nextRunAt = computeNextRunAt(CODE_GRAPH_JOB_SCHEDULE, now);

  await prisma.scheduledJob.upsert({
    where: { jobId: CODE_GRAPH_JOB_ID },
    create: {
      jobId: CODE_GRAPH_JOB_ID,
      name: CODE_GRAPH_JOB_NAME,
      schedule: CODE_GRAPH_JOB_SCHEDULE,
      nextRunAt,
    },
    update: {
      schedule: CODE_GRAPH_JOB_SCHEDULE,
      nextRunAt,
    },
  });
}

export async function queueCodeGraphReconcile(input: QueueCodeGraphReconcileInput): Promise<void> {
  await inngest.send({
    name: CODE_GRAPH_EVENT_NAME,
    data: {
      reason: input.reason,
      headSha: input.headSha ?? null,
      branch: input.branch ?? null,
      graphKey: input.graphKey ?? CODE_GRAPH_GRAPH_KEY,
    },
  });
}

export async function reconcileCodeGraph(input: ReconcileCodeGraphInput): Promise<ReconcileCodeGraphResult> {
  const graphKey = input.graphKey ?? CODE_GRAPH_GRAPH_KEY;
  const gitRoot = getGitRoot();
  const now = new Date();
  let existingState: CodeGraphIndexStateRecord | null = null;
  let headSha: string | null = null;
  let branch: string | null = null;
  let workspaceDirty = false;
  const lockRows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext(${`code-graph:${graphKey}`})) AS locked
  `;
  if (!lockRows[0]?.locked) {
    return {
      mode: "noop",
      graphKey,
      headSha: null,
      branch: null,
      workspaceDirty: false,
      changedFiles: [],
    };
  }

  try {
    [existingState, headSha, branch, workspaceDirty] = await Promise.all([
      codeGraphPrisma.codeGraphIndexState.findUnique({ where: { graphKey } }),
      getCurrentHeadSha(gitRoot),
      getCurrentBranch(gitRoot),
      isWorkspaceDirty(gitRoot),
    ]);

    await ensureCodeGraphNeo4jSchema();

    await codeGraphPrisma.codeGraphIndexState.upsert({
      where: { graphKey },
      create: {
        graphKey,
        graphVersion: 1,
        workspaceRoot: gitRoot,
        indexStatus: "updating",
        lastIndexedBranch: branch,
        lastIndexedHeadSha: existingState?.lastIndexedHeadSha ?? null,
        workspaceDirty,
        workspaceDirtyObservedAt: now,
        lastError: null,
      },
      update: {
        workspaceRoot: gitRoot,
        indexStatus: "updating",
        lastIndexedBranch: branch,
        workspaceDirty,
        workspaceDirtyObservedAt: now,
        lastError: null,
      },
    });

    let diffFailed = false;
    let changedFiles: string[] = [];

    if (existingState?.lastIndexedHeadSha && headSha && headSha !== existingState.lastIndexedHeadSha && !input.forceFull) {
      try {
        changedFiles = await getChangedFiles(gitRoot, existingState.lastIndexedHeadSha, headSha);
      } catch {
        diffFailed = true;
      }
    }

    const plan = planCodeGraphRefresh({
      currentHeadSha: headSha,
      lastIndexedHeadSha: existingState?.lastIndexedHeadSha ?? null,
      changedFiles,
      diffFailed,
      forceFull: input.forceFull ?? false,
    });

    if (plan.mode === "full") {
      await clearCodeGraph(graphKey);
      for (const filePath of await listTrackedFiles(gitRoot)) {
        await syncTrackedFile(graphKey, gitRoot, filePath);
      }
    } else if (plan.mode === "incremental") {
      for (const filePath of plan.changedFiles) {
        await syncTrackedFile(graphKey, gitRoot, filePath);
      }
    }

    await codeGraphPrisma.codeGraphIndexState.upsert({
      where: { graphKey },
      create: {
        graphKey,
        graphVersion: 1,
        workspaceRoot: gitRoot,
        indexStatus: "ready",
        lastIndexedAt: now,
        lastIndexedBranch: branch,
        lastIndexedHeadSha: headSha,
        workspaceDirty,
        workspaceDirtyObservedAt: now,
        indexedFileCount: await codeGraphPrisma.codeGraphFileHash.count({ where: { graphKey } }),
        lastError: null,
      },
      update: {
        workspaceRoot: gitRoot,
        indexStatus: "ready",
        lastIndexedAt: now,
        lastIndexedBranch: branch,
        lastIndexedHeadSha: headSha,
        workspaceDirty,
        workspaceDirtyObservedAt: now,
        indexedFileCount: await codeGraphPrisma.codeGraphFileHash.count({ where: { graphKey } }),
        lastError: null,
      },
    });

    return {
      mode: plan.mode,
      graphKey,
      headSha,
      branch,
      workspaceDirty,
      changedFiles: plan.changedFiles,
    };
  } catch (error) {
    await codeGraphPrisma.codeGraphIndexState.upsert({
      where: { graphKey },
      create: {
        graphKey,
        graphVersion: 1,
        workspaceRoot: gitRoot,
        indexStatus: "failed",
        lastIndexedBranch: branch,
        lastIndexedHeadSha: existingState?.lastIndexedHeadSha ?? null,
        workspaceDirty,
        workspaceDirtyObservedAt: now,
        lastError: error instanceof Error ? error.message : "Unknown reconcile failure",
      },
      update: {
        workspaceRoot: gitRoot,
        indexStatus: "failed",
        lastIndexedBranch: branch,
        workspaceDirty,
        workspaceDirtyObservedAt: now,
        lastError: error instanceof Error ? error.message : "Unknown reconcile failure",
      },
    });
    throw error;
  }
  finally {
    await prisma.$executeRaw`
      SELECT pg_advisory_unlock(hashtext(${`code-graph:${graphKey}`}))
    `;
  }
}
