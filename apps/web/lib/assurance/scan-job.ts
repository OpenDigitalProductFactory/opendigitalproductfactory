import { spawn } from "node:child_process";
import type { Prisma } from "@dpf/db";
import {
  PNPM_AUDIT_ADAPTER_KEY,
  PNPM_AUDIT_ADAPTER_VERSION,
  runPnpmAuditAdapter,
  type PnpmAuditComponentLookup,
} from "./pnpm-audit-adapter";
import { persistAssuranceFindings, type AssuranceFindingPersistenceDb } from "./finding-persistence";

export interface ScanJobBomDocumentRow {
  id: string;
  documentId: string;
  occurrences?: Array<{
    component: {
      id: string;
      componentKey: string;
      name: string;
      version: string | null;
      packageUrl: string | null;
    };
  }>;
}

export interface ScanJobBuildRow {
  buildId: string;
  title: string;
  threadId: string | null;
  digitalProductId: string | null;
}

type ScanJobDb = AssuranceFindingPersistenceDb & {
  featureBuild: {
    findUnique(args: unknown): Promise<unknown>;
  };
  bomDocument: {
    findFirst(args: unknown): Promise<unknown>;
  };
  toolExecution: {
    create(args: unknown): Promise<{ id: string }>;
  };
  toolExecutionReceipt: {
    create(args: unknown): Promise<{ id: string }>;
  };
  assuranceRun: {
    create(args: unknown): Promise<{ id: string; runId: string }>;
  };
  buildActivity?: {
    create(args: unknown): Promise<unknown>;
  };
};

export interface RunPnpmAuditCommandInput {
  projectRoot: string;
  signal?: AbortSignal;
}

export interface RunPnpmAuditCommandResult {
  stdout: string;
  exitCode: number;
}

export type RunPnpmAuditCommand = (input: RunPnpmAuditCommandInput) => Promise<RunPnpmAuditCommandResult>;

export const defaultRunPnpmAudit: RunPnpmAuditCommand = ({ projectRoot, signal }) =>
  new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["audit", "--json", "--prod"], {
      cwd: projectRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === null) {
        reject(new Error(`pnpm audit terminated unexpectedly. stderr=${stderr.slice(0, 256)}`));
        return;
      }
      resolve({ stdout, exitCode: code });
    });
  });

export interface RunBuildScanInput {
  db: ScanJobDb;
  buildId: string;
  requestedByUserId: string;
  projectRoot: string;
  now: Date;
  runAudit?: RunPnpmAuditCommand;
}

export type RunBuildScanResult =
  | { skipped: true; reason: string }
  | {
      skipped: false;
      runId: string;
      created: number;
      updated: number;
      reopened: number;
      blockingCount: number;
      findingCount: number;
    };

function buildLookup(document: ScanJobBomDocumentRow): PnpmAuditComponentLookup {
  const lookup: PnpmAuditComponentLookup = {};
  for (const occurrence of document.occurrences ?? []) {
    const component = occurrence.component;
    if (!component) continue;
    const entry = {
      componentId: component.id,
      componentKey: component.componentKey,
      name: component.name,
      version: component.version,
      packageUrl: component.packageUrl,
    };
    if (component.version) {
      lookup[`${component.name}@${component.version}`] = entry;
    }
    if (!lookup[component.name]) {
      lookup[component.name] = entry;
    }
  }
  return lookup;
}

function deriveStatus(findingCount: number, blockingCount: number): "passed" | "failed" | "partial" {
  if (blockingCount > 0) return "failed";
  if (findingCount > 0) return "partial";
  return "passed";
}

