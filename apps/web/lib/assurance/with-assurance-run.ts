// apps/web/lib/assurance/with-assurance-run.ts — EP-8DC217EB BET-12
//
// Shared AssuranceRun ledger writer. Both the BOM job and the vulnerability-scan
// job open a build-scoped AssuranceRun with an identical field layout — only the
// runId prefix, adapter, status, and summary vary. This collapses that duplicated
// block (and the two copies of the runId builder) into one place so the fixed
// contract (scopeType "build", scopeId = buildId, startedAt = completedAt = now)
// lives once.

import type { Prisma } from "@dpf/db";

/** Minimal client shape: just the assuranceRun.create delegate this writer needs. */
export type AssuranceRunCreateClient = {
  assuranceRun: {
    create(args: unknown): Promise<{ id: string; runId: string }>;
  };
};

/**
 * Build a deterministic AssuranceRun id: `<prefix><buildId>_<toolExecutionId>`,
 * with each id part sanitized to `[a-zA-Z0-9_-]` and capped at 64 chars.
 * `prefix` carries the per-adapter namespace, e.g. `assurance_scan_` / `assurance_bom_`.
 */
export function assuranceRunId(prefix: string, buildId: string, toolExecutionId: string): string {
  const buildPart = buildId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const executionPart = toolExecutionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return `${prefix}${buildPart}_${executionPart}`;
}

export interface CreateAssuranceRunParams {
  /** runId namespace, e.g. `assurance_scan_` or `assurance_bom_`. */
  prefix: string;
  buildId: string;
  digitalProductId: string | null;
  adapterKey: string;
  adapterVersion: string;
  status: string;
  summary: Prisma.InputJsonValue;
  toolExecutionId: string;
  toolExecutionReceiptId: string;
  now: Date;
}

/**
 * Create the build-scoped AssuranceRun ledger row. The varying fields come from
 * `params`; the fixed contract (scopeType "build", scopeId = buildId,
 * startedAt = completedAt = now) is applied here.
 */
export async function createAssuranceRun(
  db: AssuranceRunCreateClient,
  params: CreateAssuranceRunParams,
): Promise<{ id: string; runId: string }> {
  return db.assuranceRun.create({
    data: {
      runId: assuranceRunId(params.prefix, params.buildId, params.toolExecutionId),
      scopeType: "build",
      scopeId: params.buildId,
      adapterKey: params.adapterKey,
      adapterVersion: params.adapterVersion,
      status: params.status,
      summary: params.summary,
      startedAt: params.now,
      completedAt: params.now,
      buildId: params.buildId,
      digitalProductId: params.digitalProductId,
      toolExecutionId: params.toolExecutionId,
      toolExecutionReceiptId: params.toolExecutionReceiptId,
    },
  });
}
