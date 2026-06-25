// EP-MSP-FEDERATION · A3 — service-ticket closed unions + pure mappers
// (BI-99FEA7FA). One ticket model, discriminated by `ticketKind`. Status values
// are hyphenated per the WS-0 convergence rule (one closed union, no underscore
// drift); update this file AND any MCP tool schema in the same commit when a
// value is added.

export const SERVICE_TICKET_KINDS = [
  "incident",
  "request",
  "change",
  "scheduled-review",
] as const;
export type ServiceTicketKind = (typeof SERVICE_TICKET_KINDS)[number];

export const SERVICE_TICKET_STATUSES = [
  "open",
  "acknowledged",
  "in-progress",
  "waiting-customer",
  "resolved",
  "closed",
] as const;
export type ServiceTicketStatus = (typeof SERVICE_TICKET_STATUSES)[number];

export const SERVICE_TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type ServiceTicketPriority = (typeof SERVICE_TICKET_PRIORITIES)[number];

/** Allowed forward transitions. `closed` is terminal; `resolved` can re-open. */
const STATUS_TRANSITIONS: Record<ServiceTicketStatus, ServiceTicketStatus[]> = {
  open: ["acknowledged", "in-progress", "waiting-customer", "resolved", "closed"],
  acknowledged: ["in-progress", "waiting-customer", "resolved", "closed"],
  "in-progress": ["waiting-customer", "resolved", "closed"],
  "waiting-customer": ["in-progress", "resolved", "closed"],
  resolved: ["closed", "in-progress"],
  closed: [],
};

export function isValidTicketStatusTransition(
  from: ServiceTicketStatus,
  to: ServiceTicketStatus,
): boolean {
  if (from === to) return true;
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Edge severity → ticket priority. */
export function priorityFromSeverity(severity: string | null | undefined): ServiceTicketPriority {
  switch (severity) {
    case "critical":
      return "urgent";
    case "error":
      return "high";
    case "warn":
      return "normal";
    default:
      return "low";
  }
}

/** Structural shape of an A2 correlated incident (no import from apps/web; keeps
 *  the package dependency direction correct). */
export interface IncidentLike {
  incidentKey: string;
  edgeNodeId: string;
  summary: string;
  highestSeverity: string;
  alertCount: number;
  onsetAt: Date;
  triggeringChange?: {
    changeKey: string;
    source: string;
    summary: string;
  } | null;
}

export interface ServiceTicketScope {
  customerAccountId?: string | null;
  customerSiteId?: string | null;
  scopeKey?: string | null;
}

export interface ServiceTicketDraft {
  ticketKind: ServiceTicketKind;
  status: ServiceTicketStatus;
  priority: ServiceTicketPriority;
  severity: string | null;
  title: string;
  description: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  scopeKey: string | null;
  edgeNodeId: string | null;
  correlatedIncidentKey: string;
}

/**
 * Pure mapper: an A2 correlated incident → a service-ticket draft. Deterministic;
 * the persistence layer assigns the `ticketId` and writes the row idempotently
 * keyed by `correlatedIncidentKey` so one incident yields one ticket.
 */
export function serviceTicketDraftFromIncident(
  incident: IncidentLike,
  scope: ServiceTicketScope = {},
): ServiceTicketDraft {
  const change = incident.triggeringChange;
  const description = change
    ? `${incident.summary}. Correlated to ${change.source} change "${change.summary}" (${change.changeKey}).`
    : incident.summary;
  return {
    ticketKind: "incident",
    status: "open",
    priority: priorityFromSeverity(incident.highestSeverity),
    severity: incident.highestSeverity,
    title: incident.summary,
    description,
    customerAccountId: scope.customerAccountId ?? null,
    customerSiteId: scope.customerSiteId ?? null,
    scopeKey: scope.scopeKey ?? (scope.customerAccountId ? null : "organization:internal"),
    edgeNodeId: incident.edgeNodeId,
    correlatedIncidentKey: incident.incidentKey,
  };
}