function createRunId(buildId: string, toolExecutionId: string): string {
  const buildPart = buildId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const executionPart = toolExecutionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return `assurance_scan_${buildPart}_${executionPart}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export async function runBuildAssuranceScan(input: RunBuildScanInput): Promise<RunBuildScanResult> {
  const build = await input.db.featureBuild.findUnique({
    where: { buildId: input.buildId },
    select: { buildId: true, title: true, threadId: true, digitalProductId: true },
  }) as ScanJobBuildRow | null;

  if (!build) return { skipped: true, reason: "build not found" };

  const document = await input.db.bomDocument.findFirst({
    where: { buildId: build.buildId },
    orderBy: { generatedAt: "desc" },
    select: {
      id: true,
      documentId: true,
      occurrences: {
        select: {
          component: {
            select: {
              id: true,
              componentKey: true,
              name: true,
              version: true,
              packageUrl: true,
            },
          },
        },
      },
    },
  }) as ScanJobBomDocumentRow | null;

  if (!document) return { skipped: true, reason: "bom-not-generated" };

  const runAudit = input.runAudit ?? defaultRunPnpmAudit;
  let auditResult: RunPnpmAuditCommandResult;
  try {
    auditResult = await runAudit({ projectRoot: input.projectRoot });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[tool-trace] pnpm audit failed buildId=${build.buildId} reason=${reason}`);
    return { skipped: true, reason: `pnpm-audit-failed:${reason.slice(0, 200)}` };
  }

  if (auditResult.exitCode !== 0 && auditResult.exitCode !== 1) {
    return { skipped: true, reason: `pnpm-audit-exit-${auditResult.exitCode}` };
  }

  const lookup = buildLookup(document);
  const adapterOutput = runPnpmAuditAdapter({ jsonText: auditResult.stdout, lookup });

  const toolExecution = await input.db.toolExecution.create({
    data: {
      threadId: build.threadId ?? build.buildId,
      agentId: "system:assurance-ledger",
      userId: input.requestedByUserId,
      toolName: "run_pnpm_audit",
      parameters: {
        buildId: build.buildId,
        bomDocumentId: document.id,
        adapterKey: PNPM_AUDIT_ADAPTER_KEY,
        adapterVersion: PNPM_AUDIT_ADAPTER_VERSION,
      } satisfies Prisma.InputJsonValue,
      result: {
        advisoryCount: adapterOutput.advisoryCount,
        findingCount: adapterOutput.findings.length,
        blockingCount: Number(adapterOutput.summary.blockingCount ?? 0),
      } satisfies Prisma.InputJsonValue,
      success: true,
      executionMode: "background",
      routeContext: "/build",
      durationMs: null,
      summary: `pnpm audit produced ${adapterOutput.findings.length} normalized findings for ${build.title}.`,
    },
  });

  const status = deriveStatus(adapterOutput.findings.length, Number(adapterOutput.summary.blockingCount ?? 0));

  const receipt = await input.db.toolExecutionReceipt.create({
    data: {
      toolExecutionId: toolExecution.id,
      buildId: build.buildId,
      receiptKind: "assurance-scan",
      inputFingerprint: document.documentId,
      outputDigest: { findingCount: adapterOutput.findings.length } satisfies Prisma.InputJsonValue,
      executionStatus: status === "passed" ? "passed" : "needs-review",
      expiresAt: addDays(input.now, 30),
    },
  });

  const assuranceRun = await input.db.assuranceRun.create({
    data: {
      runId: createRunId(build.buildId, toolExecution.id),
      scopeType: "build",
      scopeId: build.buildId,
      adapterKey: PNPM_AUDIT_ADAPTER_KEY,
      adapterVersion: PNPM_AUDIT_ADAPTER_VERSION,
      status,
      summary: adapterOutput.summary as Prisma.InputJsonValue,
      startedAt: input.now,
      completedAt: input.now,
      buildId: build.buildId,
      digitalProductId: build.digitalProductId,
      toolExecutionId: toolExecution.id,
      toolExecutionReceiptId: receipt.id,
    },
  });

  const persistResult = await persistAssuranceFindings(input.db, {
    assuranceRunId: assuranceRun.id,
    findings: adapterOutput.findings,
    observedAt: input.now,
    buildId: build.buildId,
    digitalProductId: build.digitalProductId,
    bomDocumentId: document.id,
    componentIdsByAffectedId: adapterOutput.componentIdsByAffectedId,
  });

  await input.db.buildActivity?.create({
    data: {
      buildId: build.buildId,
      tool: "assurance-scan",
      summary: `pnpm audit scan: ${adapterOutput.findings.length} findings (${Number(adapterOutput.summary.blockingCount ?? 0)} blocking, ${persistResult.reopened} reopened).`,
    },
  });

  if (build.threadId) {
    const { agentEventBus } = await import("@/lib/agent-event-bus");
    agentEventBus.emit(build.threadId, {
      type: "evidence:update",
      buildId: build.buildId,
      field: "assuranceFindings",
    });
  }

  return {
    skipped: false,
    runId: assuranceRun.runId,
    created: persistResult.created,
    updated: persistResult.updated,
    reopened: persistResult.reopened,
    blockingCount: Number(adapterOutput.summary.blockingCount ?? 0),
    findingCount: adapterOutput.findings.length,
  };
}
