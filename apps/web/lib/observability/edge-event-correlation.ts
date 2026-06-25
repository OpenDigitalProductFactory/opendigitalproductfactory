// EP-MSP-FEDERATION · A2 — edge-event correlation engine (BI-0A9D7F60).
//
// Slice 2 of the edge detection engine the schema reserved (see EdgeEvent /
// ChangeEvent comments). Joins a burst of EdgeEvents (alerts) on a node to the
// most recent preceding ChangeEvent within a look-back window, collapsing an
// alert storm into ONE correlated incident with the change-before-spike
// timeline ("we shipped X at 02:28; alerts fired at 02:31").
//
// Pure core + a DB-injected writer (mirrors health-alert-issue.ts) so the
// correlation logic is unit-tested without a live database. The writer persists
// a customer-scoped incident into the existing quality-issue inbox using the A1
// estate-scope columns — no new table; the operator inbox routes it per customer.
//
// Determinism: every output is derived from the event inputs (occurredAt,
// dedupKey, changeKey). No wall-clock reads — the caller supplies the event
// window, so a re-run over the same window yields the same incidentKey (idempotent).

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 1;
}

function maxSeverity(severities: string[]): string {
  return severities.reduce((acc, s) => (severityRank(s) > severityRank(acc) ? s : acc), "info");
}

/** A triggered/acknowledged EdgeEvent considered for correlation. */
export interface CorrelationAlert {
  id: string;
  edgeNodeId: string;
  dedupKey: string;
  severity: string;
  eventClass: string | null;
  source: string;
  summary: string;
  status: string;
  occurredAt: Date;
}

/** A ChangeEvent (deploy/config/flag) considered as a possible trigger. */
export interface CorrelationChange {
  id: string;
  edgeNodeId: string;
  changeKey: string;
  source: string;
  summary: string;
  occurredAt: Date;
}

export interface CorrelationOptions {
  /** Look-back for a preceding change before the spike onset. Default 15 min. */
  windowMinutes?: number;
  /** Min active alerts to call it a storm. A single `critical` always qualifies. */
  minAlerts?: number;
}

export interface TriggeringChange {
  changeKey: string;
  source: string;
  summary: string;
  occurredAt: Date;
  /** onsetAt − change.occurredAt, ≥ 0. The change-before-spike lead time. */
  leadTimeMs: number;
}

export interface CorrelatedIncident {
  incidentKey: string;
  edgeNodeId: string;
  onsetAt: Date;
  alertCount: number;
  highestSeverity: string;
  alertDedupKeys: string[];
  summary: string;
  triggeringChange: TriggeringChange | null;
}

const ACTIVE_ALERT_STATUSES = new Set(["triggered", "acknowledged"]);

function minuteBucket(d: Date): string {
  // ISO truncated to the minute — stable spike anchor for the idempotent key.
  return new Date(Math.floor(d.getTime() / 60000) * 60000).toISOString();
}

/**
 * Correlate alert bursts to preceding changes, one incident per affected node.
 *
 * v1 treats the active alerts supplied for a node (the caller scopes them to a
 * recent window) as one cluster: a node either has an ongoing storm or it does
 * not. onsetAt is the earliest alert; the triggering change is the most recent
 * change within `windowMinutes` before onset.
 */
