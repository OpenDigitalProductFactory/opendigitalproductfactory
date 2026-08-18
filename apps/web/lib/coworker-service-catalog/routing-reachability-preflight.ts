// Scheduled routing-reachability preflight (BI-E2CCFAC1).
//
// The router could always say exactly why a coworker cannot route — but nothing
// ever asked until a human typed a message and watched it die. This preflight
// asks on a schedule: it projects route readiness for every production coworker
// (including the payload-screening escalation ceiling, see route-readiness.ts),
// raises ONE deduplicated owner-visible health issue when any coworker has zero
// eligible endpoints, and resolves that issue when routing recovers. Read-only
// with respect to routing: it performs the same side-effect-free dry-run the
// runtime-health page and resolve_model_selection use.

import { prisma } from "@dpf/db";

import {
  loadCoworkerRoutingReadinessSnapshot,
  projectCoworkerRouteReadiness,
  type CoworkerRouteConfiguration,
} from "./route-readiness";
import {
  healthAlertIssueKey,
  resolveHealthAlertIssue,
  upsertHealthAlertIssue,
} from "@/lib/observability/health-alert-issue";
import {
  notifyAttentionLive,
  resolveOperatorRecipient,
} from "@/lib/attention/notify-live";

export type CoworkerReachabilityResult = {
  agentId: string;
  displayName: string;
  sensitivity: string;
  ready: boolean;
  reason: string;
  escalated?: { sensitivity: string; ready: boolean; reason: string };
};

const ALERT_LABELS = {
  alertname: "CoworkerRoutingUnreachable",
  service: "ai-routing",
  severity: "critical",
} as const;

/** Project route readiness for every production coworker. */
export async function computeCoworkerRoutingReachability(): Promise<
  CoworkerReachabilityResult[]
> {
  const [agents, configs] = await Promise.all([
    prisma.agent.findMany({
      where: { status: "active", archived: false, lifecycleStage: "production" },
      select: { agentId: true, displayName: true, sensitivity: true },
      orderBy: { agentId: "asc" },
    }),
    prisma.agentModelConfig.findMany({
      select: {
        agentId: true,
        minimumTier: true,
        pinnedProviderId: true,
        pinnedModelId: true,
        budgetClass: true,
        minimumCapabilities: true,
        minimumContextTokens: true,
      },
    }),
  ]);
  const configByAgent = new Map(configs.map((c) => [c.agentId, c] as const));
  const snapshot = await loadCoworkerRoutingReadinessSnapshot(
    agents.map((a) => a.agentId),
  );

  const results: CoworkerReachabilityResult[] = [];
  for (const agent of agents) {
    const config = configByAgent.get(agent.agentId);
    const routeConfig: CoworkerRouteConfiguration = {
      agentId: agent.agentId,
      sensitivity: agent.sensitivity,
      minimumTier: config?.minimumTier ?? "adequate",
      pinnedProviderId: config?.pinnedProviderId ?? null,
      pinnedModelId: config?.pinnedModelId ?? null,
      budgetClass: config?.budgetClass ?? "balanced",
      minimumCapabilities: config?.minimumCapabilities ?? null,
      minimumContextTokens: config?.minimumContextTokens ?? null,
    };
    const readiness = await projectCoworkerRouteReadiness(routeConfig, snapshot);
    results.push({
      agentId: agent.agentId,
      displayName: agent.displayName,
      sensitivity: agent.sensitivity,
      ready: readiness.ready,
      reason: readiness.reason,
      ...(readiness.escalated ? { escalated: readiness.escalated } : {}),
    });
  }
  return results;
}

/**
 * Run the preflight: compute reachability, then raise or resolve the single
 * owner-visible issue. Returns a summary for the scheduled-job stamp.
 */
export async function runRoutingReachabilityPreflight(): Promise<{
  checked: number;
  blocked: CoworkerReachabilityResult[];
}> {
  const results = await computeCoworkerRoutingReachability();
  const blocked = results.filter((r) => !r.ready);

  if (blocked.length > 0) {
    const names = blocked.map((b) => b.displayName).join(", ");
    const summary =
      `${blocked.length} AI coworker${blocked.length === 1 ? " has" : "s have"} no eligible AI model — ` +
      `their turns will fail until routing is repaired: ${names}`;
    // `as never` matches the existing callers (alert-delivery-bridge, alerts
    // route): the narrow MonitorIssueDb parameter type predates the full client.
    await upsertHealthAlertIssue(prisma as never, {
      labels: { ...ALERT_LABELS },
      annotations: {
        summary,
        description: blocked
          .map((b) => `${b.displayName} (${b.agentId}): ${b.reason}`)
          .join("\n"),
      },
      activeAt: new Date().toISOString(),
      sourceSystem: "routing-preflight",
    });
    const ownerUserId = await resolveOperatorRecipient();
    if (ownerUserId) {
      await notifyAttentionLive({
        source: "platform-health",
        itemKey: "routing-preflight",
        userId: ownerUserId,
        title: `${blocked.length} AI coworker${blocked.length === 1 ? "" : "s"} cannot reach any AI model`,
        body: summary,
        deepLink: "/platform/ai/runtime-health",
        riskClass: "high",
      });
    }
  } else {
    await resolveHealthAlertIssue(
      prisma as never,
      healthAlertIssueKey({ ...ALERT_LABELS }),
    ).catch(() => {});
  }

  return { checked: results.length, blocked };
}
