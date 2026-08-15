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

export interface ActiveAssuranceFindingRow {
  findingKey: string;
  findingKind: string;
  title: string;
  status: string;
  policySeverity: AssurancePolicySeverity;
  releaseImpact: string;
  adapterKey: string;
  vendorIdentifier: string;
  affectedType: string;
  affectedId: string;
  lastSeenAt: Date;
  component: null | {
    name: string;
    version: string | null;
    packageUrl: string | null;
  };
  /** Linked backlog item (set once the finding is filed / auto-filed). */
  backlogItemId: string | null;
  /** Auto-file disposition reason (e.g. "suppressed: stale-sandbox …"). */
  autoFileReason: string | null;
}

type FindingSummaryRow = {
  policySeverity: string;
  releaseImpact: string;
  status: string;
  findingKind: string;
};

type FindingSummaryPageRow = FindingSummaryRow & { id?: string };

type FindingSummaryDb = {
  assuranceFinding?: {
    findMany(args: unknown): Promise<FindingSummaryPageRow[]>;
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

  // BI-72C3FBA2: page the full open-finding set. A silent take:1000 under-counted
  // severity summaries once a build/product crossed the first batch.
  const pageSize = 500;
  const rows: FindingSummaryRow[] = [];
  let cursorId: string | undefined;
  for (;;) {
    const batch = await db.assuranceFinding.findMany({
      where: {
        ...where,
        status: { notIn: CLOSED_STATUSES },
      },
      select: {
        id: true,
        policySeverity: true,
        releaseImpact: true,
        status: true,
        findingKind: true,
      },
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      rows.push({
        policySeverity: row.policySeverity,
        releaseImpact: row.releaseImpact,
        status: row.status,
        findingKind: row.findingKind,
      });
    }
    if (batch.length < pageSize) break;
    const lastId = batch[batch.length - 1]?.id;
    if (!lastId) break;
    cursorId = lastId;
  }

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

type FindingListRow = {
  findingKey: string;
  findingKind: string;
  title: string;
  status: string;
  policySeverity: string;
  releaseImpact: string;
  adapterKey: string;
  vendorIdentifier: string;
  affectedType: string;
  affectedId: string;
  lastSeenAt: Date;
  evidence?: unknown;
  bomComponent?: null | {
    name: string;
    version: string | null;
    packageUrl: string | null;
  };
};

function readEvidenceLinks(evidence: unknown): { backlogItemId: string | null; autoFileReason: string | null } {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { backlogItemId: null, autoFileReason: null };
  }
  const e = evidence as Record<string, unknown>;
  const backlogItemId = typeof e.backlogItemId === "string" && e.backlogItemId ? e.backlogItemId : null;
  let autoFileReason: string | null = null;
  const autoFile = e.autoFile;
  if (autoFile && typeof autoFile === "object" && !Array.isArray(autoFile)) {
    const reason = (autoFile as Record<string, unknown>).reason;
    if (typeof reason === "string" && reason) autoFileReason = reason;
  }
  return { backlogItemId, autoFileReason };
}

type FindingListDb = {
  assuranceFinding?: {
    findMany(args: unknown): Promise<unknown[]>;
  };
};

const SEVERITY_RANK: Record<AssurancePolicySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const CLOSED_LIST_STATUSES: AssuranceFindingStatus[] = ["resolved", "false-positive"];

function toActiveFindingRow(row: FindingListRow): ActiveAssuranceFindingRow {
  const severity = ASSURANCE_POLICY_SEVERITIES.includes(row.policySeverity as AssurancePolicySeverity)
    ? (row.policySeverity as AssurancePolicySeverity)
    : "info";
  const { backlogItemId, autoFileReason } = readEvidenceLinks(row.evidence);
  return {
    findingKey: row.findingKey,
    findingKind: row.findingKind,
    title: row.title,
    status: row.status,
    policySeverity: severity,
    releaseImpact: row.releaseImpact,
    adapterKey: row.adapterKey,
    vendorIdentifier: row.vendorIdentifier,
    affectedType: row.affectedType,
    affectedId: row.affectedId,
    lastSeenAt: row.lastSeenAt instanceof Date ? row.lastSeenAt : new Date(row.lastSeenAt),
    component: row.bomComponent ? {
      name: row.bomComponent.name,
      version: row.bomComponent.version,
      packageUrl: row.bomComponent.packageUrl,
    } : null,
    backlogItemId,
    autoFileReason,
  };
}

function castFindingListRows(rows: unknown[]): FindingListRow[] {
  return rows as FindingListRow[];
}

function sortBySeverityThenRecency(rows: ActiveAssuranceFindingRow[]): ActiveAssuranceFindingRow[] {
  return [...rows].sort((a, b) => {
    const severityDelta = SEVERITY_RANK[a.policySeverity] - SEVERITY_RANK[b.policySeverity];
    if (severityDelta !== 0) return severityDelta;
    return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
  });
}

async function listActiveFindings(
  db: FindingListDb,
  where: Record<string, unknown>,
  limit: number,
): Promise<ActiveAssuranceFindingRow[]> {
  if (!db.assuranceFinding) return [];

  const rows = await db.assuranceFinding.findMany({
    where: {
      ...where,
      status: { notIn: CLOSED_LIST_STATUSES },
    },
    select: {
      findingKey: true,
      findingKind: true,
      title: true,
      status: true,
      policySeverity: true,
      releaseImpact: true,
      adapterKey: true,
      vendorIdentifier: true,
      affectedType: true,
      affectedId: true,
      lastSeenAt: true,
      evidence: true,
      bomComponent: {
        select: {
          name: true,
          version: true,
          packageUrl: true,
        },
      },
    },
    take: Math.max(1, Math.min(limit, 200)),
  });

  return sortBySeverityThenRecency(castFindingListRows(rows).map(toActiveFindingRow));
}

export function listActiveFindingsForBuild(
  db: FindingListDb,
  buildId: string,
  limit = 25,
): Promise<ActiveAssuranceFindingRow[]> {
  return listActiveFindings(db, { buildId }, limit);
}

export function listActiveFindingsForProduct(
  db: FindingListDb,
  digitalProductId: string,
  limit = 25,
): Promise<ActiveAssuranceFindingRow[]> {
  return listActiveFindings(db, { digitalProductId }, limit);
}
