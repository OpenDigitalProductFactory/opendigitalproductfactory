// Shared reconciler for deterministic EA conformance findings.
//
// Steward-style detectors should emit stable issue keys. This helper owns the
// create/update/auto-resolve contract so each steward does not re-implement the
// same fragile persistence loop.

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

export type ConformanceIssueReconcileResult = {
  created: number;
  updated: number;
  resolved: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function issueKeyOf(detailsJson: unknown): string | null {
  const key = asRecord(detailsJson).issueKey;
  return typeof key === "string" ? key : null;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]),
  );
}

function detailsChanged(a: unknown, b: Record<string, unknown>): boolean {
  return JSON.stringify(stable(asRecord(a))) !== JSON.stringify(stable(b));
}

export async function reconcileConformanceIssues(
  db: ConformanceIssueClient,
  opts: {
    issueTypes: string[];
    findings: ConformanceFinding[];
  },
): Promise<ConformanceIssueReconcileResult> {
  const existing = await db.eaConformanceIssue.findMany({
    where: { issueType: { in: opts.issueTypes }, status: "open" },
    select: { id: true, issueType: true, message: true, severity: true, detailsJson: true },
  });

  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    const key = issueKeyOf(row.detailsJson);
    if (key) existingByKey.set(key, row);
  }

  const findingByKey = new Map<string, ConformanceFinding>(opts.findings.map((f) => [f.issueKey, f]));
  let created = 0;
  let updated = 0;
  let resolved = 0;

  for (const finding of opts.findings) {
    const match = existingByKey.get(finding.issueKey);
    const detailsJson = { ...(finding.detailsJson ?? {}), issueKey: finding.issueKey };
    if (!match) {
      const data: Record<string, unknown> = {
        issueType: finding.issueType,
        severity: finding.severity,
        status: "open",
        message: finding.message,
        detailsJson,
      };
      if ("viewId" in finding) data.viewId = finding.viewId;
      if ("elementId" in finding) data.elementId = finding.elementId;
      await db.eaConformanceIssue.create({
        data,
      });
      created += 1;
    } else if (
      match.message !== finding.message ||
      match.severity !== finding.severity ||
      detailsChanged(match.detailsJson, detailsJson)
    ) {
      await db.eaConformanceIssue.update({
        where: { id: match.id },
        data: {
          message: finding.message,
          severity: finding.severity,
          detailsJson,
        },
      });
      updated += 1;
    }
  }

  for (const [key, row] of existingByKey) {
    if (!findingByKey.has(key)) {
      await db.eaConformanceIssue.update({ where: { id: row.id }, data: { status: "resolved" } });
      resolved += 1;
    }
  }

  return { created, updated, resolved };
}
