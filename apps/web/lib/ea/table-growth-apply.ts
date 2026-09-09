// apps/web/lib/ea/table-growth-apply.ts
//
// EP-A33A5C61 slice 5 — the nightly growth pass the Data Architect steward
// runs after the structural drift detectors:
//
//   sample pg_class → persist TableGrowthSample → detect over the last few
//   nights → reconcile into EaConformanceIssue (same keyed-upsert contract as
//   the structural findings) → file ONE fingerprinted backlog item for each
//   finding that has now persisted PERSISTENT_NIGHTS nights.
//
// Everything that can fail is best-effort and reported in the result; the
// structural mirror/steward never waits on, or fails because of, growth.

import { loadModelDeclarations } from "@/lib/operate/retention/declarations";
import { captureCorrectiveFailureBI } from "@/lib/backlog/capture-corrective-bi";

import { reconcileConformanceIssues, type ConformanceIssueClient } from "./conformance-issue-reconciler";
import {
  GROWTH_ISSUE_TYPES,
  PERSISTENT_NIGHTS,
  detectGrowthDrift,
  groupSamplesByTable,
  sampleTableGrowth,
  type TableGrowthSampleRow,
} from "./table-growth";

const MS_PER_DAY = 86_400_000;
/** Keep enough history for bytes/day and the persistence window. */
const HISTORY_DAYS = PERSISTENT_NIGHTS + 2;

export type GrowthPrismaClient = ConformanceIssueClient & {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
  tableGrowthSample: {
    createMany(args: { data: unknown[] }): Promise<{ count: number }>;
    findMany(args: Record<string, unknown>): Promise<TableGrowthSampleRow[]>;
  };
  eaView: { findFirst(args: Record<string, unknown>): Promise<{ id: string } | null> };
};

export type GrowthResult = {
  sampled: number;
  findings: number;
  byType: Record<string, number>;
  filedBacklogItems: string[];
  error?: string;
};

export async function runTableGrowthSteward(deps: {
  prisma: GrowthPrismaClient;
  now?: Date;
  fileBacklog?: boolean;
}): Promise<GrowthResult> {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const byType: Record<string, number> = {};
  try {
    const declarations = await loadModelDeclarations(prisma, (m) => console.warn(`[table-growth] ${m}`));
    const samples = await sampleTableGrowth(prisma, declarations, now);
    if (samples.length > 0) {
      await prisma.tableGrowthSample.createMany({ data: samples });
    }
    const since = new Date(now.getTime() - HISTORY_DAYS * MS_PER_DAY);
    const history = await prisma.tableGrowthSample.findMany({
      where: { sampledAt: { gte: since } },
      orderBy: { sampledAt: "asc" },
    });
    // The rows just written may not be visible to a read replica; make sure
    // tonight's sample is in the history regardless.
    const merged = groupSamplesByTable([...history.filter((h) => h.sampledAt.getTime() !== now.getTime()), ...samples]);
    const findings = detectGrowthDrift(merged);
    for (const f of findings) byType[f.issueType] = (byType[f.issueType] ?? 0) + 1;

    const view = await prisma.eaView.findFirst({ where: { scopeType: "data-model", scopeRef: "prisma" } });
    await reconcileConformanceIssues(prisma, {
      issueTypes: [...GROWTH_ISSUE_TYPES],
      findings: findings.map((f) => ({
        issueKey: f.issueKey,
        issueType: f.issueType,
        severity: f.severity,
        message: f.message,
        viewId: view?.id ?? null,
        detailsJson: { ...f.details, steward: true, growth: true },
      })),
    });

    // Persistence = the open issue for this key was first created at least
    // PERSISTENT_NIGHTS-1 days ago and is still open tonight.
    const filed: string[] = [];
    if (deps.fileBacklog !== false && findings.length > 0) {
      const cutoff = new Date(now.getTime() - (PERSISTENT_NIGHTS - 1) * MS_PER_DAY);
      const persistent = await prisma.eaConformanceIssue.findMany({
        where: { issueType: { in: [...GROWTH_ISSUE_TYPES] }, status: "open", createdAt: { lte: cutoff } },
        select: { id: true, issueType: true, message: true, severity: true, detailsJson: true },
      });
      for (const issue of persistent as Array<{ issueType: string; message: string; detailsJson: unknown }>) {
        const details = (issue.detailsJson ?? {}) as Record<string, unknown>;
        const table = String(details.table ?? "unknown");
        const result = await captureCorrectiveFailureBI({
          source: "data-growth",
          signature: `${issue.issueType}:${table}`,
          title: `[data-growth] ${issue.message.slice(0, 160)}`,
          body:
            `Steward finding persisted ${PERSISTENT_NIGHTS} consecutive nightly samples (EP-A33A5C61 slice 5).\n\n` +
            `Table: ${table}\nModel: ${String(details.model ?? "untagged")}\nDeclared retention: ${String(details.declaredRetention ?? "none")}\n` +
            `Rows/24h: ${String(details.rowsLast24h ?? "n/a")}\nBytes/day: ${String(details.bytesPerDay ?? "n/a")}\n` +
            `Total: ${String(details.totalBytes ?? "n/a")} bytes\nProjected 12 months: ${String(details.projected12Month ?? "n/a")}\n\n` +
            `Remedy: ${String(details.remedy ?? "")}\n\nRead the finding on the EA data-model view; the steward re-evaluates nightly and the item stays open until the finding clears.`,
          agentId: "AGT-BUILD-DA",
        });
        if (result.action === "created" || result.action === "updated") filed.push(result.itemId);
      }
    }
    return { sampled: samples.length, findings: findings.length, byType, filedBacklogItems: filed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[table-growth] growth pass failed:", message);
    return { sampled: 0, findings: 0, byType, filedBacklogItems: [], error: message };
  }
}
