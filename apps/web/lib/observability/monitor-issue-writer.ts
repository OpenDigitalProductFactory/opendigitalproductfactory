// Shared writer for MONITOR-CLEARED PortfolioQualityIssue rows.
//
// Consolidation (BI-E105303D): `health-alert-issue.ts` already owned a bespoke
// open/refresh/resolve triple over PortfolioQualityIssue, and the journey
// watchdog needed the same shape. Rather than let a second hand-rolled copy
// appear — the exact drift that produced 8 undeclared issue types and 2,247
// unclosable rows (see packages/db/src/quality-issue-registry.ts) — both now go
// through this one primitive.
//
// Scope boundary, deliberately narrow: this serves the `monitor-clears` family —
// issue types whose row is opened by a monitoring source and resolved when that
// source observes the condition clear. It is NOT a replacement for
// `openOrUpdateQualityIssue` in @dpf/db, which owns the discovery→portfolio
// family and requires an inventory/taxonomy/portfolio FK scope. Same table, two
// deliberately different families.
//
// `issueType` is typed as `QualityIssueType`, so a caller emitting a type with
// no declared lifecycle is a compile error rather than a row nobody can close.

import type { QualityIssueType } from "@dpf/db";

/** Narrow Prisma surface so tests inject a mock without the full client type. */
export interface MonitorIssueDb {
  portfolioQualityIssue: {
    upsert(args: {
      where: { issueKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export type MonitorIssueSeverity = "info" | "warn" | "error";

/**
 * Per-customer/site routing scope (EP-MSP-FEDERATION · A1). Absent scope keeps
 * the row in the operator's own estate, which is the backward-compatible default.
 */
export interface MonitorIssueScope {
  customerAccountId?: string | null;
  customerSiteId?: string | null;
  scopeKey?: string | null;
}

export function monitorIssueScopeColumns(scope?: MonitorIssueScope) {
  const customerAccountId = scope?.customerAccountId ?? null;
  const customerSiteId = scope?.customerSiteId ?? null;
  const scopeKey =
    scope?.scopeKey ??
    (customerAccountId
      ? customerSiteId
        ? `customer:${customerAccountId}:site:${customerSiteId}`
        : `customer:${customerAccountId}`
      : "organization:internal");
  return { customerAccountId, customerSiteId, scopeKey };
}

export interface OpenMonitorIssueParams {
  issueKey: string;
  issueType: QualityIssueType;
  severity: MonitorIssueSeverity;
  summary: string;
  details: unknown;
  /** When the condition was first observed. Defaults to now on first open. */
  firstDetectedAt?: Date;
  scope?: MonitorIssueScope;
  now?: () => Date;
}

/**
 * Open or refresh the issue for a firing condition. Idempotent: the unique
 * `issueKey` means a repeated firing updates `lastDetectedAt` rather than
 * duplicating, and a previously-resolved row reopens with `resolvedAt` cleared.
 */
export async function openMonitorIssue(
  db: MonitorIssueDb,
  params: OpenMonitorIssueParams,
): Promise<string> {
  const now = params.now ?? (() => new Date());
  const at = now();
  await db.portfolioQualityIssue.upsert({
    where: { issueKey: params.issueKey },
    create: {
      issueKey: params.issueKey,
      issueType: params.issueType,
      severity: params.severity,
      summary: params.summary,
      details: params.details,
      status: "open",
      firstDetectedAt: params.firstDetectedAt ?? at,
      lastDetectedAt: at,
      ...monitorIssueScopeColumns(params.scope),
    },
    update: {
      severity: params.severity,
      summary: params.summary,
      details: params.details,
      status: "open",
      lastDetectedAt: at,
      resolvedAt: null,
    },
  });
  return params.issueKey;
}

/** Flip one open issue to resolved — the condition cleared at its source. */
export async function resolveMonitorIssue(
  db: MonitorIssueDb,
  issueKey: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  const at = now();
  await db.portfolioQualityIssue.updateMany({
    where: { issueKey, status: "open" },
    data: { status: "resolved", resolvedAt: at, lastDetectedAt: at },
  });
}

/**
 * Absent-clean: resolve every open row of `issueType` whose key is NOT in
 * `activeKeys`. This is what stops a monitor family accumulating rows for
 * conditions that stopped reproducing — the failure mode the quality-issue
 * registry exists to prevent.
 */
export async function resolveMonitorIssuesExcept(
  db: MonitorIssueDb,
  params: {
    issueType: QualityIssueType;
    activeKeys: string[];
    now?: () => Date;
  },
): Promise<number> {
  const at = (params.now ?? (() => new Date()))();
  const { count } = await db.portfolioQualityIssue.updateMany({
    where: {
      issueType: params.issueType,
      status: "open",
      ...(params.activeKeys.length > 0 ? { issueKey: { notIn: params.activeKeys } } : {}),
    },
    data: { status: "resolved", resolvedAt: at, lastDetectedAt: at },
  });
  return count;
}