export function correlateEdgeEvents(
  alerts: CorrelationAlert[],
  changes: CorrelationChange[],
  opts: CorrelationOptions = {},
): CorrelatedIncident[] {
  const windowMs = (opts.windowMinutes ?? 15) * 60000;
  const minAlerts = opts.minAlerts ?? 3;

  const active = alerts.filter((a) => ACTIVE_ALERT_STATUSES.has(a.status));
  const byNode = new Map<string, CorrelationAlert[]>();
  for (const a of active) {
    const list = byNode.get(a.edgeNodeId) ?? [];
    list.push(a);
    byNode.set(a.edgeNodeId, list);
  }

  const changesByNode = new Map<string, CorrelationChange[]>();
  for (const c of changes) {
    const list = changesByNode.get(c.edgeNodeId) ?? [];
    list.push(c);
    changesByNode.set(c.edgeNodeId, list);
  }

  const incidents: CorrelatedIncident[] = [];

  for (const [edgeNodeId, nodeAlerts] of byNode) {
    const highestSeverity = maxSeverity(nodeAlerts.map((a) => a.severity));
    const isStorm = nodeAlerts.length >= minAlerts;
    const isCritical = highestSeverity === "critical";
    if (!isStorm && !isCritical) continue; // individual non-critical alerts handled elsewhere

    const sorted = [...nodeAlerts].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const onsetAt = sorted[0].occurredAt;

    const candidate = (changesByNode.get(edgeNodeId) ?? [])
      .filter((c) => {
        const delta = onsetAt.getTime() - c.occurredAt.getTime();
        return delta >= 0 && delta <= windowMs;
      })
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];

    const triggeringChange: TriggeringChange | null = candidate
      ? {
          changeKey: candidate.changeKey,
          source: candidate.source,
          summary: candidate.summary,
          occurredAt: candidate.occurredAt,
          leadTimeMs: onsetAt.getTime() - candidate.occurredAt.getTime(),
        }
      : null;

    const incidentKey = [
      "edge-incident",
      edgeNodeId,
      triggeringChange ? triggeringChange.changeKey : "nochange",
      minuteBucket(onsetAt),
    ].join("|");

    const summary = triggeringChange
      ? `${nodeAlerts.length} alert(s) after ${triggeringChange.source} change "${triggeringChange.summary}"`
      : `${nodeAlerts.length} alert(s) on node ${edgeNodeId}`;

    incidents.push({
      incidentKey,
      edgeNodeId,
      onsetAt,
      alertCount: nodeAlerts.length,
      highestSeverity,
      alertDedupKeys: nodeAlerts.map((a) => a.dedupKey),
      summary,
      triggeringChange,
    });
  }

  // Stable order for deterministic output (tests + idempotent writes).
  return incidents.sort((a, b) => a.incidentKey.localeCompare(b.incidentKey));
}

// ── Persistence (DB-injected, testable with a mock) ──────────────────────────

export interface CorrelatedIncidentScope {
  customerAccountId?: string | null;
  customerSiteId?: string | null;
  scopeKey?: string | null;
}

export interface CorrelationDb {
  portfolioQualityIssue: {
    upsert(args: {
      where: { issueKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

function incidentSeverity(highest: string): "info" | "warn" | "error" {
  if (highest === "critical") return "error";
  if (highest === "error") return "error";
  if (highest === "warn") return "warn";
  return "info";
}

/**
 * Persist a correlated incident as a customer-scoped quality issue in the
 * operator inbox. Idempotent on incidentKey; re-running the correlation over an
 * ongoing storm refreshes the row rather than duplicating it.
 */
export async function persistCorrelatedIncident(
  db: CorrelationDb,
  incident: CorrelatedIncident,
  scope: CorrelatedIncidentScope = {},
): Promise<string> {
  const issueKey = incident.incidentKey;
  const details = {
    edgeNodeId: incident.edgeNodeId,
    alertCount: incident.alertCount,
    alertDedupKeys: incident.alertDedupKeys,
    highestSeverity: incident.highestSeverity,
    onsetAt: incident.onsetAt.toISOString(),
    triggeringChange: incident.triggeringChange
      ? {
          ...incident.triggeringChange,
          occurredAt: incident.triggeringChange.occurredAt.toISOString(),
        }
      : null,
    source: "edge-correlation",
  };
  const scopeKey =
    scope.scopeKey ??
    (scope.customerAccountId
      ? scope.customerSiteId
        ? `customer:${scope.customerAccountId}:site:${scope.customerSiteId}`
        : `customer:${scope.customerAccountId}`
      : "organization:internal");

  await db.portfolioQualityIssue.upsert({
    where: { issueKey },
    create: {
      issueKey,
      issueType: "edge_correlated_incident",
      severity: incidentSeverity(incident.highestSeverity),
      summary: incident.summary,
      details,
      status: "open",
      customerAccountId: scope.customerAccountId ?? null,
      customerSiteId: scope.customerSiteId ?? null,
      scopeKey,
      firstDetectedAt: incident.onsetAt,
      lastDetectedAt: new Date(),
    },
    update: {
      severity: incidentSeverity(incident.highestSeverity),
      summary: incident.summary,
      details,
      status: "open",
      lastDetectedAt: new Date(),
      resolvedAt: null,
    },
  });
  return issueKey;
}
