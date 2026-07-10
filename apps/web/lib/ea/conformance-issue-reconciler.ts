// Shared reconciler for deterministic EA conformance findings.
//
// Steward-style detectors should emit stable issue keys. This helper owns the
// create/update/auto-resolve contract so each steward does not re-implement the
// same fragile persistence loop.
//
// It is now a thin adapter over the generic `governance/reconcile-keyed-findings`
// loop: this file only plugs in the `eaConformanceIssue` delegate, the
// `detailsJson.issueKey` key extraction, and the message/severity/detailsJson
// change detection. The exported signature and `{created, updated, resolved}`
// return shape are unchanged, so the stewards that call it need no changes.

import {
  reconcileKeyedFindings,
  stableStringify,
  type ReconcileKeyedFindingsResult,
} from "@/lib/governance/reconcile-keyed-findings";

export type ConformanceIssueClient = {
  eaConformanceIssue: {
    findMany(args: Record<string, unknown>): Promise<
      Array<{
        id: string;
        issueType: string;
        message: string;
        severity: string;
        detailsJson: unknown;
      }>
    >;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
    update(args: Record<string, unknown>): Promise<unknown>;
  };
};

export type ConformanceFinding = {
  issueKey: string;
  issueType: string;
  severity: string;
  message: string;
  detailsJson?: Record<string, unknown>;
  viewId?: string | null;
  elementId?: string | null;
};

export type ConformanceIssueReconcileResult = ReconcileKeyedFindingsResult;

type ConformanceRow = {
  id: string;
  issueType: string;
  message: string;
  severity: string;
  detailsJson: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function issueKeyOf(detailsJson: unknown): string | null {
  const key = asRecord(detailsJson).issueKey;
  return typeof key === "string" ? key : null;
}

/** The stored details always carry the stable issueKey alongside the finding detail. */
function effectiveDetails(finding: ConformanceFinding): Record<string, unknown> {
  return { ...(finding.detailsJson ?? {}), issueKey: finding.issueKey };
}

function detailsChanged(a: unknown, b: Record<string, unknown>): boolean {
  return stableStringify(asRecord(a)) !== stableStringify(b);
}

export async function reconcileConformanceIssues(
  db: ConformanceIssueClient,
  opts: {
    issueTypes: string[];
    findings: ConformanceFinding[];
  },
): Promise<ConformanceIssueReconcileResult> {
  const keyed = opts.findings.map((finding) => ({ ...finding, key: finding.issueKey }));

  return reconcileKeyedFindings<ConformanceRow, (typeof keyed)[number]>({
    loadOpen: () =>
      db.eaConformanceIssue.findMany({
        where: { issueType: { in: opts.issueTypes }, status: "open" },
        select: { id: true, issueType: true, message: true, severity: true, detailsJson: true },
      }),
    keyOf: (row) => issueKeyOf(row.detailsJson),
    findings: keyed,
    hasChanged: (row, finding) =>
      row.message !== finding.message ||
      row.severity !== finding.severity ||
      detailsChanged(row.detailsJson, effectiveDetails(finding)),
    create: async (finding) => {
      const data: Record<string, unknown> = {
        issueType: finding.issueType,
        severity: finding.severity,
        status: "open",
        message: finding.message,
        detailsJson: effectiveDetails(finding),
      };
      if ("viewId" in finding) data.viewId = finding.viewId;
      if ("elementId" in finding) data.elementId = finding.elementId;
      await db.eaConformanceIssue.create({ data });
    },
    update: async (row, finding) => {
      await db.eaConformanceIssue.update({
        where: { id: row.id },
        data: {
          message: finding.message,
          severity: finding.severity,
          detailsJson: effectiveDetails(finding),
        },
      });
    },
    resolve: async (row) => {
      await db.eaConformanceIssue.update({ where: { id: row.id }, data: { status: "resolved" } });
    },
  });
}
