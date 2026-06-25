// EP-SOVEREIGN-SOC P0 — internal-source security normalization (self-monitoring).
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.2, §7.1.
//
// The platform's own governed audit logs are the first SecurityEvent source —
// the day-one dogfood. AuthorizationDecisionLog (every allow/deny) and
// ToolExecution (every agent/user tool call) project into OCSF API-Activity
// (6003) events under the operator's own internal scope (no edge node).
//
// The pure mappers + `projectInternalSecurityEvents` (upsert injected) are unit
// tested; `runInternalSecurityProjection` is the thin I/O caller that the
// scheduled correlation/projection job (P1) invokes. Internal events carry
// scopeKey="organization:internal", customerAccountId=null, edgeNodeId=null —
// they are the operator monitoring itself, not a customer overlay.

import {
  OCSF_ACTIVITY,
  OCSF_CATEGORY,
  OCSF_CLASS,
  OCSF_SEVERITY,
  OCSF_VERSION,
} from "./ocsf";
import type { NormalizedSecurityCore } from "./normalizers";
import { ORG_INTERNAL_SCOPE_KEY } from "./scope";

// ── AuthorizationDecisionLog → OCSF API Activity ────────────────────────────

export interface AuthorizationDecisionRow {
  decisionId: string;
  actorType: string | null;
  actorRef: string | null;
  actionKey: string | null;
  objectRef: string | null;
  decision: string; // allow | deny | error
  createdAt: Date;
  routeContext: string | null;
  sensitivityLevel: string | null;
}

export function securityCoreFromAuthorizationDecision(
  row: AuthorizationDecisionRow,
): NormalizedSecurityCore {
  const denied = row.decision === "deny" || row.decision === "error";
  return {
    eventKey: `dpf.internal:authz:${row.decisionId}`,
    ocsfVersion: OCSF_VERSION,
    ocsfClassUid: OCSF_CLASS.API_ACTIVITY,
    ocsfCategoryUid: OCSF_CATEGORY.APPLICATION_ACTIVITY,
    ocsfActivityId: OCSF_ACTIVITY.UNKNOWN,
    // A denied/errored authorization is the notable signal (Medium); an allow
    // is routine (Informational). This is honest severity, not theatre.
    severityId: denied ? OCSF_SEVERITY.MEDIUM : OCSF_SEVERITY.INFORMATIONAL,
    time: row.createdAt.toISOString(),
    sourceKind: "dpf.internal",
    sourceName: "authorization-decision",
    actorPrincipalId: row.actorRef ?? undefined,
    actor: { type: row.actorType ?? "unknown", uid: row.actorRef ?? undefined },
    normalized: {
      api: { operation: row.actionKey ?? "unknown", service: { name: "dpf.authority" } },
      object: row.objectRef,
      decision: row.decision,
      routeContext: row.routeContext,
      sensitivity: row.sensitivityLevel,
    },
    rawRef: {
      sourceKind: "dpf.internal",
      table: "AuthorizationDecisionLog",
      id: row.decisionId,
    },
  };
}

// ── ToolExecution → OCSF API Activity ───────────────────────────────────────

export interface ToolExecutionRow {
  id: string;
  toolName: string;
  agentId: string | null;
  userId: string | null;
  success: boolean;
  routeContext: string | null;
  createdAt: Date;
}

export function securityCoreFromToolExecution(
  row: ToolExecutionRow,
): NormalizedSecurityCore {
  return {
    eventKey: `dpf.internal:tool:${row.id}`,
    ocsfVersion: OCSF_VERSION,
    ocsfClassUid: OCSF_CLASS.API_ACTIVITY,
    ocsfCategoryUid: OCSF_CATEGORY.APPLICATION_ACTIVITY,
    ocsfActivityId: OCSF_ACTIVITY.UNKNOWN,
    // A failed tool call is the notable signal; success is routine.
    severityId: row.success ? OCSF_SEVERITY.INFORMATIONAL : OCSF_SEVERITY.LOW,
    time: row.createdAt.toISOString(),
    sourceKind: "dpf.internal",
    sourceName: "tool-execution",
    actorPrincipalId: row.agentId ?? undefined,
    actor: {
      type: row.agentId ? "agent" : "user",
      uid: row.agentId ?? row.userId ?? undefined,
    },
    normalized: {
      api: { operation: row.toolName, service: { name: "dpf.mcp" } },
      success: row.success,
      routeContext: row.routeContext,
    },
    rawRef: { sourceKind: "dpf.internal", table: "ToolExecution", id: row.id },
  };
}

// ── Pure projector (upsert injected — testable) ─────────────────────────────

export interface InternalProjectionResult {
  projected: number;
}

/**
 * Normalize internal audit rows into SecurityEvent cores and persist them via
 * the injected upsert. Pure of I/O: tests pass a recording fake; the real
 * caller (`runInternalSecurityProjection`) passes a Prisma-backed upsert.
 */
export async function projectInternalSecurityEvents(args: {
  authorizationDecisions: AuthorizationDecisionRow[];
  toolExecutions: ToolExecutionRow[];
  upsert: (core: NormalizedSecurityCore) => Promise<void>;
}): Promise<InternalProjectionResult> {
  const cores: NormalizedSecurityCore[] = [
    ...args.authorizationDecisions.map(securityCoreFromAuthorizationDecision),
    ...args.toolExecutions.map(securityCoreFromToolExecution),
  ];
  for (const core of cores) {
    await args.upsert(core);
  }
  return { projected: cores.length };
}

// ── Thin I/O caller (invoked by the P1 scheduled projection job) ────────────

const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000; // 1 hour

/**
 * Read recent internal audit rows and persist them as org-internal
 * SecurityEvents (append-only upsert on eventKey). Scope is fixed to the
 * operator's own estate — these are the platform monitoring itself.
 */
export async function runInternalSecurityProjection(opts?: {
  since?: Date;
  limit?: number;
}): Promise<InternalProjectionResult> {
  const { prisma } = await import("@dpf/db");
  const since =
    opts?.since ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  const take = opts?.limit ?? 500;

  const [authz, tools] = await Promise.all([
    prisma.authorizationDecisionLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take,
    }),
    prisma.toolExecution.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take,
    }),
  ]);

  return projectInternalSecurityEvents({
    authorizationDecisions: authz,
    toolExecutions: tools,
    upsert: async (core) => {
      const json = (v: unknown): object | undefined =>
        v === undefined ? undefined : (v as object);
      await prisma.securityEvent.upsert({
        where: { eventKey: core.eventKey },
        update: {}, // append-only
        create: {
          eventKey: core.eventKey,
          ocsfVersion: core.ocsfVersion,
          ocsfClassUid: core.ocsfClassUid,
          ocsfCategoryUid: core.ocsfCategoryUid ?? null,
          ocsfActivityId: core.ocsfActivityId ?? null,
          severityId: core.severityId ?? null,
          time: new Date(core.time),
          scopeKey: ORG_INTERNAL_SCOPE_KEY,
          customerAccountId: null,
          customerSiteId: null,
          edgeNodeId: null,
          sourceKind: core.sourceKind,
          sourceName: core.sourceName,
          actorPrincipalId: core.actorPrincipalId ?? null,
          actor: json(core.actor),
          device: json(core.device),
          srcEndpoint: json(core.srcEndpoint),
          dstEndpoint: json(core.dstEndpoint),
          observables: json(core.observables),
          normalized: json(core.normalized),
          rawRef: json(core.rawRef),
          confidence: core.confidence ?? "source-reported",
        },
      });
    },
  });
}
