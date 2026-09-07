// apps/web/lib/queue/functions/edge-incident-correlation.ts
// EP-MSP-FEDERATION · A2 + A3 runtime — edge incident correlation job.
//
// Makes the correlation engine (A2) and the customer service desk (A3) LIVE.
// Every 10 min: load recent active EdgeEvents + recent ChangeEvents, correlate
// them into change-before-spike incidents (correlateEdgeEvents), then for each
// incident persist a customer-scoped quality issue (operator inbox) AND upsert a
// customer ServiceTicket. Scope is derived from the originating EdgeNode via the
// estate-scope resolver — so incidents/tickets route to the right customer.
//
// Mirrors log-signature-scanner: a pure DB-injected orchestration fn (tests drive
// it with a mock) + a thin Inngest wrapper with the quiescence gate. Idempotent:
// incident keys and the derived ticketId are deterministic, so re-running over an
// ongoing storm refreshes rows rather than duplicating them.
//
// Dark-launched behind DPF_EDGE_INCIDENT_CORRELATION_ENABLED (default off) so it
// deploys inert until the operator flips it on (matches the platform's
// new-autonomous-job rollout pattern).

import { createHash } from "crypto";
import { cron } from "inngest";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import {
  correlateEdgeEvents,
  persistCorrelatedIncident,
  type CorrelatedIncident,
  type CorrelationAlert,
  type CorrelationChange,
} from "@/lib/observability/edge-event-correlation";
import { estateRoutingFields } from "@dpf/db/estate-scope";
import { serviceTicketDraftFromIncident } from "@dpf/db/service-ticket-types";

const LOOKBACK_MIN = Number(process.env.DPF_EDGE_CORRELATION_LOOKBACK_MIN ?? 30);
const CHANGE_LOOKBACK_MIN = Number(process.env.DPF_EDGE_CORRELATION_CHANGE_LOOKBACK_MIN ?? 45);
const WINDOW_MIN = Number(process.env.DPF_EDGE_CORRELATION_WINDOW_MIN ?? 15);

export interface EdgeCorrelationResult {
  alerts: number;
  changes: number;
  incidents: number;
  ticketsUpserted: number;
}

interface EdgeEventRow {
  id: string;
  edgeNodeId: string;
  dedupKey: string;
  severity: string;
  eventClass: string | null;
  source: string;
  summary: string;
  status: string;
  occurredAt: Date;
  node?: { customerAccountId: string | null; customerSiteId: string | null } | null;
}

interface ChangeEventRow {
  id: string;
  edgeNodeId: string;
  changeKey: string;
  source: string;
  summary: string;
  occurredAt: Date;
}

