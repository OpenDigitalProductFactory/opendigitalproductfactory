// EP-FULL-OBS Tier 2 (BI-5FE8656F item #6) — shared health-alert issue writer.
//
// Turns a firing Prometheus/Loki alert into a PortfolioQualityIssue row in the
// operator's existing inbox. Extracted from /api/platform/alerts (the Grafana
// webhook receiver) so the SAME writer serves both delivery paths:
//   - push  — the webhook route, if an Alertmanager/Grafana ever POSTs
//   - poll  — alert-delivery-bridge cron (the active path today; no Alertmanager)
//
// Why not reuse packages/db's openOrUpdateQualityIssue: that canonical writer
// owns the discovery->portfolio quality family — a CLOSED QualityIssueType set
// (none of them health_alert) keyed by a REQUIRED inventory/taxonomy/portfolio
// FK scope (it throws without one). Health alerts have no such FK; they are
// keyed by alertname+service. Same table, deliberately different family.
//
// The generic open/resolve mechanics now live in `monitor-issue-writer.ts`,
// shared with the business-journey watchdog (BI-E105303D). What stays here is
// what is genuinely health-alert-specific: the key grammar, the severity
// mapping, and the details payload the reconciler reads.

import {
  openMonitorIssue,
  resolveMonitorIssue as resolveMonitorIssueRow,
  type MonitorIssueDb,
  type MonitorIssueScope,
} from "./monitor-issue-writer";

export type HealthAlertSeverity = "info" | "warn" | "error";

/**
 * EP-MSP-FEDERATION · A1 (BI-8777B85A) — per-customer/site routing scope.
 *
 * Resolved by the caller via the `@dpf/db` estate-scope resolver from the
 * originating EdgeNode / InventoryEntity (the canonical source). Self-monitoring
 * alerts (Prometheus/Loki on the operator's own containers) pass no scope and
 * stay organization-internal, which is backward-compatible. Edge-derived issues
 * pass scope so the operator inbox routes them to the right customer queue and
 * two customers with the same alert never collide on one row.
 */
export type HealthAlertScope = MonitorIssueScope;

function isCustomerScopedAlert(scope?: HealthAlertScope): boolean {
  return Boolean(scope?.customerAccountId);
}

/** Normalized alert input shared by the push (webhook) and poll (cron) paths. */
export interface IncomingHealthAlert {
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  /** Grafana/Alertmanager push provides startsAt; the poll path has activeAt. */
  startsAt?: string;
  activeAt?: string;
  /** "prometheus" | "loki-ruler" for the poll path; undefined → "webhook". */
  sourceSystem?: string;
}

/** Narrow Prisma surface so tests inject a mock without the full client type. */
export type HealthAlertDb = MonitorIssueDb;

/**
 * Deterministic issueKey for a health alert. Scoped by the most specific
 * distinguishing label so two services firing the same alert (e.g.
 * ContainerErrorLogSpike on `sandbox` AND `portal`) become two distinct
 * tracked issues instead of clobbering one row. Singleton metric alerts with
 * no service/instance/job label fall back to the bare alertname (backward
 * compatible with the original webhook key shape).
 */
export function healthAlertIssueKey(
  labels: Record<string, string>,
  estateScope?: HealthAlertScope,
): string {
  const name = labels.alertname ?? "unknown";
  const label = labels.service || labels.instance || labels.job || null;
  const base = label ? `health-alert-${name}:${label}` : `health-alert-${name}`;
  // Customer-scoped issues are prefixed with the estate scope key so two
  // customers (or a customer and the operator's own estate) firing the same
  // alert never collapse onto one row. Canonical key grammar: estate-scope.ts.
  if (isCustomerScopedAlert(estateScope)) {
    const prefix = estateScope!.scopeKey || `customer:${estateScope!.customerAccountId}`;
    return `${prefix}|${base}`;
  }
  return base;
}

function detailsFor(alert: IncomingHealthAlert) {
  return {
    alertName: alert.labels.alertname ?? "unknown",
    description: alert.annotations?.description ?? "",
    labels: alert.labels,
    // Attribution drives the cron's reconciliation: it only auto-resolves rows
    // whose source it actually polled this cycle (never webhook-owned rows).
    source: alert.sourceSystem ?? "webhook",
  };
}

/**
 * Open or refresh the PortfolioQualityIssue for a firing alert. Idempotent:
 * the unique issueKey means repeated firings update lastDetectedAt rather than
 * duplicating. Returns the issueKey so callers can track the firing set.
 */
export async function upsertHealthAlertIssue(
  db: HealthAlertDb,
  alert: IncomingHealthAlert,
  scope?: HealthAlertScope,
): Promise<string> {
  const issueKey = healthAlertIssueKey(alert.labels, scope);
  const alertName = alert.labels.alertname ?? "unknown";
  const severity: HealthAlertSeverity = alert.labels.severity === "critical" ? "error" : "warn";
  const summary = alert.annotations?.summary ?? alertName;
  const details = detailsFor(alert);
  const firstDetectedAt = alert.startsAt
    ? new Date(alert.startsAt)
    : alert.activeAt
      ? new Date(alert.activeAt)
      : new Date();

  return openMonitorIssue(db, {
    issueKey,
    issueType: "health_alert",
    severity,
    summary,
    details,
    firstDetectedAt,
    scope,
  });
}

/** Flip an open health-alert issue to resolved (alert stopped firing). */
export async function resolveHealthAlertIssue(
  db: HealthAlertDb,
  issueKey: string,
): Promise<void> {
  await resolveMonitorIssueRow(db, issueKey);
}
