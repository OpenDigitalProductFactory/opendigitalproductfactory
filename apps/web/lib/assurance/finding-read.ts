import {
  ASSURANCE_POLICY_SEVERITIES,
  type AssuranceFindingKind,
  type AssuranceFindingStatus,
  type AssurancePolicySeverity,
} from "./types";

export interface AssuranceFindingSummary {
  total: number;
  blocking: number;
  bySeverity: Record<AssurancePolicySeverity, number>;
  byKind: Partial<Record<AssuranceFindingKind, number>> & Record<string, number>;
}

type FindingSummaryRow = {
  policySeverity: string;
  releaseImpact: string;
  status: string;
  findingKind: string;
};

type FindingSummaryDb = {
  assuranceFinding?: {
    findMany(args: unknown): Promise<FindingSummaryRow[]>;
  };
};

const CLOSED_STATUSES: AssuranceFindingStatus[] = ["resolved", "false-positive"];
const BLOCKING_STATUSES = new Set<string>(["open", "planned", "blocked"]);

export function emptyFindingSummary(): AssuranceFindingSummary {
  return {
    total: 0,
    blocking: 0,
    bySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    },
    byKind: {},
  };
}

function normalizeSeverity(value: string): AssurancePolicySeverity {
  return ASSURANCE_POLICY_SEVERITIES.includes(value as AssurancePolicySeverity)
    ? value as AssurancePolicySeverity
    : "info";
}

function summarize(rows: FindingSummaryRow[]): AssuranceFindingSummary {
  const summary = emptyFindingSummary();

  for (const row of rows) {
    const severity = normalizeSeverity(row.policySeverity);
    summary.total += 1;
    summary.bySeverity[severity] += 1;
    summary.byKind[row.findingKind] = (summary.byKind[row.findingKind] ?? 0) + 1;

    if (row.releaseImpact === "block" && BLOCKING_STATUSES.has(row.status)) {
      summary.blocking += 1;
    }
  }

  return summary;
}

async function getActiveFindingSummary(
  db: FindingSummaryDb,
  where: Record<string, unknown>,
): Promise<AssuranceFindingSummary> {
  if (!db.assuranceFinding) return emptyFindingSummary();

  const rows = await db.assuranceFinding.findMany({
    where: {
      ...where,
      status: { notIn: CLOSED_STATUSES },
    },
    select: {
      policySeverity: true,
      releaseImpact: true,
      status: true,
      findingKind: true,
    },
    take: 1000,
  });

  return summarize(rows);
}

export function getActiveFindingSummaryForBuild(
  db: FindingSummaryDb,
  buildId: string,
): Promise<AssuranceFindingSummary> {
  return getActiveFindingSummary(db, { buildId });
}

export function getActiveFindingSummaryForProduct(
  db: FindingSummaryDb,
  digitalProductId: string,
): Promise<AssuranceFindingSummary> {
  return getActiveFindingSummary(db, { digitalProductId });
}