/** Narrow Prisma surface so tests inject a mock without the full client type. */
export interface EdgeCorrelationDb {
  edgeEvent: { findMany(args: unknown): Promise<EdgeEventRow[]> };
  changeEvent: { findMany(args: unknown): Promise<ChangeEventRow[]> };
  portfolioQualityIssue: {
    upsert(args: {
      where: { issueKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
  serviceTicket: {
    upsert(args: {
      where: { ticketId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

/** Deterministic, stable ticket id for an incident — keeps the upsert idempotent. */
export function ticketIdForIncident(incidentKey: string): string {
  return "ST-" + createHash("sha1").update(incidentKey).digest("hex").slice(0, 10).toUpperCase();
}

async function upsertTicketForIncident(
  db: EdgeCorrelationDb,
  incident: CorrelatedIncident,
  scope: { customerAccountId: string | null; customerSiteId: string | null; scopeKey: string },
): Promise<void> {
  const draft = serviceTicketDraftFromIncident(incident, scope);
  const ticketId = ticketIdForIncident(incident.incidentKey);
  await db.serviceTicket.upsert({
    where: { ticketId },
    create: {
      ticketId,
      ticketKind: draft.ticketKind,
      status: draft.status,
      priority: draft.priority,
      severity: draft.severity,
      title: draft.title,
      description: draft.description,
      customerAccountId: draft.customerAccountId,
      customerSiteId: draft.customerSiteId,
      scopeKey: draft.scopeKey,
      edgeNodeId: draft.edgeNodeId,
      correlatedIncidentKey: draft.correlatedIncidentKey,
    },
    // Refresh derived fields on recurrence but never clobber operator-owned
    // status / ownership.
    update: {
      priority: draft.priority,
      severity: draft.severity,
      title: draft.title,
      description: draft.description,
    },
  });
}

/**
 * Load → correlate → persist. Pure of the Inngest harness and the real client
 * so unit tests drive it with a mock db.
 */
export async function correlateAndPersistIncidents(
  db: EdgeCorrelationDb,
  opts: {
    now?: Date;
    lookbackMinutes?: number;
    changeLookbackMinutes?: number;
    windowMinutes?: number;
  } = {},
): Promise<EdgeCorrelationResult> {
  const now = opts.now ?? new Date();
  const alertSince = new Date(now.getTime() - (opts.lookbackMinutes ?? LOOKBACK_MIN) * 60000);
  const changeSince = new Date(now.getTime() - (opts.changeLookbackMinutes ?? CHANGE_LOOKBACK_MIN) * 60000);

  const edgeEvents = await db.edgeEvent.findMany({
    where: { status: { in: ["triggered", "acknowledged"] }, occurredAt: { gte: alertSince } },
    include: { node: { select: { customerAccountId: true, customerSiteId: true } } },
  });
  const changeEvents = await db.changeEvent.findMany({
    where: { occurredAt: { gte: changeSince } },
  });

  const scopeByNode = new Map<string, { customerAccountId: string | null; customerSiteId: string | null }>();
  for (const e of edgeEvents) {
    if (!scopeByNode.has(e.edgeNodeId)) {
      scopeByNode.set(e.edgeNodeId, {
        customerAccountId: e.node?.customerAccountId ?? null,
        customerSiteId: e.node?.customerSiteId ?? null,
      });
    }
  }

  const alerts: CorrelationAlert[] = edgeEvents.map((e) => ({
    id: e.id,
    edgeNodeId: e.edgeNodeId,
    dedupKey: e.dedupKey,
    severity: e.severity,
    eventClass: e.eventClass,
    source: e.source,
    summary: e.summary,
    status: e.status,
    occurredAt: e.occurredAt,
  }));
  const changes: CorrelationChange[] = changeEvents.map((c) => ({
    id: c.id,
    edgeNodeId: c.edgeNodeId,
    changeKey: c.changeKey,
    source: c.source,
    summary: c.summary,
    occurredAt: c.occurredAt,
  }));

  const incidents = correlateEdgeEvents(alerts, changes, {
    windowMinutes: opts.windowMinutes ?? WINDOW_MIN,
  });

  let ticketsUpserted = 0;
  for (const incident of incidents) {
    const scope = scopeByNode.get(incident.edgeNodeId) ?? { customerAccountId: null, customerSiteId: null };
    const routing = estateRoutingFields(scope);
    await persistCorrelatedIncident(db, incident, routing);
    await upsertTicketForIncident(db, incident, routing);
    ticketsUpserted++;
  }

  return {
    alerts: alerts.length,
    changes: changes.length,
    incidents: incidents.length,
    ticketsUpserted,
  };
}

export async function runEdgeIncidentCorrelation(opts?: {
  lookbackMinutes?: number;
}): Promise<EdgeCorrelationResult> {
  const { prisma } = await import("@dpf/db");
  return correlateAndPersistIncidents(prisma as unknown as EdgeCorrelationDb, opts);
}

export const edgeIncidentCorrelation = inngest.createFunction(
  { id: "ops/edge-incident-correlation", retries: 2, triggers: [cron("4,14,24,34,44,54 * * * *")] },
  async ({ step }) => {
    if (!envFlagEnabled(process.env, "DPF_EDGE_INCIDENT_CORRELATION_ENABLED")) {
      return { skipped: true, reason: "flag-disabled" };
    }
    const gate = await gateAtEntry(step, "ops/edge-incident-correlation");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return await step.run("correlate-edge-incidents", async () => runEdgeIncidentCorrelation());
  },
);
